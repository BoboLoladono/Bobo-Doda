import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { waitFor } from './support/wait-for';
import { SMS_PROVIDER, type SmsProvider, type SmsSendResult } from '@/infra/sms/sms-provider.interface';
import { RedisService } from '@/infra/redis/redis.service';
import { IdFactory } from '@/common/id/id.factory';
import { OTP_VERIFY_IP_MAX_ATTEMPTS } from '@/modules/auth/constants/otp.constants';

/**
 * Bosqich 21 — parol bilan login. Oddiy LOGIN endi telefon+PAROL (SMS
 * ISHTIROK ETMAYDI); SMS FAQAT ro'yxatdan o'tish (REGISTER) va parolni
 * tiklashda (PASSWORD_RESET) — telefon egaligini isbotlash uchun.
 * `SMS_PROVIDER` — `CapturingSmsProvider` bilan almashtiriladi (haqiqiy
 * kodni argon2id orqali DB'dan qayta o'qib bo'lmaydi — faqat "yuborilgan"
 * nusxadan bilamiz, xuddi haqiqiy SMS provayder logidan tekshirganday).
 * `sms.calls` — bo'lim 36'dagi "aniq SMS soni" testlari uchun.
 */
class CapturingSmsProvider implements SmsProvider {
  lastCode: string | undefined;
  lastPhone: string | undefined;
  calls = 0;

  async send(phone: string, _template: string, params: Record<string, string>): Promise<SmsSendResult> {
    this.calls += 1;
    this.lastPhone = phone;
    this.lastCode = params.code;
    return { success: true, providerMessageId: `test-${this.calls}` };
  }
}

const DB = 'health_e2e';
const TEST_PASSWORD = 'E2eTestPass1!';
let phoneCounter = 0;
/**
 * Har testga UNIKAL, haqiqatan valid O'zbekiston raqami. ATAYLAB faqat
 * monoton hisoblagichdan (`Date.now()`ga TAYANMAYDI) — in-process HTTP
 * so'rovlar millisekund ichida bir necha marta yuborilishi mumkin, vaqtga
 * asoslangan versiya kamdan-kam bir xil raqamni ikki marta qaytarib
 * qo'yardi (`test/support/fixtures.ts#uniquePhone`dagi bilan bir xil bug).
 */
function uniquePhone(): string {
  phoneCounter += 1;
  return `+99890${phoneCounter.toString().padStart(7, '0')}`;
}

