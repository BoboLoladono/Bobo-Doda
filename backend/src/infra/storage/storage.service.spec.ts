import { StorageService } from './storage.service';
import { AppConfigService } from '@/config/app-config.service';
import { DomainError } from '@/common/errors/domain-error';

describe('StorageService (547-sonli Qonun)', () => {
  it('production muhitida xorijiy AWS S3 endpoint berilsa DomainError tashlaydi', () => {
    const mockConfig = {
      isProduction: true,
      s3: {
        endpoint: 'https://bobololadono-kyc.s3.amazonaws.com',
        region: 'us-east-1',
        accessKey: 'key',
        secretKey: 'sec',
        bucketUploads: 'bobololadono-uploads',
        bucketKyc: 'bobololadono-kyc',
      },
    } as unknown as AppConfigService;

    expect(() => new StorageService(mockConfig)).toThrow(DomainError);
  });

  it('production muhitida O‘zbekiston ichki S3/MinIO endpointi bilan muvaffaqiyatli ishga tushadi', () => {
    const mockConfig = {
      isProduction: true,
      s3: {
        endpoint: 'https://s3.tashkent.bobololadono.uz',
        region: 'uz-tashkent-1',
        accessKey: 'key',
        secretKey: 'sec',
        bucketUploads: 'bobololadono-uploads',
        bucketKyc: 'bobololadono-kyc',
      },
    } as unknown as AppConfigService;

    expect(() => new StorageService(mockConfig)).not.toThrow();
  });

  it('getPublicUrl bucket va key bo‘yicha to‘g‘ri URL shakllantiradi', () => {
    const mockConfig = {
      isProduction: false,
      s3: {
        endpoint: 'http://localhost:9000',
        region: 'uz-tashkent-1',
        accessKey: 'key',
        secretKey: 'sec',
        bucketUploads: 'bobololadono-uploads',
        bucketKyc: 'bobololadono-kyc',
      },
    } as unknown as AppConfigService;

    const storage = new StorageService(mockConfig);
    const url = storage.getPublicUrl('bobololadono-uploads', 'avatars/user-123.jpg');
    expect(url).toBe('http://localhost:9000/bobololadono-uploads/avatars/user-123.jpg');
  });
});
