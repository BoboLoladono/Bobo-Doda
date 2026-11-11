import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider (Secure At-Rest Encrypted Storage)', () => {
  let tempDir: string;
  let provider: LocalStorageProvider;
  const testKeyHex = '11'.repeat(32);

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kyc-storage-test-'));
    provider = new LocalStorageProvider(tempDir, testKeyHex);
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('encrypts files at rest using AES-256-GCM', async () => {
    const rawData = Buffer.from('CONFIDENTIAL_PASSPORT_NUMBER_AA1234567');
    const objectKey = 'sellers/user-1/doc-1.png';

    await provider.putObject(objectKey, rawData, 'image/png');

    // Read the physical file from disk directly
    const diskContent = await fs.readFile(path.join(tempDir, objectKey), 'utf8');
    const parsed = JSON.parse(diskContent);

    expect(parsed.version).toBe(1);
    expect(parsed.contentType).toBe('image/png');
    expect(parsed.iv).toBeDefined();
    expect(parsed.authTag).toBeDefined();
    expect(parsed.data).toBeDefined();

    // Plaintext confidential data must NEVER appear unencrypted on disk
    expect(diskContent).not.toContain('CONFIDENTIAL_PASSPORT_NUMBER_AA1234567');
  });

  it('retrieves and decrypts stored objects cleanly', async () => {
    const rawData = Buffer.from('CONFIDENTIAL_DATA_PAYLOAD_TEST');
    const objectKey = 'sellers/user-2/doc-2.pdf';

    await provider.putObject(objectKey, rawData, 'application/pdf');
    const retrieved = await provider.getObject(objectKey);

    expect(retrieved.contentType).toBe('application/pdf');
    expect(retrieved.contentLength).toBe(rawData.length);
    expect(retrieved.buffer.toString('utf8')).toBe('CONFIDENTIAL_DATA_PAYLOAD_TEST');
  });

  it('prevents path traversal attempts', async () => {
    const maliciousKey = '../../../../etc/passwd';
    await expect(
      provider.putObject(maliciousKey, Buffer.from('test'), 'text/plain'),
    ).rejects.toThrow();
  });

  it('generates valid short-lived HMAC download tokens', () => {
    const objectKey = 'sellers/user-1/doc-1.png';
    const token = provider.createSignedDownloadToken(objectKey, 60);

    const verified = provider.verifySignedDownloadToken(token);
    expect(verified.valid).toBe(true);
    expect(verified.key).toBe(objectKey);
  });

  it('rejects expired or tampered download tokens', () => {
    const objectKey = 'sellers/user-1/doc-1.png';
    // Expired token (-10 seconds)
    const expiredToken = provider.createSignedDownloadToken(objectKey, -10);
    const verifiedExpired = provider.verifySignedDownloadToken(expiredToken);
    expect(verifiedExpired.valid).toBe(false);

    // Tampered token
    const validToken = provider.createSignedDownloadToken(objectKey, 300);
    const decoded = JSON.parse(Buffer.from(validToken, 'base64url').toString('utf8'));
    decoded.key = 'sellers/user-tampered/doc-1.png'; // Tampering with key
    const tamperedToken = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    const verifiedTampered = provider.verifySignedDownloadToken(tamperedToken);
    expect(verifiedTampered.valid).toBe(false);
  });
});
