import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Tiplashtirilgan konfiguratsiya. Kod hech qayerda `process.env` ni
 * to'g'ridan-to'g'ri o'qimaydi — faqat shu servis orqali (validatsiyadan
 * o'tgan, tiplangan qiymatlar).
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  get port(): number {
    return this.get('PORT');
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.get('LOG_LEVEL');
  }

  get swaggerEnabled(): boolean {
    return this.isProduction ? false : this.get('SWAGGER_ENABLED');
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS');
  }

  /** Bo'lim 3 (admin.bobololadono.uz) — `staff/*` yo'llari uchun ALOHIDA, torroq
      ro'yxat (`main.ts`dagi CORS delegate). `corsOrigins`dan mustaqil. */
  get staffCorsOrigins(): string[] {
    return this.get('STAFF_CORS_ORIGINS');
  }

  /** Bosqich 12, bo'lim 38 — Express `trust proxy`ga uzatiladigan xom qiymat (`main.ts`). */
  get trustProxy(): string {
    return this.get('TRUST_PROXY');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  /** `bobololadono_migrator` roli — faqat `prisma migrate` CLI ishlatadi. */
  get databaseMigrationUrl(): string {
    return this.get('DATABASE_MIGRATION_URL');
  }

  /** F1 — boot paytidagi rol/append-only tekshiruvi yoqilganmi (prod'da doim true). */
  get dbRoleAssertionEnabled(): boolean {
    return this.get('DB_ROLE_ASSERTION');
  }

  /** T1 — runtime uchun kutilgan DB roli (F1 shu bilan solishtiradi). Sukut `bobololadono_app`. */
  get dbAppRole(): string {
    return this.get('DB_APP_ROLE');
  }

  get redisUrl(): string {
    return this.get('REDIS_URL');
  }

  get s3(): {
    endpoint: string | undefined;
    region: string;
    accessKey: string | undefined;
    secretKey: string | undefined;
    bucketUploads: string;
    bucketKyc: string;
  } {
    return {
      endpoint: this.get('S3_ENDPOINT'),
      region: this.get('S3_REGION'),
      accessKey: this.get('S3_ACCESS_KEY'),
      secretKey: this.get('S3_SECRET_KEY'),
      bucketUploads: this.get('S3_BUCKET_UPLOADS'),
      bucketKyc: this.get('S3_BUCKET_KYC'),
    };
  }

  /**
   * Marketplace (User) JWT — staff'dan ATAYLAB alohida sir (ADR-04).
   * `refreshTtl` — opaque refresh token muddati (`RefreshToken.expiresAt`
   * hisoblash uchun; JWT emas, sirlanmaydi — `opaque-token.util.ts`).
   */
  get jwt(): { accessSecret: string; accessTtl: string; refreshTtl: string } {
    return {
      accessSecret: this.get('JWT_ACCESS_SECRET'),
      accessTtl: this.get('JWT_ACCESS_TTL'),
      refreshTtl: this.get('JWT_REFRESH_TTL'),
    };
  }

  /** Staff (admin panel) JWT — marketplace'dan kriptografik jihatdan izolyatsiyalangan. */
  get staffJwt(): { accessSecret: string; accessTtl: string; refreshTtl: string } {
    return {
      accessSecret: this.get('JWT_STAFF_ACCESS_SECRET'),
      accessTtl: this.get('JWT_STAFF_ACCESS_TTL'),
      refreshTtl: this.get('JWT_STAFF_REFRESH_TTL'),
    };
  }

  /** Bosqich 11 — TOTP at-rest shifrlash kaliti, hex qatordan `Buffer`ga oldindan parse qilingan (`totp-secret-cipher.util.ts`). */
  get staffTotpEncryptionKey(): Buffer {
    return Buffer.from(this.get('STAFF_TOTP_ENCRYPTION_KEY'), 'hex');
  }

  /** Bosqich 5 — `payment.module.ts` shundan provider'ni tanlaydi. */
  get payment(): { provider: Env['PAYMENT_PROVIDER']; testWebhookSecret: string | undefined } {
    return {
      provider: this.get('PAYMENT_PROVIDER'),
      testWebhookSecret: this.get('PAYMENT_TEST_WEBHOOK_SECRET'),
    };
  }

  /** Bosqich 23 — real Payme credential hali yo'q bo'lsa, feature butunlay o'chiriladi (`false`, `PAYOUTS_ENABLED` bilan bir xil falsafa). */
  get paymentsEnabled(): boolean {
    return this.get('PAYMENTS_ENABLED');
  }

  /** Bosqich 12 — Payme Merchant API. `PAYMENT_PROVIDER=PAYME` bo'lsa hammasi majburiy (env.schema.ts). */
  get payme(): { merchantId: string | undefined; login: string | undefined; key: string | undefined; checkoutUrl: string | undefined } {
    return {
      merchantId: this.get('PAYME_MERCHANT_ID'),
      login: this.get('PAYME_LOGIN'),
      key: this.get('PAYME_KEY'),
      checkoutUrl: this.get('PAYME_CHECKOUT_URL'),
    };
  }

  /** Rasmiy Click Merchant API. `PAYMENT_PROVIDER=CLICK` bo'lsa majburiy. */
  get click(): {
    merchantId: string | undefined;
    serviceId: string | undefined;
    secretKey: string | undefined;
    checkoutUrl: string | undefined;
  } {
    return {
      merchantId: this.get('CLICK_MERCHANT_ID'),
      serviceId: this.get('CLICK_SERVICE_ID'),
      secretKey: this.get('CLICK_SECRET_KEY'),
      checkoutUrl: this.get('CLICK_CHECKOUT_URL'),
    };
  }

  /** Bosqich 7 — `payout.module.ts` shundan provider'ni tanlaydi (Payment'dan ALOHIDA). */
  get payout(): { provider: Env['PAYOUT_PROVIDER']; testWebhookSecret: string | undefined } {
    return {
      provider: this.get('PAYOUT_PROVIDER'),
      testWebhookSecret: this.get('PAYOUT_TEST_WEBHOOK_SECRET'),
    };
  }

  /** Payme Payout Rail konfiguratsiyasi */
  get paymePayout(): {
    endpoint: string;
    login: string | undefined;
    key: string | undefined;
    webhookSecret: string | undefined;
  } {
    return {
      endpoint: this.get('PAYME_PAYOUT_ENDPOINT'),
      login: this.get('PAYME_PAYOUT_LOGIN'),
      key: this.get('PAYME_PAYOUT_KEY'),
      webhookSecret: this.get('PAYOUT_WEBHOOK_SECRET'),
    };
  }

  /** 547-sonli Qonun — Shaxsiy ma'lumotlar suvereniteti */
  get dataResidency(): { country: string; assertion: boolean } {
    return {
      country: this.get('DATA_RESIDENCY_COUNTRY'),
      assertion: this.get('DATA_RESIDENCY_ASSERTION'),
    };
  }

  /** Bosqich 13, bo'lim 48 — real payout rail hali tanlanmagan bo'lsa, feature butunlay o'chiriladi (`false`). */
  get payoutsEnabled(): boolean {
    return this.get('PAYOUTS_ENABLED');
  }

  /** Bosqich 9 — `ReconciliationService`/`ReconciliationScheduler` shundan o'qiydi. */
  get reconciliation(): {
    paymentAfterSeconds: number;
    refundAfterSeconds: number;
    payoutAfterSeconds: number;
    batchSize: number;
    intervalSeconds: number;
  } {
    return {
      paymentAfterSeconds: this.get('PAYMENT_RECONCILE_AFTER_SECONDS'),
      refundAfterSeconds: this.get('REFUND_RECONCILE_AFTER_SECONDS'),
      payoutAfterSeconds: this.get('PAYOUT_RECONCILE_AFTER_SECONDS'),
      batchSize: this.get('RECONCILIATION_BATCH_SIZE'),
      intervalSeconds: this.get('RECONCILIATION_INTERVAL_SECONDS'),
    };
  }

  /** Bosqich 10 — `sms.module.ts` shundan provider'ni tanlaydi (Payment/Payout bilan bir xil naqsh).
      Bosqich 22 — `devExposeOtp` xom bayroq (yig'indi shart EMAS, faqat env
      qiymati) — yakuniy "ko'rsatilsinmi" qarori `dev-otp.util.ts#shouldExposeDevOtp`da,
      `isProduction` bilan birga, chaqiruvchi joyda hisoblanadi. */
  get sms(): { provider: Env['SMS_PROVIDER']; devExposeOtp: boolean } {
    return { provider: this.get('SMS_PROVIDER'), devExposeOtp: this.get('DEV_EXPOSE_OTP') };
  }

  /** Bosqich 13 — PlayMobile SMS-Broker. `SMS_PROVIDER=PLAYMOBILE` bo'lsa hammasi majburiy (env.schema.ts). */
  get playMobile(): { apiUrl: string | undefined; login: string | undefined; password: string | undefined; sender: string | undefined } {
    return {
      apiUrl: this.get('PLAYMOBILE_API_URL'),
      login: this.get('PLAYMOBILE_LOGIN'),
      password: this.get('PLAYMOBILE_PASSWORD'),
      sender: this.get('PLAYMOBILE_SENDER'),
    };
  }

  /** Bosqich 23 (v4) — TextUp. `SMS_PROVIDER=TEXTUP` bo'lsa birinchi 4tasi majburiy (env.schema.ts). */
  get textUp(): {
    authUrl: string | undefined;
    smsUrl: string | undefined;
    email: string | undefined;
    password: string | undefined;
    expectedUserId: string | undefined;
    nicknameId: string | undefined;
    registrationTemplateId: string | undefined;
    passwordResetTemplateId: string | undefined;
  } {
    return {
      authUrl: this.get('TEXTUP_AUTH_URL'),
      smsUrl: this.get('TEXTUP_SMS_URL'),
      email: this.get('TEXTUP_EMAIL'),
      password: this.get('TEXTUP_PASSWORD'),
      expectedUserId: this.get('TEXTUP_EXPECTED_USER_ID'),
      nicknameId: this.get('TEXTUP_NICKNAME_ID'),
      registrationTemplateId: this.get('TEXTUP_REGISTRATION_TEMPLATE_ID'),
      passwordResetTemplateId: this.get('TEXTUP_PASSWORD_RESET_TEMPLATE_ID'),
    };
  }

  /** Bosqich 10 — Outbox notification delivery worker konfiguratsiyasi. */
  get outbox(): {
    processingTimeoutSeconds: number;
    batchSize: number;
    workerConcurrency: number;
    maxAttempts: number;
    retryBaseSeconds: number;
    retryMaxSeconds: number;
    sweepIntervalSeconds: number;
  } {
    return {
      processingTimeoutSeconds: this.get('OUTBOX_PROCESSING_TIMEOUT_SECONDS'),
      batchSize: this.get('OUTBOX_BATCH_SIZE'),
      workerConcurrency: this.get('OUTBOX_WORKER_CONCURRENCY'),
      maxAttempts: this.get('OUTBOX_MAX_ATTEMPTS'),
      retryBaseSeconds: this.get('OUTBOX_RETRY_BASE_SECONDS'),
      retryMaxSeconds: this.get('OUTBOX_RETRY_MAX_SECONDS'),
      sweepIntervalSeconds: this.get('OUTBOX_SWEEP_INTERVAL_SECONDS'),
    };
  }
}
