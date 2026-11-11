import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://bobololadono_app:app@localhost:5432/db?schema=public',
  DATABASE_MIGRATION_URL: 'postgresql://bobololadono_migrator:migrator@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  // Bosqich 2 — MAJBURIY (≥32 belgi).
  JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-32',
  JWT_STAFF_ACCESS_SECRET: 'test-staff-secret-test-staff-secret-32',
  // Bosqich 11 — MAJBURIY (64 ta hex belgi).
  STAFF_TOTP_ENCRYPTION_KEY: 'a'.repeat(64),
};

// Bosqich 12 — PAYMENT_PROVIDER=PAYME tanlansa 4 ta maydon HAM majburiy.
const paymeCreds = {
  PAYME_MERCHANT_ID: 'test-merchant-id',
  PAYME_LOGIN: 'Paycom',
  PAYME_KEY: 'test-payme-key',
  PAYME_CHECKOUT_URL: 'https://test.paycom.uz',
};

// Bosqich 13 — SMS_PROVIDER=PLAYMOBILE tanlansa 4 ta maydon HAM majburiy.
const playMobileCreds = {
  SMS_PROVIDER: 'PLAYMOBILE',
  PLAYMOBILE_API_URL: 'https://send.example.uz/broker-api',
  PLAYMOBILE_LOGIN: 'test-login',
  PLAYMOBILE_PASSWORD: 'test-password',
  PLAYMOBILE_SENDER: 'Bobololadon',
};

// Bosqich 23 (v4) — SMS_PROVIDER=TEXTUP tanlansa 4 ta maydon HAM majburiy
// (TEXTUP_EXPECTED_USER_ID/NICKNAME_ID/*_TEMPLATE_ID ixtiyoriy).
const textUpCreds = {
  SMS_PROVIDER: 'TEXTUP',
  TEXTUP_AUTH_URL: 'https://api-auth.textup.uz/v1/login',
  TEXTUP_SMS_URL: 'https://sms-api.textup.uz/v1/send',
  TEXTUP_EMAIL: 'test@textup.uz',
  TEXTUP_PASSWORD: 'test-password',
};

