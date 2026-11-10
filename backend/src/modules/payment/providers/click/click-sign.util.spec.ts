import { computeClickSign, verifyClickSign } from './click-sign.util';

describe('ClickSignUtil', () => {
  const secretKey = 'test-click-secret';

  it('computes MD5 signature for Prepare action (action=0)', () => {
    const sign = computeClickSign({
      clickTransId: '12345678',
      serviceId: '9999',
      secretKey,
      merchantTransId: 'pay-001',
      amount: '50000',
      action: 0,
      signTime: '2026-11-09 18:00:00',
    });

    expect(typeof sign).toBe('string');
    expect(sign.length).toBe(32);

    const verified = verifyClickSign({
      clickTransId: '12345678',
      serviceId: '9999',
      secretKey,
      merchantTransId: 'pay-001',
      amount: '50000',
      action: 0,
      signTime: '2026-11-09 18:00:00',
      signString: sign,
    });
    expect(verified).toBe(true);
  });

  it('computes MD5 signature for Complete action (action=1) with merchantPrepareId', () => {
    const sign = computeClickSign({
      clickTransId: '12345678',
      serviceId: '9999',
      secretKey,
      merchantTransId: 'pay-001',
      merchantPrepareId: 'prep-001',
      amount: '50000',
      action: 1,
      signTime: '2026-11-09 18:00:00',
    });

    expect(typeof sign).toBe('string');
    expect(sign.length).toBe(32);

    const verified = verifyClickSign({
      clickTransId: '12345678',
      serviceId: '9999',
      secretKey,
      merchantTransId: 'pay-001',
      merchantPrepareId: 'prep-001',
      amount: '50000',
      action: 1,
      signTime: '2026-11-09 18:00:00',
      signString: sign.toUpperCase(), // case-insensitive check
    });
    expect(verified).toBe(true);
  });

  it('rejects tampered signString or wrong secretKey', () => {
    const validSign = computeClickSign({
      clickTransId: '12345678',
      serviceId: '9999',
      secretKey,
      merchantTransId: 'pay-001',
      amount: '50000',
      action: 0,
      signTime: '2026-11-09 18:00:00',
    });

    expect(
      verifyClickSign({
        clickTransId: '12345678',
        serviceId: '9999',
        secretKey: 'wrong-key',
        merchantTransId: 'pay-001',
        amount: '50000',
        action: 0,
        signTime: '2026-11-09 18:00:00',
        signString: validSign,
      }),
    ).toBe(false);

    expect(
      verifyClickSign({
        clickTransId: '12345678',
        serviceId: '9999',
        secretKey,
        merchantTransId: 'pay-001',
        amount: '50000',
        action: 0,
        signTime: '2026-11-09 18:00:00',
        signString: 'invalid_hash_string',
      }),
    ).toBe(false);
  });
});
