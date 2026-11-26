import { computePlatformFee, PLATFORM_FEE_RATE_BPS } from './fee.constant';

describe('computePlatformFee (ADR-01 — floor)', () => {
  it('10% (1000 bps) — aniq bo‘linadigan summa', () => {
    expect(PLATFORM_FEE_RATE_BPS).toBe(1000);
    expect(computePlatformFee(100_000_00n, PLATFORM_FEE_RATE_BPS)).toBe(10_000_00n); // 100 000 so'm -> 10 000 so'm
  });

  it('tarixiy 5% (500 bps) snapshot — saqlanib qoladi', () => {
    expect(computePlatformFee(100_000_00n, 500)).toBe(5_000_00n); // 100 000 so'm -> 5 000 so'm
  });

  it('floor — qoldiq PASTGA yaxlitlanadi (tepaga emas)', () => {
    // 999 tiyin * 500 / 10000 = 49.95 -> floor 49
    expect(computePlatformFee(999n, 500)).toBe(49n);
  });

  it('nolga yaqin summa', () => {
    expect(computePlatformFee(1n, 500)).toBe(0n); // 1 tiyin * 5% floor = 0
  });

  it('0 bps — komissiya yo‘q', () => {
    expect(computePlatformFee(1_000_000n, 0)).toBe(0n);
  });
});