describe('validateEnv', () => {
  it('minimal majburiy env bilan o’tadi va default’larni to’ldiradi', () => {
    const env = validateEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.SWAGGER_ENABLED).toBe(true);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.STAFF_CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
  });

  it('DATABASE_URL yo’q bo’lsa xato tashlaydi (app boot bo’lmaydi)', () => {
    expect(() => validateEnv({ REDIS_URL: base.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('REDIS_URL yo’q bo’lsa xato tashlaydi', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: base.DATABASE_URL,
        DATABASE_MIGRATION_URL: base.DATABASE_MIGRATION_URL,
      }),
    ).toThrow(/REDIS_URL/);
  });

  it('DATABASE_MIGRATION_URL yo’q bo’lsa xato tashlaydi (A4 — rol ajratish majburiy)', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: base.DATABASE_URL, REDIS_URL: base.REDIS_URL }),
    ).toThrow(/DATABASE_MIGRATION_URL/);
  });

  it('DATABASE_MIGRATION_URL — DATABASE_URL dan alohida qiymat', () => {
    const env = validateEnv({ ...base });
    expect(env.DATABASE_MIGRATION_URL).toBe(base.DATABASE_MIGRATION_URL);
    expect(env.DATABASE_MIGRATION_URL).not.toBe(env.DATABASE_URL);
  });

  it('noto’g’ri PORT rad etiladi', () => {
    expect(() => validateEnv({ ...base, PORT: '99999' })).toThrow();
    expect(() => validateEnv({ ...base, PORT: 'abc' })).toThrow();
  });

  it('CORS_ORIGINS vergul bilan ajratilgan ro’yxatga aylanadi', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: 'http://a.test, http://b.test ,http://c.test',
    });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test', 'http://c.test']);
  });

  it('STAFF_CORS_ORIGINS — CORS_ORIGINS’dan mustaqil, o‘zining ro‘yxatiga aylanadi (bo‘lim 3 — admin.bobololadono.uz izolyatsiyasi)', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://app.bobololadono.uz']);
    expect(env.STAFF_CORS_ORIGINS).toEqual(['https://admin.bobololadono.uz']);
  });

  it('production’da STAFF_CORS_ORIGINS sukuti (localhost) rad etiladi (fail closed — ikkinchi security ko‘rib chiqishi topilmasi)', () => {
    expect(() =>
      validateEnv({
        ...base,
        ...paymeCreds,
        ...playMobileCreds,
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'false',
        PAYMENT_PROVIDER: 'PAYME',
        CORS_ORIGINS: 'https://app.bobololadono.uz',
        // STAFF_CORS_ORIGINS berilmagan — sukut http://localhost:3000 qoladi.
      }),
    ).toThrow(/STAFF_CORS_ORIGINS/);
  });

  it('production’da STAFF_CORS_ORIGINS va CORS_ORIGINS bir xil manzilni o‘z ichiga olsa rad etiladi (izolyatsiya kafolati)', () => {
    expect(() =>
      validateEnv({
        ...base,
        ...paymeCreds,
        ...playMobileCreds,
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'false',
        PAYMENT_PROVIDER: 'PAYME',
        CORS_ORIGINS: 'https://app.bobololadono.uz,https://admin.bobololadono.uz',
        STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      }),
    ).toThrow(/STAFF_CORS_ORIGINS/);
  });

  it('production’da STAFF_CORS_ORIGINS va CORS_ORIGINS mustaqil (ustma-ust tushmaydigan) https ro‘yxatlar bilan o‘tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...playMobileCreds,
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://app.bobololadono.uz']);
    expect(env.STAFF_CORS_ORIGINS).toEqual(['https://admin.bobololadono.uz']);
  });

  it('SWAGGER_ENABLED "0"/"false" ni boolean false qiladi', () => {
    expect(validateEnv({ ...base, SWAGGER_ENABLED: '0' }).SWAGGER_ENABLED).toBe(false);
    expect(validateEnv({ ...base, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });

  it('production’da SWAGGER_ENABLED=true rad etiladi (fail closed)', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }),
    ).toThrow(/SWAGGER_ENABLED/);
  });

  it('production’da SWAGGER_ENABLED=false bilan o’tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...playMobileCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('DB_ROLE_ASSERTION sukut bo’yicha "on" (true)', () => {
    expect(validateEnv({ ...base }).DB_ROLE_ASSERTION).toBe(true);
  });

  it('DB_ROLE_ASSERTION="off" false qiladi (dev/test)', () => {
    expect(validateEnv({ ...base, DB_ROLE_ASSERTION: 'off' }).DB_ROLE_ASSERTION).toBe(false);
  });

  it('production’da DB_ROLE_ASSERTION=off rad etiladi (F1 — fail closed)', () => {
    expect(() =>
      validateEnv({
        ...base,
        ...paymeCreds,
        NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
        SWAGGER_ENABLED: 'false',
        DB_ROLE_ASSERTION: 'off',
        PAYMENT_PROVIDER: 'PAYME',
      }),
    ).toThrow(/DB_ROLE_ASSERTION/);
  });

  it('production’da DB_ROLE_ASSERTION sukut (on) bilan o’tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...playMobileCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
    });
    expect(env.DB_ROLE_ASSERTION).toBe(true);
  });

  it('PAYMENT_PROVIDER sukut bo’yicha "TEST"', () => {
    expect(validateEnv({ ...base }).PAYMENT_PROVIDER).toBe('TEST');
  });

  it('production’da PAYMENT_PROVIDER=TEST (sukut) rad etiladi (fail closed)', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', SWAGGER_ENABLED: 'false' })).toThrow(
      /PAYMENT_PROVIDER/,
    );
  });

  it('PAYMENTS_ENABLED sukut bo’yicha "true"', () => {
    expect(validateEnv({ ...base }).PAYMENTS_ENABLED).toBe(true);
  });

  it('Bosqich 23 — production’da PAYMENTS_ENABLED=false + PAYMENT_PROVIDER=TEST (sukut) — o‘tadi (xavfsiz o‘chirilgan)', () => {
    const env = validateEnv({
      ...base,
      ...playMobileCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENTS_ENABLED: 'false',
    });
    expect(env.PAYMENTS_ENABLED).toBe(false);
    expect(env.PAYMENT_PROVIDER).toBe('TEST');
  });

  it('Bosqich 23 — PAYMENTS_ENABLED=false + PAYMENT_PROVIDER=PAYME, credential’lar yo‘q — baribir o‘tadi (PAYME tekshiruvi o‘tkazib yuboriladi)', () => {
    const env = validateEnv({ ...base, PAYMENTS_ENABLED: 'false', PAYMENT_PROVIDER: 'PAYME' });
    expect(env.PAYMENTS_ENABLED).toBe(false);
  });

  it('production’da PAYMENT_PROVIDER=PAYME to‘liq credential bilan o’tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...playMobileCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
    });
    expect(env.PAYMENT_PROVIDER).toBe('PAYME');
    expect(env.PAYME_CHECKOUT_URL).toBe(paymeCreds.PAYME_CHECKOUT_URL);
  });

  it('Bosqich 12 — PAYMENT_PROVIDER=PAYME, lekin credential’lar yo‘q — rad etiladi (dev’da ham, ikkinchi qatlam himoya)', () => {
    expect(() => validateEnv({ ...base, PAYMENT_PROVIDER: 'PAYME' })).toThrow(/PAYME_MERCHANT_ID/);
  });

  it('Bosqich 12 — PAYMENT_PROVIDER=PAYME, faqat BAZI credential’lar bor — qolganlari nomma-nom sanaladi', () => {
    try {
      validateEnv({ ...base, PAYMENT_PROVIDER: 'PAYME', PAYME_MERCHANT_ID: 'm-1' });
      fail('xato kutilgan edi');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('PAYME_MERCHANT_ID');
      expect(message).toContain('PAYME_LOGIN');
      expect(message).toContain('PAYME_KEY');
      expect(message).toContain('PAYME_CHECKOUT_URL');
    }
  });

  it('Bosqich 12 — PAYMENT_PROVIDER=PAYME to‘liq credential bilan dev’da ham o’tadi', () => {
    const env = validateEnv({ ...base, ...paymeCreds, PAYMENT_PROVIDER: 'PAYME' });
    expect(env.PAYME_MERCHANT_ID).toBe(paymeCreds.PAYME_MERCHANT_ID);
    expect(env.PAYME_LOGIN).toBe(paymeCreds.PAYME_LOGIN);
  });

  it('Bosqich 12 — PAYME_CHECKOUT_URL noto‘g‘ri URL bo‘lsa rad etiladi', () => {
    expect(() =>
      validateEnv({ ...base, ...paymeCreds, PAYMENT_PROVIDER: 'PAYME', PAYME_CHECKOUT_URL: 'not-a-url' }),
    ).toThrow(/PAYME_CHECKOUT_URL/);
  });

  it('Bosqich 12 — PAYMENT_PROVIDER=TEST (sukut) bo‘lsa PAYME credential’lari kerak emas', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it('PAYOUT_PROVIDER sukut bo’yicha "TEST"', () => {
    expect(validateEnv({ ...base }).PAYOUT_PROVIDER).toBe('TEST');
  });

  it('Bosqich 13 — PAYOUTS_ENABLED sukut bo‘yicha true', () => {
    expect(validateEnv({ ...base }).PAYOUTS_ENABLED).toBe(true);
  });

  it('Bosqich 13 — PAYOUTS_ENABLED="false" bilan o‘tadi', () => {
    expect(validateEnv({ ...base, PAYOUTS_ENABLED: 'false' }).PAYOUTS_ENABLED).toBe(false);
  });

  it('SMS_PROVIDER sukut bo’yicha "CONSOLE"', () => {
    expect(validateEnv({ ...base }).SMS_PROVIDER).toBe('CONSOLE');
  });

  it('Bosqich 13 — SMS_PROVIDER=PLAYMOBILE, credential’lar yo‘q — rad etiladi', () => {
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'PLAYMOBILE' })).toThrow(/PLAYMOBILE_API_URL/);
  });

  it('Bosqich 13 — SMS_PROVIDER=PLAYMOBILE, to‘liq credential bilan o‘tadi', () => {
    const env = validateEnv({
      ...base,
      SMS_PROVIDER: 'PLAYMOBILE',
      PLAYMOBILE_API_URL: 'https://send.example.uz/broker-api',
      PLAYMOBILE_LOGIN: 'test-login',
      PLAYMOBILE_PASSWORD: 'test-password',
      PLAYMOBILE_SENDER: 'Bobololadon',
    });
    expect(env.SMS_PROVIDER).toBe('PLAYMOBILE');
    expect(env.PLAYMOBILE_SENDER).toBe('Bobololadon');
  });

  it('Bosqich 13 — PLAYMOBILE_SENDER 11 belgidan uzun bo‘lsa rad etiladi', () => {
    expect(() =>
      validateEnv({
        ...base,
        SMS_PROVIDER: 'PLAYMOBILE',
        PLAYMOBILE_API_URL: 'https://send.example.uz/broker-api',
        PLAYMOBILE_LOGIN: 'test-login',
        PLAYMOBILE_PASSWORD: 'test-password',
        PLAYMOBILE_SENDER: 'TooLongSenderName',
      }),
    ).toThrow(/PLAYMOBILE_SENDER/);
  });

  it('OTP policy — production’da SMS_PROVIDER=CONSOLE (sukut) rad etiladi (fail closed)', () => {
    expect(() =>
      validateEnv({ ...base, ...paymeCreds, NODE_ENV: 'production', SWAGGER_ENABLED: 'false', PAYMENT_PROVIDER: 'PAYME' }),
    ).toThrow(/SMS_PROVIDER/);
  });

  it('OTP policy — production’da SMS_PROVIDER=PLAYMOBILE to‘liq credential bilan o’tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...playMobileCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
    });
    expect(env.SMS_PROVIDER).toBe('PLAYMOBILE');
  });

  it('Bosqich 23 — SMS_PROVIDER=TEXTUP, credential’lar yo‘q — rad etiladi', () => {
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'TEXTUP' })).toThrow(/TEXTUP_AUTH_URL/);
  });

  it('Bosqich 23 — SMS_PROVIDER=TEXTUP, to‘liq credential bilan o‘tadi', () => {
    const env = validateEnv({ ...base, ...textUpCreds });
    expect(env.SMS_PROVIDER).toBe('TEXTUP');
    expect(env.TEXTUP_AUTH_URL).toBe('https://api-auth.textup.uz/v1/login');
    expect(env.TEXTUP_SMS_URL).toBe('https://sms-api.textup.uz/v1/send');
  });

  it('Bosqich 23 — TEXTUP_EXPECTED_USER_ID/NICKNAME_ID/*_TEMPLATE_ID ixtiyoriy — bo‘lmasa ham o‘tadi', () => {
    const env = validateEnv({ ...base, ...textUpCreds });
    expect(env.TEXTUP_EXPECTED_USER_ID).toBeUndefined();
    expect(env.TEXTUP_NICKNAME_ID).toBeUndefined();
    expect(env.TEXTUP_REGISTRATION_TEMPLATE_ID).toBeUndefined();
    expect(env.TEXTUP_PASSWORD_RESET_TEMPLATE_ID).toBeUndefined();
  });

  it('OTP policy — production’da SMS_PROVIDER=TEXTUP to‘liq credential bilan o’tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...textUpCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
    });
    expect(env.SMS_PROVIDER).toBe('TEXTUP');
  });

  it('OTP policy — production’da SMS_PROVIDER=TEXTUP, credential’lar yo‘q — rad etiladi (fail closed)', () => {
    expect(() =>
      validateEnv({
        ...base,
        ...paymeCreds,
        NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
        SWAGGER_ENABLED: 'false',
        PAYMENT_PROVIDER: 'PAYME',
        SMS_PROVIDER: 'TEXTUP',
      }),
    ).toThrow(/TEXTUP_AUTH_URL/);
  });

  it('Bo’lim 25 — production’da DEV_EXPOSE_OTP=true rad etiladi (fail closed, boot vaqtida)', () => {
    expect(() =>
      validateEnv({
        ...base,
        ...paymeCreds,
        ...playMobileCreds,
        NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
        SWAGGER_ENABLED: 'false',
        PAYMENT_PROVIDER: 'PAYME',
        DEV_EXPOSE_OTP: 'true',
      }),
    ).toThrow(/DEV_EXPOSE_OTP/);
  });

  it('Bo’lim 25 — production’da DEV_EXPOSE_OTP=false (sukut) bilan o’tadi', () => {
    const env = validateEnv({
      ...base,
      ...paymeCreds,
      ...playMobileCreds,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.bobololadono.uz',
      STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
      SWAGGER_ENABLED: 'false',
      PAYMENT_PROVIDER: 'PAYME',
    });
    expect(env.DEV_EXPOSE_OTP).toBe(false);
  });

  it('Bo’lim 25 — dev’da (production emas) DEV_EXPOSE_OTP=true baribir o’tadi (runtime qatlam alohida tekshiradi)', () => {
    const env = validateEnv({ ...base, DEV_EXPOSE_OTP: 'true' });
    expect(env.DEV_EXPOSE_OTP).toBe(true);
  });

  it('Bosqich 10 — OUTBOX_* sukut qiymatlari', () => {
    const env = validateEnv({ ...base });
    expect(env.OUTBOX_PROCESSING_TIMEOUT_SECONDS).toBe(120);
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
    expect(env.OUTBOX_WORKER_CONCURRENCY).toBe(5);
    expect(env.OUTBOX_MAX_ATTEMPTS).toBe(6);
    expect(env.OUTBOX_RETRY_BASE_SECONDS).toBe(30);
    expect(env.OUTBOX_RETRY_MAX_SECONDS).toBe(3600);
    expect(env.OUTBOX_SWEEP_INTERVAL_SECONDS).toBe(30);
  });

  it('DB_APP_ROLE sukut bo’yicha "bobololadono_app"', () => {
    expect(validateEnv({ ...base }).DB_APP_ROLE).toBe('bobololadono_app');
  });

  it('DB_APP_ROLE boshqa kvotalanmagan identifikatorni qabul qiladi', () => {
    expect(validateEnv({ ...base, DB_APP_ROLE: 'custom_app_role' }).DB_APP_ROLE).toBe(
      'custom_app_role',
    );
  });

  it('DB_APP_ROLE noto‘g‘ri identifikatorlarni rad etadi (T1)', () => {
    expect(() => validateEnv({ ...base, DB_APP_ROLE: '1bad' })).toThrow(/DB_APP_ROLE/);
    expect(() => validateEnv({ ...base, DB_APP_ROLE: 'has space' })).toThrow(/DB_APP_ROLE/);
    expect(() => validateEnv({ ...base, DB_APP_ROLE: "app'; DROP TABLE users; --" })).toThrow(
      /DB_APP_ROLE/,
    );
    expect(() => validateEnv({ ...base, DB_APP_ROLE: 'a'.repeat(64) })).toThrow(/DB_APP_ROLE/);
  });

  it('JWT_ACCESS_SECRET yo‘q yoki 32 belgidan qisqa bo‘lsa xato tashlaydi', () => {
    const { JWT_ACCESS_SECRET: _drop, ...withoutSecret } = base;
    expect(() => validateEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'too-short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('JWT_STAFF_ACCESS_SECRET marketplace’dan ALOHIDA majburiy maydon', () => {
    const { JWT_STAFF_ACCESS_SECRET: _drop, ...withoutStaffSecret } = base;
    expect(() => validateEnv(withoutStaffSecret)).toThrow(/JWT_STAFF_ACCESS_SECRET/);
  });

  it('JWT_ACCESS_TTL/JWT_REFRESH_TTL — noto‘g‘ri format (`\\d+[smhd]` emas) rad etiladi', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_TTL: '15 minutes' })).toThrow(/JWT_ACCESS_TTL/);
    expect(() => validateEnv({ ...base, JWT_REFRESH_TTL: '30' })).toThrow(/JWT_REFRESH_TTL/);
  });

  it('JWT TTL sukut qiymatlari', () => {
    const env = validateEnv({ ...base });
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('30d');
    expect(env.JWT_STAFF_ACCESS_TTL).toBe('15m');
    expect(env.JWT_STAFF_REFRESH_TTL).toBe('8h');
  });

  it('bir nechta muammoni bitta xabarda sanaydi', () => {
    try {
      validateEnv({ DATABASE_URL: 'not-a-url' });
      fail('xato kutilgan edi');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
    }
  });

  describe('Click Payment & Payme Payout & 547-sonli Qonun', () => {
    it('PAYMENT_PROVIDER=CLICK rad etiladi (Click bilan shartnoma mavjud emas)', () => {
      expect(() =>
        validateEnv({
          ...base,
          PAYMENT_PROVIDER: 'CLICK',
          CLICK_MERCHANT_ID: 'click-merch-1',
          CLICK_SERVICE_ID: 'click-serv-1',
          CLICK_SECRET_KEY: 'click-secret-key-1',
        }),
      ).toThrow(/Click bilan shartnoma mavjud emas/);
    });

    it('PAYOUT_PROVIDER=PAYME credential yetishmasa rad etiladi', () => {
      expect(() =>
        validateEnv({
          ...base,
          PAYOUT_PROVIDER: 'PAYME',
        }),
      ).toThrow(/PAYME_PAYOUT_LOGIN/);
    });

    it('PAYOUT_PROVIDER=PAYME to‘liq credential bilan o‘tadi', () => {
      const env = validateEnv({
        ...base,
        PAYOUT_PROVIDER: 'PAYME',
        PAYME_PAYOUT_LOGIN: 'payme-payout-login',
        PAYME_PAYOUT_KEY: 'payme-payout-key',
      });
      expect(env.PAYOUT_PROVIDER).toBe('PAYME');
      expect(env.PAYME_PAYOUT_LOGIN).toBe('payme-payout-login');
    });

    it('547-sonli Qonun: production’da xorijiy AWS S3 rad etiladi', () => {
      expect(() =>
        validateEnv({
          ...base,
          ...paymeCreds,
          ...textUpCreds,
          NODE_ENV: 'production',
          SWAGGER_ENABLED: 'false',
          STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
          CORS_ORIGINS: 'https://bobololadono.uz',
          PAYMENT_PROVIDER: 'PAYME',
          S3_ENDPOINT: 'https://mybucket.s3.amazonaws.com',
        }),
      ).toThrow(/547-sonli Qonunning 27¹-moddasi buzilishi/);
    });

    it('547-sonli Qonun: production’da O‘zbekiston ichki S3/MinIO o‘tadi', () => {
      const env = validateEnv({
        ...base,
        ...paymeCreds,
        ...textUpCreds,
        NODE_ENV: 'production',
        SWAGGER_ENABLED: 'false',
        STAFF_CORS_ORIGINS: 'https://admin.bobololadono.uz',
        CORS_ORIGINS: 'https://bobololadono.uz',
        PAYMENT_PROVIDER: 'PAYME',
        S3_ENDPOINT: 'https://s3.tashkent.bobololadono.uz',
        DATA_RESIDENCY_COUNTRY: 'UZ',
      });
      expect(env.DATA_RESIDENCY_COUNTRY).toBe('UZ');
      expect(env.DATA_RESIDENCY_ASSERTION).toBe(true);
    });
  });
});
