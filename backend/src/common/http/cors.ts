/**
 * Bo'lim 3 (admin.bobololadono.uz) — `staff/*` yo'llari uchun ALOHIDA CORS
 * ro'yxat (`STAFF_CORS_ORIGINS`), marketplace'dan (`CORS_ORIGINS`) mustaqil
 * — security audit topilmasi 3a: yagona umumiy ro'yxat staff sessiyasiga
 * HECH QANDAY izolyatsiya bermas edi.
 *
 * YAGONA MANBA: `main.ts` (real server) va `test/support/build-app.ts`
 * (e2e testlar) ILGARI buni ikki marta, qo'lda ko'chirib yozgan edi —
 * ikkinchi security ko'rib chiqishida bu aniqlandi: `cors.e2e-spec.ts`
 * faqat NUSXANI (`build-app.ts`) sinardi, haqiqiy `main.ts`ni emas, va
 * ikkalasi vaqt o'tishi bilan ajralib ketishi mumkin edi.
 *
 * Yo'l tekshiruvi KICHIK HARFGA keltirilgan — Express marshrutlash katta-
 * kichik harfni farqlamaydi (`/api/v1/STAFF/...` ham `staff/*` handler'ga
 * yetib boradi), shuning uchun taqqoslash ham katta-kichik harfsiz bo'lishi
 * shart (security audit topilmasi: aks holda katta harfli variant staff
 * yo'lini marketplace CORS ro'yxati bilan tekshirardi).
 */
export interface CorsDelegateConfig {
  corsOrigins: string[];
  staffCorsOrigins: string[];
}

export interface CorsDelegateOptions {
  origin: string[];
  credentials: boolean;
  exposedHeaders: string[];
}

export type CorsDelegateRequest = { url?: string };
export type CorsDelegateCallback = (err: Error | null, options: CorsDelegateOptions) => void;

export function buildStaffAwareCorsDelegate(
  config: CorsDelegateConfig,
  staffPathPrefix: string,
): (req: CorsDelegateRequest, callback: CorsDelegateCallback) => void {
  const normalizedPrefix = staffPathPrefix.toLowerCase();
  return (req, callback) => {
    const path = typeof req.url === 'string' ? req.url.toLowerCase() : '';
    const isStaffRoute = path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`);
    const origins = isStaffRoute ? config.staffCorsOrigins : config.corsOrigins;
    callback(null, {
      origin: origins,
      credentials: true,
      exposedHeaders: ['x-request-id'],
    });
  };
}

