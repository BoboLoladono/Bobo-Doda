/**
 * Content-Security-Policy — YAGONA MANBA.
 *
 * Nega alohida fayl: CSP ikki joyda e'lon qilinadi — `next.config.mjs`
 * (ilova header'lari) va `netlify.toml` (edge header'lari). Ikkalasi ham
 * javobga qo'shilsa, brauzer ULARNING KESISHMASINI qo'llaydi: biri ruxsat
 * bergan narsani ikkinchisi taqiqlasa — TAQIQ yutadi. Shuning uchun ular
 * bir-biridan ajralib ketmasligi kerak.
 *
 * `scripts/check-csp.cjs` `netlify.toml` dagi qatorni shu yerdagi qiymat
 * bilan solishtiradi va farq bo'lsa `npm run verify` ni yiqitadi.
 *
 * ─── BACKEND ULANGANDA ───────────────────────────────────────────────
 * `connect-src` — brauzer QAYSI manzillarga `fetch`/XHR/WebSocket qila
 * olishini belgilaydi. Hozir u faqat `'self'`, ya'ni API boshqa domenda
 * bo'lsa (`https://api.bobololadono.uz`) BARCHA so'rov bloklanadi. Bu eng
 * ko'p vaqt yo'qotadigan tuzoq: kod to'g'ri, tarmoq to'g'ri, lekin
 * brauzer jimgina rad etadi.
 *
 * Yechim: deploy muhitida `NEXT_PUBLIC_API_URL` ni bering —
 * u avtomatik `connect-src` ga qo'shiladi. WebSocket uchun `wss://`
 * varianti ham o'zi qo'shiladi (real-time chat/bildirishnomalar uchun).
 */

/** Manzildan faqat origin qismini oladi (yo'l/parametrlarsiz). */
function toOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** `https://api.x.uz` → `wss://api.x.uz` (real-time kanal uchun) */
function toWebSocketOrigin(origin) {
  if (!origin) return null;
  if (origin.startsWith("https://")) return `wss://${origin.slice(8)}`;
  if (origin.startsWith("http://")) return `ws://${origin.slice(7)}`;
  return null;
}

/**
 * Joriy CSP satrini quradi.
 * @param {string | undefined} apiUrl `NEXT_PUBLIC_API_URL` (ixtiyoriy)
 */
export function buildCsp(apiUrl = process.env.NEXT_PUBLIC_API_URL) {
  const apiOrigin = toOrigin(apiUrl);
  const wsOrigin = toWebSocketOrigin(apiOrigin);

  /* Bir xil originda turgan backend uchun hech narsa qo'shilmaydi —
     `'self'` allaqachon qamrab oladi. */
  const connectSrc = [
    "'self'",
    apiOrigin,
    wsOrigin,
    "https://accounts.google.com",
    "https://www.googleapis.com",
    "https://oauth2.googleapis.com",
    "https://*.google-analytics.com",
    "https://*.analytics.google.com",
    "https://*.googletagmanager.com",
  ].filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    /* Next.js hidratsiya uchun script'da 'unsafe-inline' talab qiladi */
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://apis.google.com https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    /* Shriftlar `@fontsource` orqali LOKAL — Google Fonts hosti kerak emas */
    "font-src 'self'",
    /* data: — SVG placeholder va portfolio rasmlari uchun */
    "img-src 'self' data: blob: https://*.googleusercontent.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com",
    `connect-src ${connectSrc}`,
    "frame-src 'self' https://accounts.google.com https://www.googletagmanager.com",
    /* clickjacking himoyasi */
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** Barcha javoblarga qo'yiladigan xavfsizlik header'lari. */
export function securityHeaders(apiUrl) {
  return [
    { key: "Content-Security-Policy", value: buildCsp(apiUrl) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    /* HSTS — HTTPS'ni majburiy qiladi (downgrade/SSL-strip himoyasi).
       Netlify TLS'ni o'zi tugatadi, lekin header e'lon qilinmasa brauzer
       birinchi so'rovni HTTP orqali yuborishi mumkin. */
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
  ];
}
