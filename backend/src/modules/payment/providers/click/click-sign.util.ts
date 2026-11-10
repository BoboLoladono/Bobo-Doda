import { createHash, timingSafeEqual } from 'node:crypto';

export interface VerifyClickSignParams {
  clickTransId: string | number;
  serviceId: string | number;
  secretKey: string;
  merchantTransId: string;
  merchantPrepareId?: string | number | null;
  amount: string | number;
  action: number;
  signTime: string;
  signString: string;
}

export function computeClickSign(params: Omit<VerifyClickSignParams, 'signString'>): string {
  const parts = [
    String(params.clickTransId),
    String(params.serviceId),
    params.secretKey,
    params.merchantTransId,
  ];

  if (params.action === 1 && params.merchantPrepareId !== undefined && params.merchantPrepareId !== null) {
    parts.push(String(params.merchantPrepareId));
  }

  // Click format: amount format must match what click sends (e.g. 10000 or 10000.00)
  parts.push(String(params.amount));
  parts.push(String(params.action));
  parts.push(params.signTime);

  return createHash('md5').update(parts.join('')).digest('hex').toLowerCase();
}

export function verifyClickSign(params: VerifyClickSignParams): boolean {
  if (!params.signString || !params.secretKey) return false;
  const computed = computeClickSign(params);
  const computedBuf = Buffer.from(computed, 'utf8');
  const signBuf = Buffer.from(params.signString.toLowerCase(), 'utf8');
  if (computedBuf.length !== signBuf.length) return false;
  return timingSafeEqual(computedBuf, signBuf);
}
