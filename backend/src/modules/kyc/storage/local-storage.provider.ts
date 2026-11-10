import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageProvider, StoredObject } from './storage-provider.interface';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

interface EncryptedEnvelope {
  version: number;
  contentType: string;
  originalLength: number;
  iv: string;
  authTag: string;
  data: string;
}

interface DownloadTokenPayload {
  key: string;
  expiresAt: number;
  sig: string;
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly baseDir: string;
  private readonly encryptionKey: Buffer;
  private readonly hmacSecret: Buffer;

  constructor(baseDir?: string, encryptionKeyHex?: string) {
    this.baseDir = path.resolve(baseDir || process.env.KYC_STORAGE_LOCAL_DIR || '/tmp/storage_isolated/kyc');
    
    // 32-byte AES key for at-rest file encryption
    const rawKey = encryptionKeyHex || process.env.KYC_STORAGE_ENCRYPTION_KEY;
    if (!rawKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('KYC_STORAGE_ENCRYPTION_KEY must be configured in production (fail closed)');
      }
      this.encryptionKey = Buffer.from((process.env.STAFF_TOTP_ENCRYPTION_KEY || '22'.repeat(32)).padEnd(64, '0').slice(0, 64), 'hex');
    } else {
      this.encryptionKey = Buffer.from(rawKey.padEnd(64, '0').slice(0, 64), 'hex');
    }

    // HMAC secret for short-lived token verification
    const hmacSeed = process.env.JWT_STAFF_ACCESS_SECRET || 'kyc-token-secret-fallback-minimum-32-chars-long';
    this.hmacSecret = Buffer.from(hmacSeed, 'utf8');
  }

  private resolveSafePath(key: string): string {
    if (key.includes('..') || path.isAbsolute(key)) {
      throw new Error(`Invalid storage path traversal attempt: ${key}`);
    }
    const fullPath = path.resolve(this.baseDir, key);
    if (!fullPath.startsWith(this.baseDir)) {
      throw new Error(`Invalid storage path traversal attempt: ${key}`);
    }
    return fullPath;
  }

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const filePath = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // AES-256-GCM encryption at rest
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(CIPHER_ALGORITHM, this.encryptionKey, iv);
    const encryptedData = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = JSON.stringify({
      version: 1,
      contentType,
      originalLength: buffer.length,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encryptedData.toString('base64'),
    });

    await fs.writeFile(filePath, payload, { mode: 0o600 });
  }

  async getObject(key: string): Promise<StoredObject> {
    const filePath = this.resolveSafePath(key);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content) as EncryptedEnvelope;

      const iv = Buffer.from(parsed.iv, 'hex');
      const authTag = Buffer.from(parsed.authTag, 'hex');
      const encryptedData = Buffer.from(parsed.data, 'base64');

      const decipher = createDecipheriv(CIPHER_ALGORITHM, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

      return {
        buffer: decrypted,
        contentType: parsed.contentType || 'application/octet-stream',
        contentLength: parsed.originalLength || decrypted.length,
      };
    } catch (err) {
      this.logger.error(`Failed to get object from local storage for key ${key}: ${String(err)}`);
      throw new Error(`Storage object not found or corrupted: ${key}`);
    }
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolveSafePath(key);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  createSignedDownloadToken(key: string, expiresInSeconds: number): string {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const dataToSign = `${key}:${expiresAt}`;
    const hmac = createHmac('sha256', this.hmacSecret).update(dataToSign).digest('hex');
    const tokenPayload = Buffer.from(JSON.stringify({ key, expiresAt, sig: hmac })).toString('base64url');
    return tokenPayload;
  }

  verifySignedDownloadToken(token: string): { key: string; valid: boolean } {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as DownloadTokenPayload;
      const { key, expiresAt, sig } = decoded;
      if (!key || typeof expiresAt !== 'number' || !sig) {
        return { key: '', valid: false };
      }

      const now = Math.floor(Date.now() / 1000);
      if (now > expiresAt) {
        return { key, valid: false };
      }

      const expectedSig = createHmac('sha256', this.hmacSecret).update(`${key}:${expiresAt}`).digest('hex');
      const sigBuffer = Buffer.from(sig, 'hex');
      const expectedBuffer = Buffer.from(expectedSig, 'hex');

      if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
        return { key, valid: false };
      }

      return { key, valid: true };
    } catch {
      return { key: '', valid: false };
    }
  }
}
