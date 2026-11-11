/**
 * e2e spec'lari `AppModule` ni FAYL BOSHIDA import qiladi. `@nestjs/config`
 * `forRoot` — `validate: validateEnv` bilan — import vaqtidayoq `process.env`
 * ni O'QIYDI va SNAPSHOT qiladi (`cache: true`). Shuning uchun ulanish
 * URL'lari `beforeAll` da emas, SHU YERDA (spec import'idan oldin) o'rnatilishi
 * SHART — aks holda RedisService/PrismaService noto'g'ri (dummy) manzilga
 * ulanishga urinadi va boot osilib qoladi.
 *
 * Manzillar deterministik: CI'da service konteynerlar (`localhost:5432/6379`),
 * lokal'da `E2E_SUPERUSER_URL` / `E2E_REDIS_URL`. `health.e2e-spec` va
 * `db-role-assertion.e2e-spec` `health_e2e` DB'sini **`bobololadono_app`** roli
 * bilan ishlatadi (F1 tekshiruvi shuni talab qiladi) — uni `beforeAll`
 * `provisionDb('health_e2e')` bilan yaratadi/rollarni sozlaydi.
 *
 * Bosqich 22 — `DEV_EXPOSE_OTP` ATAYLAB `'false'`ga PIN qilingan: lokal
 * `backend/.env`da bu bayroq (dev qulayligi uchun) `true` bo'lishi mumkin,
 * lekin `dotenv` allaqachon o'rnatilgan `process.env` kalitini QAYTA
 * YOZMAYDI — shu yerda pin qilinmasa, e2e suite dasturchining shaxsiy
 * `.env`iga qarab tasodifan `devOtp` bilan/siz javob olardi (`.expect(200,
 * { sent: true })` qat'iy tengliklari shundan yiqiladi). E2E hamisha
 * deterministik bo'lishi kerak — ambient `.env`ga bog'liq emas.
 *
 * Bosqich 23 — `SMS_PROVIDER` xuddi shu sababdan `'CONSOLE'`ga PIN
 * qilingan (2026-09-17 topilgan real xavf): dasturchining shaxsiy
 * `backend/.env`i endi haqiqiy TextUp credential bilan `SMS_PROVIDER=
 * TEXTUP` saqlashi mumkin (production integratsiyasi tayyor bo'lgach) —
 * pin qilinmasa, e2e suite `AppModule`ni to'liq ko'taradi (BullMQ
 * `OtpSmsProcessor` worker HAM ICHIDA), REGISTER/PASSWORD_RESET
 * oqimlarini sinovchi HAR BIR e2e test haqiqiy TextUp SMS yuborib
 * yuborardi — CI/lokal test yugurishda HAQIQIY pul sarflanadi va sinov
 * telefon raqamiga SMS boradi. E2E provayder HAR DOIM CONSOLE (real
 * tarmoq chaqiruvisiz).
 */
const SUPERUSER =
  process.env.E2E_SUPERUSER_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const host = new URL(SUPERUSER.replace(/^[a-z]+:\/\//i, 'http://')).host;

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'true';
process.env.DB_ROLE_ASSERTION = 'on';
// Bosqich 23 — `connection_limit` ATAYLAB oshirilgan (Prisma sukuti
// `num_cpus*2+1`, ba'zi mashinalarda ~5-9): 10 ta chinakam PARALLEL
// `$transaction()` (masalan seller-application submit poyga testi) sukut
// pool bilan ba'zan ECONNRESET beradi — so'rovlar bo'sh ulanish kutib,
// HTTP darajasida vaqt tugaydi. Postgres `max_connections` (100+) buni
// osongina ko'taradi.
process.env.DATABASE_URL = `postgresql://bobololadono_app:app@${host}/health_e2e?schema=public&connection_limit=20`;
process.env.DATABASE_MIGRATION_URL = `postgresql://bobololadono_migrator:migrator@${host}/health_e2e?schema=public`;
process.env.REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://127.0.0.1:6379';
process.env.DEV_EXPOSE_OTP = 'false';
process.env.SMS_PROVIDER = 'CONSOLE';

// Never inherit real payment/provider credentials or authentication secrets.
process.env.JWT_ACCESS_SECRET = 'isolated-e2e-access-secret-at-least-32-characters';
process.env.JWT_STAFF_ACCESS_SECRET = 'isolated-e2e-staff-secret-at-least-32-characters';
process.env.STAFF_TOTP_ENCRYPTION_KEY = '22'.repeat(32);
process.env.PAYMENT_PROVIDER = 'TEST';
process.env.PAYOUT_PROVIDER = 'TEST';
process.env.PAYMENTS_ENABLED = 'true';
process.env.PAYOUTS_ENABLED = 'true';
process.env.KYC_SUBMISSION_ENABLED = 'true';
