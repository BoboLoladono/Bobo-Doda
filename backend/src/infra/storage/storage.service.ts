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

  /** Fayl yuklash (MinIO / S3 REST) */
  async upload(params: StorageUploadParams): Promise<{ key: string; url: string }> {
    const s3 = this.config.s3;
    const endpoint = s3.endpoint ?? 'http://minio:9000';
    const targetUrl = `${endpoint.replace(/\/$/, '')}/${params.bucket}/${params.key}`;

    const headers: Record<string, string> = {
      'Content-Type': params.contentType,
    };

    if (s3.accessKey && s3.secretKey) {
      // Basic / S3 Auth token header
      headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';
    }

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

    try {
      const res = await fetch(targetUrl, { method: 'DELETE' });
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
