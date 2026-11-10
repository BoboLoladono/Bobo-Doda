import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { StorageProvider, StoredObject } from './storage-provider.interface';

interface DownloadTokenPayload {
  key: string;
  expiresAt: number;
  sig: string;
}

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly hmacSecret: Buffer;

  constructor() {
    this.bucket = process.env.KYC_S3_BUCKET || 'bobododa-kyc-private';
    this.endpoint = process.env.KYC_S3_ENDPOINT || 'http://127.0.0.1:9000';
    this.accessKeyId = process.env.KYC_S3_ACCESS_KEY || '';
    this.secretAccessKey = process.env.KYC_S3_SECRET_KEY || '';
    const hmacSeed = process.env.JWT_STAFF_ACCESS_SECRET || 'kyc-token-secret-fallback-minimum-32-chars-long';
    this.hmacSecret = Buffer.from(hmacSeed, 'utf8');
  }

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('S3 credentials are not configured');
    }
    const url = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'x-amz-server-side-encryption': 'AES256',
      },
      body: new Uint8Array(buffer),
    });
    if (!response.ok) {
      throw new Error(`S3 upload failed with status ${response.status}`);
    }
  }

  async getObject(key: string): Promise<StoredObject> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error('S3 credentials are not configured');
    }
    const url = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${encodeURIComponent(key)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`S3 getObject failed with status ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
      buffer,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentLength: buffer.length,
    };
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      return;
    }
    const url = `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${encodeURIComponent(key)}`;
    await fetch(url, { method: 'DELETE' });
  }

  createSignedDownloadToken(key: string, expiresInSeconds: number): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const dataToSign = `${key}:${expiresAt}`;
    const hmac = createHmac('sha256', this.hmacSecret).update(dataToSign).digest('hex');
    return Buffer.from(JSON.stringify({ key, expiresAt, sig: hmac })).toString('base64url');
  }

  verifySignedDownloadToken(token: string): { key: string; valid: boolean } {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as DownloadTokenPayload;
      const { key, expiresAt, sig } = decoded;
      if (!key || typeof expiresAt !== 'number' || !sig) {
        return { key: '', valid: false };
      }
      if (Math.floor(Date.now() / 1000) > expiresAt) {
        return { key, valid: false };
      }
      const expectedSig = createHmac('sha256', this.hmacSecret).update(`${key}:${expiresAt}`).digest('hex');
      return { key, valid: sig === expectedSig };
    } catch {
      return { key: '', valid: false };
    }
  }
}