describe('Auth (e2e, real Postgres + Redis + BullMQ)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('auth.e2e');
    if (!reachable) return;

    await provisionDb(DB);
    await flushRedis(); // OTP rate-limit hisoblagichlari boshqa e2e fayllardan qolmasin
    sms = new CapturingSmsProvider();
    app = await buildTestApp((builder) => builder.overrideProvider(SMS_PROVIDER).useValue(sms));
  }, 120_000);

  afterAll(async () => {
    if (reachable && app) {
      try {
        const redis = app.get(RedisService).client;
        const keys = await redis.keys('ratelimit:*');
        if (keys.length) await redis.del(...keys);
      } catch (_err) {
        void _err;
      }
      await dropDatabase(DB);
    }
    await app?.close();
  });

  beforeEach(async () => {
    if (reachable && app) {
      const redis = app.get(RedisService).client;
      const keys = await redis.keys('ratelimit:*');
      if (keys.length) await redis.del(...keys);
    }
  });

  const t = (name: string, fn: () => Promise<void>): void =>
    it(name, async () => {
      if (!reachable) return;
      await fn();
    });

  async function requestAndGetCode(phone: string, purpose: 'REGISTER' | 'PASSWORD_RESET'): Promise<string> {
    const path = purpose === 'REGISTER' ? '/api/v1/auth/register/request-otp' : '/api/v1/auth/password-reset/request-otp';
    const callsBefore = sms.calls;
    await request(app!.getHttpServer()).post(path).send({ phone }).expect(200, { sent: true });
    await waitFor(() => sms.calls > callsBefore && sms.lastPhone === phone && !!sms.lastCode, { label: 'otp sms' });
    return sms.lastCode!;
  }

  /** To'liq REGISTER oqimi (request-otp → verify-otp → complete, doim BIR
      XIL `TEST_PASSWORD` bilan) — pastdagi testlarning ko'pchiligiga
      "menga shunchaki autentifikatsiyalangan sessiya kerak" degan holatni
      ta'minlaydi (refresh rotatsiya, rol tanlash va h.k. parol siyosatiga
      bog'liq emas). */
  async function registerFresh(): Promise<{ accessToken: string; refreshCookie: string; phone: string }> {
    const phone = uniquePhone();
    const code = await requestAndGetCode(phone, 'REGISTER');
    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(200);
    const registrationToken = verify.body.registrationToken as string;
    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
      .expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const refreshCookie = setCookie[0]!.split(';')[0]!;
    return { accessToken: res.body.accessToken, refreshCookie, phone };
  }

  async function userCount(phone: string): Promise<number> {
    const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      return await db.user.count({ where: { phone } });
    } finally {
      await db.$disconnect();
    }
  }

  async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
    const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      return await fn(db);
    } finally {
      await db.$disconnect();
    }
  }

  /** Faqat cooldown kalitlarini tozalaydi — real 60s kutmasdan bir xil
      telefon+maqsad uchun qayta so'rash sinaladi. */
  async function flushCooldownOnly(): Promise<void> {
    const redis = app!.get(RedisService).client;
    const keys = await redis.keys('ratelimit:cd:otp:cooldown:*');
    if (keys.length) await redis.del(...keys);
  }

  /** Faqat umumiy IP soatlik hisoblagichini tozalaydi — bir nechta test
      BIR XIL test-jarayoni IP'sidan bir nechta muvaffaqiyatli so'rov
      yuboradi, bu ularning maqsadiga aloqasi yo'q yon ta'sir. */
  async function flushIpCounter(): Promise<void> {
    const redis = app!.get(RedisService).client;
    const keys = await redis.keys('ratelimit:hit:otp:ip:*');
    if (keys.length) await redis.del(...keys);
  }

  /** `flushIpCounter()` bilan bir xil naqsh, `verify-otp`ning IP chegarasi
      (`otp:verify:ip:`) uchun — RACE testlari o'nlab chinakam parallel
      verify so'rovi yuboradi (bir xil test-jarayoni IP'sidan), bu keyingi
      testlarning maqsadiga aloqasi yo'q yon ta'sir. */
  async function flushVerifyIpCounter(): Promise<void> {
    const redis = app!.get(RedisService).client;
    const keys = await redis.keys('ratelimit:hit:otp:verify:ip:*');
    if (keys.length) await redis.del(...keys);
  }

  // ── REGISTER — telefon → SMS OTP → grant → parol → User ──────────────────

  t('REGISTER: yangi telefon → aniq 1 ta SMS, verify+complete → User yaratiladi, sessiya', async () => {
    const phone = uniquePhone();
    const callsBefore = sms.calls;
    const code = await requestAndGetCode(phone, 'REGISTER');
    expect(sms.calls).toBe(callsBefore + 1);

    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(200);
    expect(typeof verify.body.registrationToken).toBe('string');

    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken: verify.body.registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
      .expect(200);

    expect(res.body.isNewUser).toBe(true);
    expect(res.body.activeRole).toBeNull();
    expect(res.body.roleChosen).toBe(false);
    expect(typeof res.body.accessToken).toBe('string');
    const cookie = res.headers['set-cookie'];
    expect(cookie?.[0]).toMatch(/^refresh_token=.+HttpOnly.+SameSite=Strict/);
    expect(await userCount(phone)).toBe(1);
    expect(sms.calls).toBe(callsBefore + 1); // complete bosqichi SMS yubormaydi
  });

  t('REGISTER complete: parollar mos emas → VALIDATION, User yaratilmaydi', async () => {
    const phone = uniquePhone();
    const code = await requestAndGetCode(phone, 'REGISTER');
    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(200);

    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken: verify.body.registrationToken, password: TEST_PASSWORD, confirmPassword: 'Boshqa1!' })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('VALIDATION'));

    expect(await userCount(phone)).toBe(0);
  });

  t('Registration grant — bir martalik: ikkinchi complete SAME token bilan rad etiladi', async () => {
    const phone = uniquePhone();
    const code = await requestAndGetCode(phone, 'REGISTER');
    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(200);
    const registrationToken = verify.body.registrationToken as string;

    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
      .expect(200);

    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('TOKEN_EXPIRED'));

    expect(await userCount(phone)).toBe(1); // ikkinchi urinish YANGI User yaratmagan
  });

  t('Registration grant — muddati tugagan bo‘lsa rad etiladi', async () => {
    const phone = uniquePhone();
    const code = await requestAndGetCode(phone, 'REGISTER');
    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(200);
    const registrationToken = verify.body.registrationToken as string;

    await withDb((db) =>
      db.authGrant.updateMany({
        where: { purpose: 'REGISTER', consumedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );

    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('TOKEN_EXPIRED'));

    expect(await userCount(phone)).toBe(0);
  });

  t('REGISTER: allaqachon ro‘yxatdan o‘tgan telefon → complete’da PHONE_EXISTS, YANGI User yaratilmaydi', async () => {
    const { phone } = await registerFresh();
    expect(await userCount(phone)).toBe(1);

    // `registerFresh()` shu telefon+REGISTER uchun cooldown'ni ALLAQACHON
    // ishlatgan (bir necha millisekund oldin) — real 60s kutmasdan yana
    // so'rash uchun tozalaymiz.
    await flushCooldownOnly();
    const code = await requestAndGetCode(phone, 'REGISTER');
    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(200);

    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/complete')
      .send({ registrationToken: verify.body.registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('PHONE_EXISTS'));

    expect(await userCount(phone)).toBe(1); // dublikat yo'q
  });

  // ── Concurrency — DB unique constraint YAGONA haqiqat manbai ─────────────

  /**
   * Bo'lim 23 — 10 ta MUSTAQIL, haqiqiy grant (har biri O'ZINING
   * `registrationToken`i bilan, bir xil telefon uchun) 10 ta chinakam
   * PARALLEL `/register/complete` so'roviga yuboriladi. Har bir grant
   * mustaqil ravishda CAS-iste'mol qilinadi (hech qanday kontensiya yo'q
   * — grant token bo'yicha qidiriladi, "eng so'nggi" emas), shuning uchun
   * BARCHA 10tasi `User.create()`ga PARALLEL yetib boradi — bu DB
   * `User.phone` UNIQUE cheklovining O'ZINI (P2002 ushlash) sinaydi.
   */
  t('REGISTER: bir xil telefon uchun 10 ta MUSTAQIL grant bilan parallel complete → FAQAT bitta User', async () => {
    const phone = uniquePhone();
    const tokens: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const code = await requestAndGetCode(phone, 'REGISTER');
      const verify = await request(app!.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone, code })
        .expect(200);
      tokens.push(verify.body.registrationToken as string);
      await flushCooldownOnly(); // keyingi so'rov 60s kutmasdan
    }

    const results = await Promise.all(
      tokens.map((registrationToken) =>
        request(app!.getHttpServer())
          .post('/api/v1/auth/register/complete')
          .send({ registrationToken, password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409 && r.body.code === 'PHONE_EXISTS');
    expect(succeeded.length).toBe(1);
    expect(conflicted.length).toBe(9);
    expect(await userCount(phone)).toBe(1);
    await flushIpCounter(); // bu test 10 ta so'rov yuborgan, keyingi testlar uchun tiklaymiz
  });

  // ── LOGIN — telefon + PAROL, SMS YO'Q ─────────────────────────────────────

  t('LOGIN: to‘g‘ri telefon+parol → sessiya, SMS SONI O‘ZGARMAYDI', async () => {
    const { phone } = await registerFresh();
    const callsBefore = sms.calls;

    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: TEST_PASSWORD })
      .expect(200);

    expect(res.body.isNewUser).toBe(false);
    expect(typeof res.body.accessToken).toBe('string');
    expect(sms.calls).toBe(callsBefore); // login HECH QANDAY SMS yubormaydi
  });

  t('LOGIN: 5 marta ketma-ket muvaffaqiyatli login → 0 QO‘SHIMCHA SMS', async () => {
    const { phone } = await registerFresh();
    const callsBefore = sms.calls;

    for (let i = 0; i < 5; i += 1) {
      await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone, password: TEST_PASSWORD })
        .expect(200);
    }

    expect(sms.calls).toBe(callsBefore);
  });

  t('LOGIN: noto‘g‘ri parol → INVALID_CREDENTIALS', async () => {
    const { phone } = await registerFresh();
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: 'NotoGriParol1' })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('INVALID_CREDENTIALS'));
  });

  t('LOGIN: mavjud bo‘lmagan telefon → HAM INVALID_CREDENTIALS (enumeration-safe)', async () => {
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone: uniquePhone(), password: 'AnyPassword1' })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('INVALID_CREDENTIALS'));
  });

  t('LOGIN: legacy foydalanuvchi (passwordHash=null) → INVALID_CREDENTIALS, User buzilmaydi', async () => {
    const phone = uniquePhone();
    await withDb(async (db) => {
      const ids = app!.get(IdFactory);
      await db.user.create({ data: { id: ids.next(), phone, roles: [], verified: true } });
    });

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: 'AnyPassword1' })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('INVALID_CREDENTIALS'));

    // Legacy hisob "Parolni unutdim" orqali tiklanadi — pastdagi FORGOT
    // bo'limida shu XUDDI shu turdagi hisob bilan sinaladi.
    expect(await userCount(phone)).toBe(1);
  });

  t('LOGIN: bloklangan hisob — to‘g‘ri parol bo‘lsa ham ACCOUNT_BLOCKED', async () => {
    const { phone } = await registerFresh();
    await withDb((db) => db.user.update({ where: { phone }, data: { status: 'BLOCKED' } }));

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: TEST_PASSWORD })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('ACCOUNT_BLOCKED'));
  });

  t('LOGIN: vaqtincha cheklangan (muddati o‘tmagan) — ACCOUNT_SUSPENDED', async () => {
    const { phone } = await registerFresh();
    await withDb((db) =>
      db.user.update({
        where: { phone },
        data: { status: 'SUSPENDED', suspendedUntil: new Date(Date.now() + 60_000) },
      }),
    );

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: TEST_PASSWORD })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('ACCOUNT_SUSPENDED'));
  });

  t('LOGIN rate limit — bitta telefon uchun urinishlar chegarasi bor', async () => {
    const { phone } = await registerFresh();
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app!.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ phone, password: 'NotoGriParol1' });
      results.push(res.status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  // ── Parolni bilgan holda almashtirish (bo'lim 44 — AccountSecurity.tsx) ──

  t('CHANGE PASSWORD: joriy parol to‘g‘ri bo‘lsa yangilanadi, sessiya BEKOR QILINMAYDI', async () => {
    const { phone, accessToken, refreshCookie } = await registerFresh();
    const newPassword = 'AlmashtirilganParol1!';

    await request(app!.getHttpServer())
      .post('/api/v1/me/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword })
      .expect(200, { ok: true });

    // Joriy refresh sessiya HALI ishlaydi (change-password reset'dan farqli
    // — boshqa sessiyalarni bekor qilmaydi).
    await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);

    // Eski parol endi ishlamaydi, yangisi ishlaydi.
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: TEST_PASSWORD })
      .expect(401);
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: newPassword })
      .expect(200);
  });

  t('CHANGE PASSWORD: joriy parol noto‘g‘ri bo‘lsa INVALID_CURRENT_PASSWORD, parol o‘zgarmaydi', async () => {
    const { phone, accessToken } = await registerFresh();

    await request(app!.getHttpServer())
      .post('/api/v1/me/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'NotoGriParol1', newPassword: 'YangiParol1!' })
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('INVALID_CURRENT_PASSWORD'));

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: TEST_PASSWORD })
      .expect(200);
    // Ikkala CHANGE PASSWORD testi ham `registerFresh()` orqali umumiy IP
    // byudjetini iste'mol qildi — pastdagi testlarga aloqasi yo'q yon
    // ta'sir, tiklaymiz.
    await flushIpCounter();
  });

  // ── FORGOT PASSWORD ────────────────────────────────────────────────────────

  t('FORGOT: mavjud foydalanuvchi → 1 ta SMS → verify → yangi parol → eski parol ISHLAMAYDI, yangisi ISHLAYDI, eski sessiyalar bekor', async () => {
    await flushIpCounter();
    const { phone, refreshCookie } = await registerFresh();
    const callsBefore = sms.calls;

    const code = await requestAndGetCode(phone, 'PASSWORD_RESET');
    expect(sms.calls).toBe(callsBefore + 1);

    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code })
      .expect(200);
    const resetToken = verify.body.resetToken as string;

    const newPassword = 'YangiParol2!';
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/complete')
      .send({ resetToken, password: newPassword, confirmPassword: newPassword })
      .expect(200, { ok: true });

    // Eski parol endi ishlamaydi.
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: TEST_PASSWORD })
      .expect(401);

    // Yangi parol ishlaydi.
    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: newPassword })
      .expect(200);

    // Reset OLDIDAN mavjud bo'lgan refresh sessiya endi ishlamaydi.
    await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
  });

  t('FORGOT: legacy foydalanuvchi (passwordHash=null) uchun ham onboarding sifatida ishlaydi', async () => {
    const phone = uniquePhone();
    await withDb(async (db) => {
      const ids = app!.get(IdFactory);
      await db.user.create({ data: { id: ids.next(), phone, roles: [], verified: true } });
    });

    const code = await requestAndGetCode(phone, 'PASSWORD_RESET');
    const verify = await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code })
      .expect(200);

    const newPassword = 'YangiParol3!';
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/complete')
      .send({ resetToken: verify.body.resetToken, password: newPassword, confirmPassword: newPassword })
      .expect(200, { ok: true });

    await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ phone, password: newPassword })
      .expect(200);
  });

  t('FORGOT: noma’lum telefon → bir xil {sent:true} javob, lekin HAQIQIY SMS YUBORILMAYDI', async () => {
    const phone = uniquePhone();
    const callsBefore = sms.calls;

    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/request-otp')
      .send({ phone })
      .expect(200);
    expect(res.body).toEqual({ sent: true });

    // Rate-limit hodisasi Redis'ga yozilishi uchun ozgina kutamiz — SMS esa
    // UMUMAN yuborilmagani uchun `waitFor` qo'llab bo'lmaydi (hech qachon
    // rost bo'lmaydi), shuning uchun belgilangan kutish.
    await new Promise((r) => setTimeout(r, 300));
    expect(sms.calls).toBe(callsBefore);
  });

  t('FORGOT: reset OTP noto‘g‘ri → INVALID_CODE', async () => {
    const { phone } = await registerFresh();
    await flushCooldownOnly();
    const code = await requestAndGetCode(phone, 'PASSWORD_RESET');
    const wrong = code === '000000' ? '111111' : '000000';
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code: wrong })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('INVALID_CODE'));
  });

  t('FORGOT: reset OTP muddati tugagan → OTP_EXPIRED (Bosqich 22 — INVALID_CODE’dan ajratilgan)', async () => {
    const { phone } = await registerFresh();
    await flushCooldownOnly();
    const code = await requestAndGetCode(phone, 'PASSWORD_RESET');
    await withDb((db) =>
      db.otpCode.updateMany({
        where: { phone, purpose: 'PASSWORD_RESET', consumedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('OTP_EXPIRED'));
  });

  t('FORGOT: reset OTP bir martalik — ikkinchi verify rad etiladi', async () => {
    const { phone } = await registerFresh();
    await flushCooldownOnly();
    const code = await requestAndGetCode(phone, 'PASSWORD_RESET');
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code })
      .expect(200);
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('INVALID_CODE'));
  });

  // ── Purpose binding — REGISTER OTP != PASSWORD_RESET OTP context ─────────

  t('Purpose binding: REGISTER uchun so‘ralgan kod password-reset/verify-otp’da ishlamaydi', async () => {
    const phone = uniquePhone();
    const code = await requestAndGetCode(phone, 'REGISTER');
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/verify-otp')
      .send({ phone, code })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('INVALID_CODE'));
  });

  // ── OTP siyosati (mavjud, SMS-only) ───────────────────────────────────────

  t('OTP siyosati — request-otp "channel"/"purpose" maydonini qabul qilmaydi (whitelist rad etadi)', async () => {
    const phone = uniquePhone();
    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone, channel: 'email' })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('VALIDATION'));
  });

  /**
   * Bosqich 22 — `DEV_EXPOSE_OTP` bu test-jarayonda YOZILMAGAN (sukut
   * `false`, `env.schema.ts`), shuning uchun bu YAGONA emas: yuqoridagi
   * BARCHA `requestAndGetCode` chaqiruvi ham `.expect(200, { sent: true })`
   * bilan tananing ANIQ (qat'iy) tengligini tekshiradi — `devOtp` qo'shilib
   * qolsa ULARNING BARCHASI ham yiqilardi. Bu test shu invariantni ATAYLAB,
   * o'z nomi bilan hujjatlashtiradi (real HTTP + Postgres + Redis — unit
   * darajasidagi isbot `dev-otp.util.spec.ts`/`otp.service.spec.ts`da).
   */
  t('DEV_EXPOSE_OTP sukut (false) — request-otp javobida devOtp YO‘Q', async () => {
    const phone = uniquePhone();
    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone })
      .expect(200);
    expect(res.body).toEqual({ sent: true });
    expect(res.body.devOtp).toBeUndefined();
  });

  t('Noto‘g‘ri kod 5 marta → kod “kuyadi” (5-chisi OTP_ATTEMPTS_EXCEEDED), keyin TO‘G‘RI kod ham ishlamaydi', async () => {
    const phone = uniquePhone();
    const code = await requestAndGetCode(phone, 'REGISTER');
    const wrong = code === '000000' ? '111111' : '000000';

    // Bosqich 22 — birinchi 4 ta noto'g'ri urinish oddiy INVALID_CODE
    // (hali urinish qolgan — "qaytadan kiriting" mantiqan to'g'ri).
    for (let i = 0; i < 4; i += 1) {
      await request(app!.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone, code: wrong })
        .expect(422)
        .expect((r) => expect(r.body.code).toBe('INVALID_CODE'));
    }

    // 5-chi (OXIRGI) noto'g'ri urinish — endi OTP_ATTEMPTS_EXCEEDED: shu
    // urinishning o'zi kodni "kuydiradi", foydalanuvchiga aynan shu paytda
    // "yangi kod oling" ko'rsatilishi kerak, keyingi so'rovni kutmasdan.
    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code: wrong })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('OTP_ATTEMPTS_EXCEEDED'));

    // Kod allaqachon "kuygan" (consumedAt yozilgan) — TO'G'RI kod bilan ham
    // endi topilmaydi, generic INVALID_CODE (enumeration-safe: "kuygan" va
    // "hech qachon so'ralmagan" bir xil ko'rinadi).
    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone, code })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('INVALID_CODE'));
  });

  // ── OTP verify attempt-counter — atomiklik (chinakam parallel poyga) ──

  /**
   * OTP verify xavfsizlik mustahkamlash — `attempts` hisoblagichi ILGARI
   * "o'qi → JS'da +1 → yoz" (uchta alohida Prisma chaqiruvi, tranzaksiyasiz)
   * edi: parallel noto'g'ri so'rovlar bir xil ESKI qiymatni o'qib, bir xil
   * natijani yozardi — "lost update". Bu ANIQ shu bug bilan
   * reproduksiya qilingan (scratch test, 5 mustaqil urinishda barchasi):
   * 20 ta chinakam parallel noto'g'ri urinishdan keyin DB'da `attempts`
   * FAQAT 1ga ko'tarilgan, kod HECH QACHON kuymagan. Endi bitta atomik
   * UPDATE (`WHERE "attempts" < MAX AND "consumedAt" IS NULL`) — Postgres
   * bir xil qatorga parallel UPDATE'larni qator-qulfi bilan tabiiy
   * serializatsiya qiladi, shuning uchun N ta parallel bo'lsa ham ANIQ
   * "joy qolgan" miqdorda g'olib chiqadi.
   */
  t('RACE: 20 ta chinakam PARALLEL noto‘g‘ri urinish — attempts yo‘qolgan yozuvlarsiz ANIQ 5ga yetadi va kuyadi', async () => {
    // backend-engineer cross-review topilmasi — tozalash try/finally ichida:
    // aks holda yuqoridagi assert'lardan biri yiqilsa, bu test 21 ta
    // verify-otp so'rov yuborgani keyingi testlar uchun tozalanmay qoladi
    // (kaskadli, aloqasiz 429 xatolari).
    try {
      const phone = uniquePhone();
      const code = await requestAndGetCode(phone, 'REGISTER');
      const wrong = code === '000000' ? '111111' : '000000';

      const CONCURRENCY = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app!.getHttpServer()).post('/api/v1/auth/register/verify-otp').send({ phone, code: wrong }),
        ),
      );

      const invalidCode = results.filter((r) => r.status === 422 && r.body.code === 'INVALID_CODE').length;
      const attemptsExceeded = results.filter((r) => r.status === 422 && r.body.code === 'OTP_ATTEMPTS_EXCEEDED').length;
      expect(invalidCode + attemptsExceeded).toBe(CONCURRENCY);
      // qa-engineer cross-review topilmasi (mustaqil reproduksiya bilan
      // tasdiqlangan): aniq "4 ta INVALID_CODE, qolgani EXCEEDED" bo'linishi
      // KAFOLATLANMAYDI — birinchi 4 ta atomik "joy band qilish" (burn'dan
      // OLDIN) va 5-chi (kuydiruvchi) natija DETERMINISTIK, lekin bir qator
      // "kech qolgan" so'rovlarning `findFirst`i burn'dan KEYIN o'qilishi
      // mumkin (u holda `consumedAt: null` filtridan o'tmay, generic
      // INVALID_CODE'ga tushadi — atomik UPDATE'gacha yetib bormaydi ham).
      // Haqiqiy, poyga-mustaqil kafolat — pastdagi DB tekshiruvi (`attempts
      // === 5`, `consumedAt` o'rnatilgan) va shu ikki QUYI CHEGARA:
      expect(invalidCode).toBeGreaterThanOrEqual(4); // birinchi 4 ta HAR DOIM shu
      expect(attemptsExceeded).toBeGreaterThanOrEqual(1); // kuydiruvchi HAR DOIM shu

      const row = await withDb((db) =>
        db.otpCode.findFirst({ where: { phone, purpose: 'REGISTER' }, orderBy: { createdAt: 'desc' } }),
      );
      expect(row?.attempts).toBe(5); // yo'qolgan yozuv yo'q — ANIQ 5, ortiq ham kam ham EMAS
      expect(row?.consumedAt).not.toBeNull(); // kuygan

      // TO'G'RI kod ham endi ishlamaydi — limit chinakam qattiq, poyga bilan chetlab o'tilmaydi.
      await request(app!.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone, code })
        .expect(422)
        .expect((r) => expect(r.body.code).toBe('INVALID_CODE'));
    } finally {
      await flushVerifyIpCounter(); // bu test 21 ta verify-otp so'rov yuborgan, keyingi testlar uchun tiklaymiz
    }
  });

  /**
   * Muvaffaqiyat yo'li (`updateMany` CAS, `consumedAt: null` shart) bu
   * o'zgarishdan OLDIN ham atomik edi — lekin buni chinakam parallel bilan
   * tasdiqlovchi maxsus test yo'q edi. Bo'lim 23dagi "10 MUSTAQIL grant"
   * testi PARALLEL `complete`ni (har biri O'Z grant'i bilan) sinaydi, bu esa
   * BIR XIL kodni PARALLEL `verify`ni sinaydi — boshqa qatlam.
   */
  t('RACE: BIR XIL to‘g‘ri kod bilan 10 ta chinakam PARALLEL verify — FAQAT bitta muvaffaqiyatli', async () => {
    try {
      const phone = uniquePhone();
      const code = await requestAndGetCode(phone, 'REGISTER');

      const CONCURRENCY = 10;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          request(app!.getHttpServer()).post('/api/v1/auth/register/verify-otp').send({ phone, code }),
        ),
      );

      const succeeded = results.filter((r) => r.status === 200);
      const rejected = results.filter((r) => r.status === 422 && r.body.code === 'INVALID_CODE');
      expect(succeeded.length).toBe(1);
      expect(rejected.length).toBe(CONCURRENCY - 1);
      expect(typeof succeeded[0]!.body.registrationToken).toBe('string');
    } finally {
      await flushVerifyIpCounter(); // bu test 10 ta verify-otp so'rov yuborgan, keyingi testlar uchun tiklaymiz
    }
  });

  t('Telefon formati normallashadi — so‘rash E.164’da, tasdiqlash milliy formatda BIR XIL OTP’ni topadi', async () => {
    const e164 = uniquePhone();
    const national = e164.replace('+998', '');

    const code = await requestAndGetCode(e164, 'REGISTER');
    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/verify-otp')
      .send({ phone: national, code }) // ATAYLAB milliy formatda — request'dan farqli
      .expect(200);
    expect(typeof res.body.registrationToken).toBe('string');
  });

  t('Qayta so‘rash cooldown ichida RATE_LIMITED qaytaradi', async () => {
    const phone = uniquePhone();
    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone })
      .expect(200);
    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  t('Cooldown MAQSAD bo‘yicha ajratilgan — REGISTER so‘ralgach darhol PASSWORD_RESET so‘rash bloklanmaydi', async () => {
    // Yuqoridagi testlar jamlanib IP soatlik byudjetini tugatgan bo'lishi
    // mumkin — bu test o'ziga xos budjet bilan mustaqil ishlashi kerak.
    await flushIpCounter();
    const phone = uniquePhone();
    await withDb(async (db) => {
      const ids = app!.get(IdFactory);
      await db.user.create({ data: { id: ids.next(), phone, roles: [], verified: true } });
    });
    await request(app!.getHttpServer())
      .post('/api/v1/auth/register/request-otp')
      .send({ phone })
      .expect(200);
    await request(app!.getHttpServer())
      .post('/api/v1/auth/password-reset/request-otp')
      .send({ phone })
      .expect(200);
    await flushIpCounter();
  });

  t('Kunlik chegara MAQSAD’dan qat’iy nazar umumiy — REGISTER/PASSWORD_RESET almashtirib bypass qilinmaydi', async () => {
    const phone = uniquePhone();
    await withDb(async (db) => {
      const ids = app!.get(IdFactory);
      await db.user.create({ data: { id: ids.next(), phone, roles: [], verified: true } });
    });
    const results: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const path = i % 2 === 0 ? '/api/v1/auth/register/request-otp' : '/api/v1/auth/password-reset/request-otp';
      const res = await request(app!.getHttpServer()).post(path).send({ phone });
      results.push(res.status);
      await flushCooldownOnly();
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
    await flushIpCounter();
  });

  // ── Refresh rotatsiya + reuse detection (o'zgarmagan mexanika) ────────────

  t('Refresh — rotatsiya: eski cookie qayta kelsa TOKEN_REUSED va butun oila bekor bo‘ladi', async () => {
    const { refreshCookie } = await registerFresh();

    const rotated = await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    const newCookie = (rotated.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    expect(newCookie).not.toBe(refreshCookie);

    const reuse = await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('TOKEN_REUSED');

    const afterFamily = await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', newCookie);
    expect(afterFamily.status).toBe(401);
    expect(afterFamily.body.code).toBe('TOKEN_REUSED');
  });

  t('Refresh — parallel so‘rov: faqat BITTASI g‘olib chiqadi, ikkalasi ham keyin bekor', async () => {
    const { refreshCookie } = await registerFresh();

    const [r1, r2] = await Promise.all([
      request(app!.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', refreshCookie),
      request(app!.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', refreshCookie),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 401]);

    const winner = r1.status === 200 ? r1 : r2;
    const winnerCookie = (winner.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;

    const after = await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', winnerCookie);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('TOKEN_REUSED');
  });

  // ── Rol tanlash / almashtirish (o'zgarmagan) ──────────────────────────────

  t('roles/choose → keyingi choose BAD_STATE, switch faqat egallagan rolga', async () => {
    const { accessToken } = await registerFresh();

    const chosen = await request(app!.getHttpServer())
      .post('/api/v1/me/roles/choose')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'BUYER' })
      .expect(200);
    expect(chosen.body.activeRole).toBe('BUYER');
    expect(chosen.body.roleChosen).toBe(true);
    const newAccess = chosen.body.accessToken as string;

    await request(app!.getHttpServer())
      .post('/api/v1/me/roles/choose')
      .set('Authorization', `Bearer ${newAccess}`)
      .send({ role: 'SELLER' })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('BAD_STATE'));

    await request(app!.getHttpServer())
      .post('/api/v1/me/roles/switch')
      .set('Authorization', `Bearer ${newAccess}`)
      .send({ role: 'SELLER' })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('NOT_ALLOWED'));

    await request(app!.getHttpServer())
      .post('/api/v1/me/roles/switch')
      .set('Authorization', `Bearer ${newAccess}`)
      .send({ role: 'BUYER' })
      .expect(200)
      .expect((r) => expect(r.body.activeRole).toBe('BUYER'));
  });

  t('RolesGuard — rol tanlanmagan (activeRole=null) himoyalangan marshrutga kirolmaydi', async () => {
    const { accessToken } = await registerFresh();
    await request(app!.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect((r) => expect(r.body.activeRole).toBeNull());
  });

  // ── Sessiya egaligi (o'zgarmagan) ─────────────────────────────────────────

  t('Sessiyalar ro‘yxati + bitta sessiyani tugatish (o‘ziniki) + boshqa foydalanuvchining sessiyasi NOT_FOUND', async () => {
    const userA = await registerFresh();
    const userB = await registerFresh();

    const list = await request(app!.getHttpServer())
      .get('/api/v1/me/sessions')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body[0].current).toBe(true);
    const userASessionId = list.body[0].id as string;

    const listB = await request(app!.getHttpServer())
      .get('/api/v1/me/sessions')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);
    const userBSessionId = listB.body[0].id as string;

    await request(app!.getHttpServer())
      .delete(`/api/v1/me/sessions/${userASessionId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(404);

    await request(app!.getHttpServer())
      .delete(`/api/v1/me/sessions/${userBSessionId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);

    await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', userB.refreshCookie)
      .expect(401);
  });

  t('Logout — joriy qurilmani yopadi, refresh endi ishlamaydi', async () => {
    const { accessToken, refreshCookie } = await registerFresh();
    await request(app!.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', refreshCookie)
      .expect(200);

    await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
  });

  t('Logout — access token eskirgan yoki yo‘q bo‘lsa ham 200 qaytaradi, cookieni tozalaydi va refresh tokenni bekor qiladi', async () => {
    const { refreshCookie } = await registerFresh();
    const res = await request(app!.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', 'Bearer invalid-or-expired-token')
      .set('Cookie', refreshCookie)
      .expect(200);

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();

    await request(app!.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(401);
  });

  t('Token yo‘q → NO_SESSION, yaroqsiz token → UNAUTHENTICATED', async () => {
    await request(app!.getHttpServer())
      .get('/api/v1/me')
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('NO_SESSION'));

    await request(app!.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401)
      .expect((r) => expect(r.body.code).toBe('UNAUTHENTICATED'));
  });

  // Sanity: OTP kodi VA parol hech qachon DB'da ochiq matnda saqlanmaydi.
  t('OtpCode.codeHash / User.passwordHash — xom qiymat EMAS (argon2id format)', async () => {
    const { phone } = await registerFresh();
    const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    try {
      const row = await db.otpCode.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } });
      expect(row?.codeHash).toMatch(/^\$argon2id\$/);

      const user = await db.user.findUnique({ where: { phone } });
      expect(user?.passwordHash).not.toBe(TEST_PASSWORD);
      expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    } finally {
      await db.$disconnect();
    }
  });

  // ATAYLAB OXIRIDA: bu test bitta IP'ning soatlik kvotasini "kuydiradi" —
  // undan keyin shu IP'dan yana OTP so'ragan HAR bir test rad etilardi.
  t('Bitta IP’dan soatlik chegaradan oshsa RATE_LIMITED (turli telefon, cooldown’ga tegmaydi)', async () => {
    const results: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await request(app!.getHttpServer())
        .post('/api/v1/auth/register/request-otp')
        .send({ phone: uniquePhone() });
      results.push(res.status);
    }
    expect(results.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  /**
   * OTP verify xavfsizlik mustahkamlash — `verify-otp` ILGARI hech qanday
   * so'rov darajasidagi chegaraga ega emas edi (faqat bitta kodning O'ZI
   * uchun 5-urinish limiti, endi atomik — yuqoridagi RACE testlarga
   * qarang). Bu IP chegara turli telefon/kodlarga qarshi hajmli
   * suiiste'molni (har bir urinish argon2id hisoblaydi — CPU xarajati)
   * cheklaydi. `otp:verify:ip:` kaliti `otp:ip:` (so'rash tomoni)dan
   * ALOHIDA — shuning uchun bu test yuqoridagi (fayl davomida to'plangan)
   * holatdan mustaqil, xuddi tepadagi so'rash-tomoni testi kabi "yetarlicha
   * ko'p yubor, kamida bitta 429 borligini tekshir" uslubida.
   */
  /**
   * qa-engineer cross-review topilmasi — ilgari faqat "kamida bitta 429
   * bor" tekshirilardi (limit=1 bo'lsa ham o'tardi) va faqat REGISTER
   * yo'nalishi sinalardi. Endi: ANIQ chegara (band bo'lmagan `RATE_LIMITED`
   * kodi bilan) VA hisoblagich REGISTER/PASSWORD_RESET orasida ATAYLAB
   * UMUMIY ekanligi (`enforceVerifyOtpIpLimit`, bitta `otp:verify:ip:`
   * kaliti) ham tasdiqlanadi.
   */
  t('Verify-otp: bitta IP’dan ANIQ chegaradan oshsa RATE_LIMITED — REGISTER va PASSWORD_RESET bitta hisoblagichni bo‘lishadi', async () => {
    await flushVerifyIpCounter(); // fayl davomida to'plangan holatdan mustaqil, aniq natija uchun
    try {
      const results: number[] = [];
      for (let i = 0; i < OTP_VERIFY_IP_MAX_ATTEMPTS; i += 1) {
        const res = await request(app!.getHttpServer())
          .post('/api/v1/auth/register/verify-otp')
          .send({ phone: uniquePhone(), code: '000000' });
        results.push(res.status);
      }
      // Chegaragacha (ANIQ shu son) — hech biri rate-limit bilan bloklanmagan
      // (OTP topilmagani uchun barchasi INVALID_CODE, lekin muhimi — 429 EMAS).
      expect(results.every((s) => s !== 429)).toBe(true);

      // Chegaradan bitta ortiq — REGISTER yo'nalishida ANIQ shu so'rov 429ga tushadi.
      const overRegister = await request(app!.getHttpServer())
        .post('/api/v1/auth/register/verify-otp')
        .send({ phone: uniquePhone(), code: '000000' })
        .expect(429);
      expect(overRegister.body.code).toBe('RATE_LIMITED');

      // Hisoblagich UMUMIY — PASSWORD_RESET yo'nalishi ham DARHOL bloklanadi
      // (o'z chegarasini alohida boshlamaydi).
      const overReset = await request(app!.getHttpServer())
        .post('/api/v1/auth/password-reset/verify-otp')
        .send({ phone: uniquePhone(), code: '000000' })
        .expect(429);
      expect(overReset.body.code).toBe('RATE_LIMITED');
    } finally {
      await flushVerifyIpCounter();
    }
  });
});
