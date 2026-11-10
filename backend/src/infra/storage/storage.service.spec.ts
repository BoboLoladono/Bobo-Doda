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

  describe('Upload & Delete with SigV4 Signing', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('signs upload request with AWS SigV4 when access and secret keys are provided', async () => {
      const mockConfig = {
        isProduction: false,
        s3: {
          endpoint: 'https://s3.tashkent.bobololadono.uz',
          region: 'uz-tashkent-1',
          accessKey: 'MY_ACCESS_KEY',
          secretKey: 'MY_SECRET_KEY',
          bucketUploads: 'bobololadono-uploads',
          bucketKyc: 'bobololadono-kyc',
        },
      } as unknown as AppConfigService;

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      global.fetch = mockFetch;

      const storage = new StorageService(mockConfig);
      const res = await storage.upload({
        bucket: 'bobololadono-uploads',
        key: 'avatars/avatar-1.png',
        data: Buffer.from('test-image-binary-data'),
        contentType: 'image/png',
      });

      expect(res.key).toBe('avatars/avatar-1.png');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://s3.tashkent.bobololadono.uz/bobololadono-uploads/avatars/avatar-1.png',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'content-type': 'image/png',
            authorization: expect.stringMatching(/^AWS4-HMAC-SHA256 Credential=MY_ACCESS_KEY\/\d{8}\/uz-tashkent-1\/s3\/aws4_request/),
            'x-amz-content-sha256': expect.any(String),
            'x-amz-date': expect.any(String),
          }),
        }),
      );
    });

    it('throws DomainError when S3 upload fails with HTTP error', async () => {
      const mockConfig = {
        isProduction: false,
        s3: {
          endpoint: 'https://s3.tashkent.bobololadono.uz',
          region: 'uz-tashkent-1',
          accessKey: 'key',
          secretKey: 'sec',
        },
      } as unknown as AppConfigService;

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      global.fetch = mockFetch;

      const storage = new StorageService(mockConfig);
      await expect(
        storage.upload({
          bucket: 'bobololadono-uploads',
          key: 'test.jpg',
          data: Buffer.from('data'),
          contentType: 'image/jpeg',
        }),
      ).rejects.toThrow(DomainError);
    });

    it('throws DomainError when network error occurs during upload', async () => {
      const mockConfig = {
        isProduction: false,
        s3: {
          endpoint: 'https://s3.tashkent.bobololadono.uz',
          region: 'uz-tashkent-1',
          accessKey: 'key',
          secretKey: 'sec',
        },
      } as unknown as AppConfigService;

      global.fetch = jest.fn().mockRejectedValue(new Error('Network connection refused'));

      const storage = new StorageService(mockConfig);
      await expect(
        storage.upload({
          bucket: 'bobololadono-uploads',
          key: 'test.jpg',
          data: Buffer.from('data'),
          contentType: 'image/jpeg',
        }),
      ).rejects.toThrow(DomainError);
    });

    it('signs and executes delete properly', async () => {
      const mockConfig = {
        isProduction: false,
        s3: {
          endpoint: 'https://s3.tashkent.bobololadono.uz',
          region: 'uz-tashkent-1',
          accessKey: 'key',
          secretKey: 'sec',
        },
      } as unknown as AppConfigService;

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 204,
      });
      global.fetch = mockFetch;

      const storage = new StorageService(mockConfig);
      const success = await storage.delete('bobololadono-uploads', 'avatars/old.jpg');

      expect(success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://s3.tashkent.bobololadono.uz/bobololadono-uploads/avatars/old.jpg',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            authorization: expect.stringContaining('AWS4-HMAC-SHA256'),
          }),
        }),
      );
    });
  });
});
