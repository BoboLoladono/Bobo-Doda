/* Platforma xizmat haqi — YAGONA MANBA.
 *
 * Qoida: xaridor BEPUL. Xizmat haqi faqat mutaxassisdan, faqat QABUL QILINGAN
 * bosqichdan ushlanadi. Bosqich qabul qilinmasa — hech kim hech narsa to'lamaydi.
 */

export const PLATFORM_FEE_PERCENT = 5;

/** Public default for quotes only. Existing contracts use their server snapshot. */
export function getPlatformFeePercent(): number {
  return PLATFORM_FEE_PERCENT;
}

/** Bitta bosqich (yoki jami) summasidan ushlanadigan xizmat haqi.
    Tiyingacha pastga yaxlitlanadi, server fee qoidasi bilan bir xil. */
export function platformFee(gross: number, rateBps = PLATFORM_FEE_PERCENT * 100): number {
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) return 0;
  return Math.floor((gross * rateBps) / 100) / 100;
}

/** Mutaxassis qo'liga tegadigan sof summa. */
export function sellerNet(gross: number, rateBps = PLATFORM_FEE_PERCENT * 100): number {
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) return 0;
  return gross - platformFee(gross, rateBps);
}

