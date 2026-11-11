import { DomainError } from '@/common/errors/domain-error';
import type { StorageProvider, StoredObject } from './storage-provider.interface';

/**
 * DisabledStorageProvider — KYC hujjatlari topshirish va saqlash
 * o'chirilgan (`KYC_SUBMISSION_ENABLED=false`) bo'lganda ishlatiladi.
 *
 * Real storage klasteri (lokal shifrlangan katalog yoki O'zbekiston ichidagi S3)
 * hali ulanmagan yoki o'chirilgan holatda production boot xatosi
 * (`KYC_STORAGE_ENCRYPTION_KEY` talabi) oldini oladi.
 *
 * Agar biror operatsiya (yuklash/ko'rish/o'chirish) chaqirilsa,
 * fail-closed tamoyiliga ko'ra `FEATURE_DISABLED` xatoligini qaytaradi.
 */
export class DisabledStorageProvider implements StorageProvider {
  putObject(_key: string, _buffer: Buffer, _contentType: string): Promise<void> {
    return Promise.reject(
      new DomainError('FEATURE_DISABLED', 'KYC hujjatlarini saqlash hozircha o‘chirilgan'),
    );
  }

  getObject(_key: string): Promise<StoredObject> {
    return Promise.reject(
      new DomainError('FEATURE_DISABLED', 'KYC hujjatlarini ko‘rish hozircha o‘chirilgan'),
    );
  }

  deleteObject(_key: string): Promise<void> {
    return Promise.reject(
      new DomainError('FEATURE_DISABLED', 'KYC hujjatlarini o‘chirish hozircha o‘chirilgan'),
    );
  }

  createSignedDownloadToken(_key: string, _expiresInSeconds: number): string {
    throw new DomainError('FEATURE_DISABLED', 'KYC hujjatlarini yuklab olish havolasi o‘chirilgan');
  }

  verifySignedDownloadToken(_token: string): { key: string; valid: boolean } {
    return { key: '', valid: false };
  }
}
