import { z } from 'zod';

/**
 * Muhit o'zgaruvchilari sxemasi (Zod).
 *
 * MAJBURIY qiymat yo'q bo'lsa app boot BO'LMAYDI — `validateEnv` xato tashlaydi
 * va NestFactory ko'tarilmaydi. Bu ataylab: yarim-sozlangan server ishga
 * tushib, birinchi so'rovda 500 berishdan ko'ra, umuman ko'tarilmagani xavfsiz.
 *
 * Bosqichlararo qat'iylashtirish:
 *  • Bosqich 1 — DATABASE_URL, REDIS_URL majburiy.
 *  • Bosqich 2 — JWT_* sirlari majburiy (≥32 belgi).
 *  • Bosqich 5 — NODE_ENV=production da PAYME / CLICK sirlari majburiy (fail closed).
 */

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** `"15m"`, `"30d"`, `"8h"` — `duration.util.ts#parseDurationMs` bilan BIR XIL qoida. */
const DURATION_SPEC = z
  .string()
  .regex(/^\d+[smhd]$/, 'Format: son + birlik (s/m/h/d), masalan "15m", "30d"');

export const envSchema = z
  .object({
    // ── Runtime ──────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SWAGGER_ENABLED: booleanish.default('true'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform(csv),
    // Admin domen ko'chirishi (2026-09, bo'lim 3) — security audit topilmasi
    // 3a: yagona umumiy CORS ro'yxat staff sessiyasiga HECH QANDAY izolyatsiya
    // bermaydi (`app.bobololadono.uz`dagi har qanday skript `/staff/auth/refresh`ni
    // credentialed so'rov bilan chaqira olardi). `staff/*` yo'llari endi
    // ALOHIDA, TORROQ ro'yxatdan o'tadi (`main.ts`dagi CORS delegate) — faqat
    // admin.bobololadono.uz, hech qachon app.bobololadono.uz. Marketplace `CORS_ORIGINS`
    // esa o'zgarishsiz qoladi (admin frontend staff/* dan tashqari umumiy
    // endpoint chaqirmaydi).
    STAFF_CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform(csv),
    // Bosqich 12, bo'lim 38 — reverse proxy (Railway/Nginx/Cloudflare va h.k.)
    // ortida `req.ip`/`X-Forwarded-For` to'g'ri o'qilishi uchun. Ko'r-ko'rona
    // `true` (hamma narsaga ishonish) EMAS — sukut `false` (ishonilmaydi).
    // Qabul qilinadigan qiymatlar: "false", "true", butun son (hop soni)
    // yoki vergul bilan ajratilgan ishonchli IP/CIDR ro'yxati (masalan
    // "loopback,10.0.0.0/8") — Express `trust proxy`ning o'zi parslaydi.
    TRUST_PROXY: z.string().default('false'),

    // ── Datastores (MAJBURIY — Bosqich 1) ────────────────────────────────
    // A4 — ikki alohida rol, ikki alohida URL:
    //   DATABASE_URL           → `bobololadono_app`      (runtime, kam huquq;
    //                            append-only jadvallarga UPDATE/DELETE yo'q)
    //   DATABASE_MIGRATION_URL → `bobololadono_migrator` (DDL / CREATE EXTENSION /
    //                            GRANT — faqat `prisma migrate deploy`)
    // Ikkalasi ham majburiy: schema `directUrl` uni talab qiladi va
    // "append-only kodda emas, DB darajasida" faqat rol ajratilganda ishlaydi.
    DATABASE_URL: z.string().min(1, 'DATABASE_URL majburiy').url(),
    DATABASE_MIGRATION_URL: z.string().min(1, 'DATABASE_MIGRATION_URL majburiy').url(),
    REDIS_URL: z.string().min(1, 'REDIS_URL majburiy').url(),
    // F1 — boot paytida "current_user = DB_APP_ROLE, append-only buzilmagan,
    // kengaytmalar bor" tekshiradi; yiqilsa ilova ko'tarilmaydi (fail closed).
    // "off" faqat dev/test qulayligi uchun — pastda production'da RAD ETILADI.
    DB_ROLE_ASSERTION: z
      .enum(['on', 'off'])
      .default('on')
      .transform((v) => v === 'on'),
    // T1 — runtime rol nomi QATTIQ YOZILMAGAN: ba'zi managed Postgres
    // provayderlari rol nomiga cheklov qo'yadi (prefiks, uzunlik, rezervlangan
    // so'z). Postgres kvotalanmagan identifikator qoidasi: kichik harf/pastki
    // chiziq bilan boshlanadi, ≤63 belgi. `roles.sql`/migratsiya shu qiymatni
    // DB darajasidagi GUC (`bobololadono.app_role`) orqali oladi.
    DB_APP_ROLE: z
      .string()
      .regex(
        /^[a-z_][a-z0-9_]{0,62}$/,
        'DB_APP_ROLE — kvotalanmagan Postgres identifikatori bo\'lishi shart (kichik harf/pastki chiziq bilan boshlanadi, ≤63 belgi)',
      )
      .default('bobololadono_app'),

    // ── S3 / MinIO (O'zbekiston Shaxsiy Ma'lumotlar Suvereniteti — 547-sonli Qonun 27¹-modda) ──
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('uz-tashkent-1'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET_UPLOADS: z.string().default('bobololadono-uploads'),
    S3_BUCKET_KYC: z.string().default('bobololadono-kyc'),
    KYC_SUBMISSION_ENABLED: booleanish.default('false'),
    DATA_RESIDENCY_COUNTRY: z.string().default('UZ'),
    DATA_RESIDENCY_ASSERTION: booleanish.default('true'),

    // ── Auth (Bosqich 2 — MAJBURIY) ─────────────────────────────────────
    // Marketplace (User) va Staff — ATAYLAB ALOHIDA ACCESS sirlar (talab:
    // "Staff auth alohida bo'lsin"). Bir xil sir bo'lganda, guard'dagi bitta
    // xato marketplace tokenini staff route'da qabul qilib qo'yishi mumkin
    // edi — alohida sir bilan bu KRIPTOGRAFIK jihatdan imkonsiz.
    //
    // DIQQAT: "REFRESH_SECRET" YO'Q (ataylab) — refresh token JWT EMAS,
    // opaque tasodifiy satr (`opaque-token.util.ts`), DB'da SHA-256 hash
    // bilan saqlanadi va QIDIRUV orqali tekshiriladi. Imzolash siri kerak
    // emas — bo'lganda ham xavfsizlikka hech narsa qo'shmasdi (token
    // o'zi 256 bit entropiyaga ega), faqat ishlatilmaydigan konfiguratsiya
    // bo'lib qolardi.
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET kamida 32 belgi'),
    JWT_STAFF_ACCESS_SECRET: z.string().min(32, 'JWT_STAFF_ACCESS_SECRET kamida 32 belgi'),
    // `\d+[smhd]` — `duration.util.ts#parseDurationMs` VA `TokenService`
    // (`jsonwebtoken`ga uzatilishidan oldin) ANIQ shu formatni kutadi.
    JWT_ACCESS_TTL: DURATION_SPEC.default('15m'),
    // Refresh — opaque token muddati; faqat `RefreshToken.expiresAt` /
    // `StaffSession.expiresAt` hisoblash uchun (`parseDurationMs` formati).
    JWT_REFRESH_TTL: DURATION_SPEC.default('30d'),
    JWT_STAFF_ACCESS_TTL: DURATION_SPEC.default('15m'),
    JWT_STAFF_REFRESH_TTL: DURATION_SPEC.default('8h'),

    // Bosqich 11, bo'lim 9 — TOTP siri at-rest shifrlash kaliti (AES-256-GCM,
    // `totp-secret-cipher.util.ts`). `JWT_*_SECRET` bilan BIR XIL qatlam:
    // HAR DOIM majburiy (dev/test/prod) — provayder test-sirlaridagi kabi
    // "berilmasa dev-only sukut" YO'Q, chunki bu asosiy kriptografik
    // material (parol/JWT sirlari bilan bir darajada sezgir).
    STAFF_TOTP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'STAFF_TOTP_ENCRYPTION_KEY 64 ta hex belgi (32 bayt) bo‘lishi shart'),

    // ── To'lov gateway'lari (Bosqich 5) ────────────────────────────────
    // Bosqich 23 (production launch) — `PAYOUTS_ENABLED` bilan BIR XIL
    // naqsh: Payme haqiqiy credential hali mavjud emas bo'lsa, production
    // "soxta TEST provider" bilan emas, ATAYLAB `PAYMENTS_ENABLED=false`
    // bilan ishga tushishi mumkin (`payment.module.ts` HAR DOIM
    // `DisabledPaymentProvider` qaytaradi, `PAYMENT_PROVIDER`/`NODE_ENV`dan
    // qat'i nazar). Sukut `true` — mavjud dev/test oqimlari o'zgarishsiz.
    PAYMENTS_ENABLED: booleanish.default('true'),
    // `PAYMENT_PROVIDER` — provider registry kaliti (`payment.module.ts`),
    // FAQAT `PAYMENTS_ENABLED=true` bo'lsa ma'noga ega. Real PAYME/CLICK
    // protokoli hali IMPLEMENT QILINMAGAN (bo'lim 7: repo/docs'da signature/
    // callback spec yo'q, o'ylab topilmaydi) — ularni tanlash hozircha
    // HAR QANDAY muhitda boot vaqtida rad etiladi
    // (`assertPaymentProviderSupported`). `TEST` — faqat dev/test uchun,
    // production'da (`PAYMENTS_ENABLED=true` bo'lsa) pastdagi `superRefine`
    // fail-fast qiladi.
    PAYMENT_PROVIDER: z.enum(['TEST', 'PAYME', 'CLICK']).default('TEST'),
    // Test provider HMAC siri — faqat dev/test. Berilmasa dev-only sukut
    // qiymat ishlatiladi (`payment.module.ts`) — production'da TEST provider
    // umuman tanlanolmaydi, shuning uchun bu yerda MAJBURIY emas.
    PAYMENT_TEST_WEBHOOK_SECRET: z.string().min(16).optional(),
    // Bosqich 12 — Payme Merchant API rasmiy protokoli implement qilindi
    // (developer.help.paycom.uz). Basic auth: Payme Business bizga shu
    // login/key juftligini yuboradi (`Authorization: Basic base64(login:key)`).
    PAYME_MERCHANT_ID: z.string().optional(),
    PAYME_LOGIN: z.string().optional(),
    PAYME_KEY: z.string().optional(),
    // GET-checkout URL bazasi — `https://checkout.paycom.uz` (prod) yoki
    // `https://test.paycom.uz` (sandbox). Http(s) URL, oxirida `/` yo'q.
    PAYME_CHECKOUT_URL: z.string().url().optional(),
    // CLICK — Rasmiy Click Merchant API protokoli (Prepare / Complete)
    CLICK_MERCHANT_ID: z.string().optional(),
    CLICK_SERVICE_ID: z.string().optional(),
    CLICK_SECRET_KEY: z.string().optional(),
    CLICK_CHECKOUT_URL: z.string().url().default('https://my.click.uz/services/pay'),

    // ── Payout rail (Haqiqiy pul yechish tizimi — Payme P2C / Bank kartalari) ──
    PAYOUT_PROVIDER: z.enum(['TEST', 'PAYME', 'CLICK']).default('TEST'),
    PAYOUT_TEST_WEBHOOK_SECRET: z.string().min(16).optional(),
    PAYOUTS_ENABLED: booleanish.default('true'),
    PAYME_PAYOUT_ENDPOINT: z.string().url().default('https://checkout.paycom.uz/api'),
    PAYME_PAYOUT_LOGIN: z.string().optional(),
    PAYME_PAYOUT_KEY: z.string().optional(),
    PAYOUT_WEBHOOK_SECRET: z.string().min(16).optional(),

    // ── Reconciliation (Bosqich 9, bo'lim 15/17/33/53) — arbitrary
    // hardcode YO'Q, hammasi konfiguratsiya orqali. Default'lar: "juda tez
    // emas, juda sekin ham emas" — provider yukini himoya qiladi (bo'lim
    // 35/55), lekin stuck operatsiyalarni ham asossiz uzoq ushlab turmaydi.
    PAYMENT_RECONCILE_AFTER_SECONDS: z.coerce.number().int().positive().default(300),
    REFUND_RECONCILE_AFTER_SECONDS: z.coerce.number().int().positive().default(300),
    PAYOUT_RECONCILE_AFTER_SECONDS: z.coerce.number().int().positive().default(300),
    // Bo'lim 17 — bitta run BUTUN DB'ni scan qilmasin (unbounded scan taqiqi).
    RECONCILIATION_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),
    // Bo'lim 52/53 — rejalashtirilgan job oralig'i (BullMQ repeatable job).
    RECONCILIATION_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),

    // ── Telegram support (Bosqich 6) ──────────────────────────────────
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_SUPPORT_CHAT_ID: z.string().optional(),

    // ── SMS provider (Bosqich 2 interfeys, Bosqich 13 PlayMobile, Bosqich 23 TextUp) ──
    // `CONSOLE` — real SMS yubormaydi (konsolga chiqaradi), FAQAT dev/test.
    // `PLAYMOBILE` — Bosqich 13'da rasmiy PLAY MOBILE SMS-Broker HTTP API
    // (playmobile.uz/instruction/, PDF spec) asosida implement qilindi.
    // `TEXTUP` — Bosqich 23, PRODUCTION uchun TANLANGAN provider, Bobololadono
    // o'z hisobi bilan. Basic auth EMAS — ikkita ALOHIDA host bilan
    // email/parol login + Bearer accessToken oqimi (`textup.provider.ts`
    // va `textup-token-manager.ts` izohiga qarang). Eskiz — rasmiy texnik
    // hujjat (developer.help/Postman documenter) JS-render qilinadigan
    // sahifa bo'lib chiqdi, statik fetch o'qiy olmadi — CLICK bilan bir
    // xil sabab, implement QILINMADI.
    SMS_PROVIDER: z.enum(['CONSOLE', 'PLAYMOBILE', 'TEXTUP']).default('CONSOLE'),
    // PlayMobile rasmiy hujjatida `<base-url>` merchant-specific (portalda
    // ro'yxatdan o'tgach beriladi, hujjatda qattiq yozilmagan) — shuning
    // uchun majburiy env, qattiq yozilgan default YO'Q.
    PLAYMOBILE_API_URL: z.string().url().optional(),
    PLAYMOBILE_LOGIN: z.string().optional(),
    PLAYMOBILE_PASSWORD: z.string().optional(),
    // Bo'lim 4 — rasmiy chegara: "не более, чем из 11 разрешенных символов".
    PLAYMOBILE_SENDER: z.string().max(11).optional(),
    // Bosqich 23 (v4) — TextUp, rasmiy hujjat asosida. Ikkita ALOHIDA host
    // (auth/SMS) — qattiq yozilgan default YO'Q (PLAYMOBILE_API_URL bilan
    // bir xil falsafa: sandbox/muhit almashtirish imkoni qoladi).
    TEXTUP_AUTH_URL: z.string().url().optional(),
    TEXTUP_SMS_URL: z.string().url().optional(),
    TEXTUP_EMAIL: z.string().optional(),
    TEXTUP_PASSWORD: z.string().optional(),
    // Bo'lim 8 — MAJBURIY EMAS: faqat qo'shimcha hisob-xavfsizlik
    // assertioni. Berilsa, runtime login javobidagi `user.id` bilan
    // tekshiriladi (fail-closed) — so'rovga qo'yiladigan `userId` esa HAR
    // DOIM runtime login javobidan olinadi, bu maydondan EMAS.
    TEXTUP_EXPECTED_USER_ID: z.string().optional(),
    // Bo'lim 9/12 — ixtiyoriy, tasdiqlangan alpha-nom ("bobololadono" hozir
    // "Tekshirilmoqda"). Berilmasa qisqa raqamdan yuboriladi — bu ham
    // TO'G'RI ishlaydi, majburiy EMAS.
    TEXTUP_NICKNAME_ID: z.string().optional(),
    // Bo'lim 10/11 — IKKITA ALOHIDA shablon ID (bitta umumiy EMAS): har
    // bir moderatsiya matni ("bobololadono Registration/Password Reset OTP")
    // alohida tasdiqlanadi. Ikkalasi ham "Tekshirilmoqda" — hozircha
    // ikkalasi ham bo'sh qolishi mumkin (`textup.provider.ts` shunda
    // `templateId`ni so'rovdan butunlay chiqarib tashlaydi).
    TEXTUP_REGISTRATION_TEMPLATE_ID: z.string().optional(),
    TEXTUP_PASSWORD_RESET_TEMPLATE_ID: z.string().optional(),
    // Bosqich 22 — FAQAT lokal dev qulayligi: yoqilsa, `/auth/*/request-otp`
    // javobida generatsiya qilingan kod `devOtp` maydonida qaytadi (frontend
    // konsolni o'qimasdan sinash uchun). Sukut — HAR DOIM `false` (yoqib
    // qo'yish ATAYLAB ishtirokchi tomonidan). Haqiqiy shart uchtasi BIRGA
    // (`OtpService`da tekshiriladi, `dev-otp.util.ts`): NODE_ENV!=production
    // HAMDA SMS_PROVIDER=CONSOLE HAMDA shu bayroq — uchtasidan BIRI yolg'on
    // bo'lsa ham kod hech qachon javobga chiqmaydi (mustaqil qatlamlar).
    DEV_EXPOSE_OTP: booleanish.default('false'),

    // ── Outbox notification delivery (Bosqich 10) ───────────────────────
    // Bo'lim 9/10 — PROCESSING holatda "qotib qolgan" qatorni boshqa worker
    // qayta claim qila olishi uchun lease muddati.
    OUTBOX_PROCESSING_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(120),
    // Bo'lim 38 — bitta claim chaqiruvi qancha qatorni oladi (unbounded scan taqiqi).
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),
    // Bo'lim 39 — parallel yetkazish soni (provider rate-limitiga mos, unbounded Promise.all YO'Q).
    OUTBOX_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(50).default(5),
    // Bo'lim 25 — retry tugagach DEAD (DLQ semantikasi).
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(6),
    // Bo'lim 24 — eksponensial backoff (soniyada, birinchi urinishdan keyingi kutish).
    OUTBOX_RETRY_BASE_SECONDS: z.coerce.number().int().positive().default(30),
    OUTBOX_RETRY_MAX_SECONDS: z.coerce.number().int().positive().default(3600),
    // Bo'lim 67 — rejalashtirilgan (BullMQ repeatable) sweep oralig'i.
    OUTBOX_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  })
  .superRefine((env, ctx) => {
    // To'lov callback bypass'i production'da IMKONSIZ — ikki qatlamdan biri
    // (env validation). Ikkinchi qatlam runtime check (Bosqich 5).
    if (env.NODE_ENV === 'production') {
      if (env.SWAGGER_ENABLED) {
        // Ogohlantirish emas — xato: production'da /docs ochiq qolmasin.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SWAGGER_ENABLED'],
          message: "production'da SWAGGER_ENABLED=false bo'lishi shart",
        });
      }
      if (!env.DB_ROLE_ASSERTION) {
        // F1 — append-only himoyasini prod'da o'chirib qo'yish IMKONSIZ.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DB_ROLE_ASSERTION'],
          message: "production'da DB_ROLE_ASSERTION=off IMKONSIZ (fail closed)",
        });
      }
      // Bosqich 5, bo'lim 45 — "NODE_ENV=production'da fake provider bilan
      // boot qilish fail bo'lsin". PAYME/CLICK ham hali implement qilinmagan
      // (`payment.module.ts` ikkalasini ham har doim rad etadi) — natijada
      // hozircha production HECH QANDAY provider bilan ko'tarilolmaydi, bu
      // ATAYLAB: real provider ulanmaguncha to'lov qabul qiluvchi prod
      // muhit ishga tushmasligi kerak. Bosqich 23 — `PAYMENTS_ENABLED=false`
      // bo'lsa bu tekshiruv O'TKAZIB YUBORILADI: `PAYMENT_PROVIDER` shu
      // holatda umuman ishlatilmaydi (`payment.module.ts` har doim
      // `DisabledPaymentProvider` qaytaradi, `PAYOUTS_ENABLED` bilan bir
      // xil falsafa) — sukut `TEST` qiymatini o'zgartirish shart emas.
      if (env.PAYMENTS_ENABLED && env.PAYMENT_PROVIDER === 'TEST') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENT_PROVIDER'],
          message: "production'da PAYMENT_PROVIDER=TEST IMKONSIZ (fail closed) — yoki PAYMENTS_ENABLED=false qo'ying",
        });
      }
      // OTP policy audit — user-facing OTP FAQAT SMS orqali yuborilishi
      // shart (email/Telegram OTP kanali YO'Q, bo'lishi ham mumkin emas).
      // `SMS_PROVIDER` sukuti `CONSOLE` (kodni backend stdout'iga yozadi —
      // faqat lokal dev uchun) production'da chindan yetkazib bermaydi,
      // shuning uchun PAYMENT_PROVIDER bilan bir xil fail-closed falsafa:
      // real SMS provider ulanmaguncha production umuman ko'tarilmaydi.
      if (env.SMS_PROVIDER === 'CONSOLE') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMS_PROVIDER'],
          message: "production'da SMS_PROVIDER=CONSOLE IMKONSIZ (fail closed) — OTP faqat real SMS provider orqali yuborilishi shart",
        });
      }
      // Bo'lim 25 audit topilmasi — `DEV_EXPOSE_OTP` bu paytgacha faqat
      // RUNTIME qatlamda (`dev-otp.util.ts#shouldExposeDevOtp`:
      // `!isProduction && SMS_PROVIDER==='CONSOLE' && flag`) tekshirilardi;
      // Zod sxemasi uni hech qachon rad etmagan. Amalda inert edi (yuqoridagi
      // SMS_PROVIDER=CONSOLE qoidasi allaqachon production'ni rad etadi),
      // lekin BOOT vaqtida mustaqil, ikkinchi qatlam yo'q edi — production
      // muhitida (Railway) `DEV_EXPOSE_OTP=true` operator xatosi bilan
      // qolib ketsa, buni hech narsa ushlamas edi. F1/ADR-03 bilan bir xil
      // falsafa: kritik fail-closed qoida BITTA joyga ishonib qolmaydi.
      if (env.DEV_EXPOSE_OTP) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEV_EXPOSE_OTP'],
          message: "production'da DEV_EXPOSE_OTP=true IMKONSIZ (fail closed) — OTP javobda hech qachon ko'rsatilmasligi shart",
        });
      }
      // Bo'lim 3 (admin.bobololadono.uz) — ikkinchi mustaqil security ko'rib
      // chiqishi topilmasi: `STAFF_CORS_ORIGINS` sukuti (`http://localhost:3000`)
      // production `superRefine`da HECH QACHON tekshirilmagan edi — operator
      // uni Railway'da o'rnatishni unutsa (yoki "yordam" deb `CORS_ORIGINS`
      // bilan bir xil qilib qo'ysa), izolyatsiya jimgina yo'qolardi va
      // `production-check.ts`ning o'zi ham (faqat "bo'sh/wildcard emas"
      // tekshirardi) buni tutolmas edi. Bu yerda IKKI shart: (1) har bir
      // yozuv https va localhost EMAS, (2) `CORS_ORIGINS` bilan BITTA HAM
      // umumiy yozuv YO'Q — aynan shu ikkinchisi izolyatsiya kafolati.
      for (const origin of env.STAFF_CORS_ORIGINS) {
        if (!origin.startsWith('https://')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['STAFF_CORS_ORIGINS'],
            message: `production'da STAFF_CORS_ORIGINS faqat https:// (localhost emas) bo'lishi shart: "${origin}" yaroqsiz`,
          });
        }
      }
      const staffCorsOverlap = env.STAFF_CORS_ORIGINS.filter((o) => env.CORS_ORIGINS.includes(o));
      if (staffCorsOverlap.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STAFF_CORS_ORIGINS'],
          message: `STAFF_CORS_ORIGINS va CORS_ORIGINS bir xil manzil(lar)ni o'z ichiga oladi (${staffCorsOverlap.join(', ')}) — bu admin.bobololadono.uz izolyatsiyasini yo'qqa chiqaradi, ikkalasi mustaqil bo'lishi shart`,
        });
      }
      // 547-sonli Qonunning 27¹-moddasi: O'zbekiston fuqarolarining shaxsiy ma'lumotlari
      // (pasport, telefon, KYC) O'zbekiston hududidagi serverlarda saqlanishi shart.
      if (env.DATA_RESIDENCY_ASSERTION) {
        if (env.DATA_RESIDENCY_COUNTRY !== 'UZ') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATA_RESIDENCY_COUNTRY'],
            message: "547-sonli Qonun 27¹-moddasi bo'yicha DATA_RESIDENCY_COUNTRY='UZ' bo'lishi shart",
          });
        }
        if (env.S3_ENDPOINT) {
          const foreignCloud = /(amazonaws\.com|storage\.googleapis\.com|blob\.core\.windows\.net|digitaloceanspaces\.com|backblazeb2\.com)/i;
          if (foreignCloud.test(env.S3_ENDPOINT)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['S3_ENDPOINT'],
              message: "547-sonli Qonunning 27¹-moddasi buzilishi: fuqarolar shaxsiy ma'lumotlari xorijiy bulutda saqlanishi taqiqlangan. S3_ENDPOINT O'zbekiston hududidagi server/MinIO bo'lishi shart",
            });
          }
        }
      }
      // Bosqich 7 — Payout uchun hozircha Zod darajasida DUBLIKAT qilinmadi
      // (PAYME/CLICK'dan farqli, `PAYOUT_PROVIDER` enum'ida "kelajakda
      // implement qilinadigan, lekin hozir Zod'dan o'tadigan" haqiqiy qiymat
      // UMUMAN YO'Q — faqat `TEST`). Shuning uchun bu yerga qo'shsak HAR BIR
      // boshqa (payout'ga aloqasi yo'q) production testi ham default
      // `TEST` tufayli beixtiyor yiqilar edi. Fail-closed himoya YAGONA
      // qatlamda — `payout.module.ts` factory — chunki u yerda ham
      // `PAYOUT_PROVIDER`ning BOSHQA qiymati yo'q, natija bir xil: real
      // provider ulanmaguncha production umuman ko'tarilolmaydi.
    }
    // Bosqich 12 — PAYME tanlansa (NODE_ENV'dan qat'i nazar: dev'da ham
    // sandbox'ga ulanish uchun to'liq credential kerak) 4 ta maydon HAM
    // MAJBURIY. Ikkinchi qatlam himoya — `payment.module.ts` factory'da
    // ham qayta tekshiriladi (F1/ADR-03 bilan bir xil falsafa: kritik
    // fail-closed tekshiruv bitta joyga ishonib qolmaydi). `PAYMENTS_
    // ENABLED=false` bo'lsa bu HAM o'tkazib yuboriladi — yuqoridagi
    // izohga qarang.
    if (env.PAYMENTS_ENABLED && env.PAYMENT_PROVIDER === 'PAYME') {
      const required: (keyof typeof env)[] = ['PAYME_MERCHANT_ID', 'PAYME_LOGIN', 'PAYME_KEY', 'PAYME_CHECKOUT_URL'];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `PAYMENT_PROVIDER=PAYME bo'lsa ${key} majburiy`,
          });
        }
      }
    }
    // Rasmiy Click Merchant API
    if (env.PAYMENTS_ENABLED && env.PAYMENT_PROVIDER === 'CLICK') {
      const required: (keyof typeof env)[] = ['CLICK_MERCHANT_ID', 'CLICK_SERVICE_ID', 'CLICK_SECRET_KEY'];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `PAYMENT_PROVIDER=CLICK bo'lsa ${key} majburiy`,
          });
        }
      }
    }
    // Payme Payout Rail
    if (env.PAYOUTS_ENABLED && env.PAYOUT_PROVIDER === 'PAYME') {
      const required: (keyof typeof env)[] = ['PAYME_PAYOUT_LOGIN', 'PAYME_PAYOUT_KEY'];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `PAYOUT_PROVIDER=PAYME bo'lsa ${key} majburiy`,
          });
        }
      }
    }
    // Bosqich 13 — PLAYMOBILE tanlansa 4 ta maydon HAM majburiy (Payme bilan bir xil ikkinchi qatlam himoya falsafasi).
    if (env.SMS_PROVIDER === 'PLAYMOBILE') {
      const required: (keyof typeof env)[] = ['PLAYMOBILE_API_URL', 'PLAYMOBILE_LOGIN', 'PLAYMOBILE_PASSWORD', 'PLAYMOBILE_SENDER'];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `SMS_PROVIDER=PLAYMOBILE bo'lsa ${key} majburiy`,
          });
        }
      }
    }
    // Bosqich 23 (v4) — TEXTUP tanlansa 4 ta maydon HAM majburiy (bo'lim 24 —
    // production shu credential'lar bo'lmasa umuman ko'tarilmasin).
    // TEXTUP_EXPECTED_USER_ID/NICKNAME_ID/*_TEMPLATE_ID ATAYLAB bu ro'yxatda
    // YO'Q — ular ixtiyoriy (hisob-xavfsizlik assertioni / moderatsiya
    // hali tasdiqlanmagan).
    if (env.SMS_PROVIDER === 'TEXTUP') {
      const required: (keyof typeof env)[] = [
        'TEXTUP_AUTH_URL',
        'TEXTUP_SMS_URL',
        'TEXTUP_EMAIL',
        'TEXTUP_PASSWORD',
      ];
      for (const key of required) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `SMS_PROVIDER=TEXTUP bo'lsa ${key} majburiy`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * `ConfigModule.forRoot({ validate })` uchun. Xato bo'lsa — o'qiladigan
 * xabar bilan `Error` tashlaydi (barcha muammoli kalitlar sanab).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  // Productionda SWAGGER_ENABLED ochiq ko'rsatilmagan bo'lsa xavfsizlik uchun sukut bo'yicha 'false' (yopiq)
  const normalizedRaw = { ...raw };
  if (normalizedRaw.NODE_ENV === 'production' && normalizedRaw.SWAGGER_ENABLED === undefined) {
    normalizedRaw.SWAGGER_ENABLED = 'false';
  }
  const parsed = envSchema.safeParse(normalizedRaw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Muhit o'zgaruvchilari validatsiyasi muvaffaqiyatsiz:\n${details}`);
  }
  return parsed.data;
}
