/**
 * Platforma komissiyasi — yangi shartnomalar yaratilishida snapshot
 * sifatida `Contract.platformFeeRateBpsSnapshot` ga yoziladi.
 * Eski shartnomalar o‘zining DB’dagi `platformFeeRateBpsSnapshot`
 * qiymatini (masalan, 500 bps = 5%) saqlab qoladi.
 *
 * Frontend `lib/fees.ts#PLATFORM_FEE_PERCENT = 10` bilan BIR XIL (10% = 1000 bps).
 */
export const PLATFORM_FEE_RATE_BPS = 1000;

/** Floor yaxlitlash (ADR-01) — qoldiq har doim platformaga (keyingi bosqichda `PLATFORM_REVENUE`ga) ketadi. */
export function computePlatformFee(agreedAmountTiyin: bigint, rateBps: number): bigint {
  return (agreedAmountTiyin * BigInt(rateBps)) / 10_000n;
}
