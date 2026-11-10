import { PaymePayoutProvider } from './payme-payout.provider';
import { DomainError } from '@/common/errors/domain-error';

describe('PaymePayoutProvider', () => {
  const options = {
    endpoint: 'https://checkout.test.paycom.uz/api',
    login: 'test_payout_login',
    key: 'test_payout_key',
    webhookSecret: 'test_payout_webhook_secret',
  };

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects invalid card format', async () => {
    const provider = new PaymePayoutProvider(options);
    await expect(
      provider.createPayout({
        payoutId: 'payout-1',
        sellerId: 'seller-1',
        destinationReference: '1234567890123456', // not 8600 or 9860
        amountTiyin: BigInt(1000000),
        currency: 'UZS',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('accepts valid Uzcard format and sends receipts.p2c', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          receipt: {
            _id: 'payme_receipt_123',
            create_time: 1700000000000,
          },
        },
      }),
    });
    global.fetch = mockFetch;

    const provider = new PaymePayoutProvider(options);

    const result = await provider.createPayout({
      payoutId: 'payout-1',
      sellerId: 'seller-1',
      destinationReference: '8600 1234 5678 9012',
      amountTiyin: BigInt(5000000),
      currency: 'UZS',
    });

    expect(result.providerPayoutId).toBe('payme_receipt_123');
    expect(mockFetch).toHaveBeenCalledWith(
      options.endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from(`${options.login}:${options.key}`).toString('base64')}`,
        }),
      }),
    );
  });

  it('maps 401 auth error to PROVIDER_CONFIG_ERROR', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });
    global.fetch = mockFetch;

    const provider = new PaymePayoutProvider(options);

    await expect(
      provider.createPayout({
        payoutId: 'payout-1',
        sellerId: 'seller-1',
        destinationReference: '9860 1234 5678 9012',
        amountTiyin: BigInt(5000000),
        currency: 'UZS',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_CONFIG_ERROR' });
  });

  it('queries payout state properly', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { state: 4 },
      }),
    });
    global.fetch = mockFetch;

    const provider = new PaymePayoutProvider(options);

    const res = await provider.queryPayout('payme_receipt_123');
    expect(res.state).toBe('SUCCEEDED');
    expect(res.providerReference).toBe('payme_receipt_123');
  });

  it('verifies webhook with basic auth', () => {
    const provider = new PaymePayoutProvider(options);
    const authHeader = `Basic ${Buffer.from(`${options.login}:${options.key}`).toString('base64')}`;
    const payload = {
      eventId: 'evt-100',
      providerPayoutId: 'payout-100',
      status: 'SUCCEEDED',
      amount: 5000000,
      currency: 'UZS',
    };

    const verified = provider.verifyWebhook({
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers: { authorization: authHeader },
    });

    expect(verified.status).toBe('SUCCEEDED');
    expect(verified.providerPayoutId).toBe('payout-100');
    expect(verified.amountTiyin).toBe(BigInt(5000000));
  });
});
