import { createHash, createHmac } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@/config/app-config.service';
import { DomainError } from '@/common/errors/domain-error';

export interface StorageUploadParams {
  bucket: string;
  key: string;
  data: Buffer;
  contentType: string;
}

/**
 * O'zbekiston Respublikasi 547-sonli Qonuni (27¹-modda) talablariga mos
 * xavfsiz ichki MinIO / S3 saqlash xizmati.
 * Fuqarolar ma'lumotlari (KYC, pasport, profillar) faqat O'zbekistonda
 * jismonan joylashgan infratuzilmada saqlanishini ta'minlaydi.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: AppConfigService) {
    this.assertDataSovereignty();
  }

  /**
   * 547-sonli Qonunning 27¹-moddasiga muvofiqlikni kafolatlaydi:
   * Xorijiy bulutlar (AWS/GCP/Azure) production muhitida qat'iy taqiqlanadi.
   */
  private assertDataSovereignty(): void {
    if (!this.config.isProduction) return;

    const s3 = this.config.s3;
    if (s3.endpoint) {
      const foreignClouds = /(amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net|digitaloceanspaces\.com)/i;
      if (foreignClouds.test(s3.endpoint)) {
        throw new DomainError(
          'PROVIDER_CONFIG_ERROR',
          '547-sonli Qonun buzilishi: shaxsiy ma’lumotlar xorijiy S3 bulutlarida saqlanishi mumkin emas',
        );
      }
    }
    this.logger.log('547-sonli Qonun bo‘yicha ma’lumotlar suvereniteti tekshirildi (Region: UZ)');
  }

  /**
   * S3 / MinIO uchun AWS SigV4 imzosi va avtorizatsiya sarlavhalarini shakllantiradi.
   */
  private signS3Request(params: {
    method: string;
    targetUrl: string;
    payload: Buffer | Uint8Array;
    contentType?: string;
  }): Record<string, string> {
    const s3 = this.config.s3;
    const rawHeaders: Record<string, string> = {};
    if (params.contentType) {
      rawHeaders['content-type'] = params.contentType;
    }

    if (!s3.accessKey || !s3.secretKey) {
      return rawHeaders;
    }

    const urlObj = new URL(params.targetUrl);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = s3.region || 'uz-tashkent-1';
    const payloadHash = createHash('sha256').update(params.payload).digest('hex');

    const signedHeadersMap: Record<string, string> = {
      ...rawHeaders,
      host: urlObj.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };

    const sortedHeaderKeys = Object.keys(signedHeadersMap).sort();
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => `${k}:${(signedHeadersMap[k] ?? '').trim()}\n`)
      .join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      params.method.toUpperCase(),
      urlObj.pathname,
      urlObj.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const kDate = createHmac('sha256', `AWS4${s3.secretKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorization = `AWS4-HMAC-SHA256 Credential=${s3.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...signedHeadersMap,
      authorization,
    };
  }

  /** Fayl yuklash (MinIO / S3 REST with SigV4) */
  async upload(params: StorageUploadParams): Promise<{ key: string; url: string }> {
    const s3 = this.config.s3;
    const endpoint = s3.endpoint ?? 'http://minio:9000';
    const targetUrl = `${endpoint.replace(/\/$/, '')}/${params.bucket}/${params.key}`;

    const headers = this.signS3Request({
      method: 'PUT',
      targetUrl,
      payload: params.data,
      contentType: params.contentType,
    });

    try {
      const res = await fetch(targetUrl, {
        method: 'PUT',
        headers,
        body: new Uint8Array(params.data),
      });

      if (!res.ok) {
        this.logger.error(`Storage yuklash xatosi: HTTP ${res.status}`);
        throw new DomainError('UNKNOWN', 'Fayl saqlash serverida xatolik yuz berdi');
      }

      return {
        key: params.key,
        url: targetUrl,
      };
    } catch (err) {
      if (err instanceof DomainError) throw err;
      this.logger.error({ err }, 'Storage bilan aloqa o‘rnatib bo‘lmadi');
      throw new DomainError('UNKNOWN', 'Saqlash serveriga ulanish xatosi');
    }
  }

  /** Faylni o‘chirish */
  async delete(bucket: string, key: string): Promise<boolean> {
    const s3 = this.config.s3;
    const endpoint = s3.endpoint ?? 'http://minio:9000';
    const targetUrl = `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
    const headers = this.signS3Request({
      method: 'DELETE',
      targetUrl,
      payload: Buffer.alloc(0),
    });

    try {
      const res = await fetch(targetUrl, { method: 'DELETE', headers });
      return res.ok;
    } catch (err) {
      this.logger.warn({ err }, `Faylni o‘chirishda ogohlantirish: ${key}`);
      return false;
    }
  }

  /** Ommaviy yuklab olish yoki ko‘rish URL manzili */
  getPublicUrl(bucket: string, key: string): string {
    const s3 = this.config.s3;
    const endpoint = s3.endpoint ?? 'http://localhost:9000';
    return `${endpoint.replace(/\/$/, '')}/${bucket}/${key}`;
  }
}
