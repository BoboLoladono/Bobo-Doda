import { DisabledStorageProvider } from './disabled-storage.provider';

describe('DisabledStorageProvider (Fail-Closed Storage Stub)', () => {
  let provider: DisabledStorageProvider;

  beforeEach(() => {
    provider = new DisabledStorageProvider();
  });

  it('rejects putObject with FEATURE_DISABLED', async () => {
    await expect(
      provider.putObject('test-key', Buffer.from('data'), 'image/png'),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('rejects getObject with FEATURE_DISABLED', async () => {
    await expect(provider.getObject('test-key')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });

  it('rejects deleteObject with FEATURE_DISABLED', async () => {
    await expect(provider.deleteObject('test-key')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });

  it('throws on createSignedDownloadToken with FEATURE_DISABLED', () => {
    expect(() => provider.createSignedDownloadToken('test-key', 300)).toThrow(
      expect.objectContaining({ code: 'FEATURE_DISABLED' }),
    );
  });

  it('returns valid: false on verifySignedDownloadToken', () => {
    const result = provider.verifySignedDownloadToken('any-token');
    expect(result).toEqual({ key: '', valid: false });
  });
});
