import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { PAYMENT_PROVIDER } from '@/modules/payment/providers/payment-provider.interface';
import { TestPaymentProvider, TEST_PROVIDER_SIGNATURE_HEADER } from '@/modules/payment/providers/test/test-payment.provider';
import { PAYOUT_PROVIDER } from '@/modules/payout/providers/payout-provider.interface';
import { TestPayoutProvider } from '@/modules/payout/providers/test/test-payout.provider';
import { ReconciliationService } from '@/modules/reconciliation/reconciliation.service';
import { AnomalyService } from '@/modules/reconciliation/anomaly.service';
import { CapturingSmsProvider, createActiveService, createStaffSession, freshDb, futureIsoDate, loginNewUser, type UserSession } from './support/fixtures';

const DB = 'health_e2e';

/**
 * Bosqich 9 — Reconciliation. Ko'p testlar `ReconciliationService`ni
 * to'g'ridan-to'g'ri `app.get()` orqali chaqiradi (HTTP staff endpoint EMAS)
 * — chunki asosiy da'volar (state-machine tanlovi, CAS race, ledger
 * exactly-once) servis darajasida, HTTP qatlami faqat ingichka wrapper
 * (alohida bo'limda HTTP orqali ham tekshiriladi).
 */
describe('Reconciliation (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let paymentProvider!: TestPaymentProvider;
  let payoutProvider!: TestPayoutProvider;
  let reconciliation!: ReconciliationService;
  let anomalies!: AnomalyService;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('reconciliation.e2e');
    if (!reachable) return;
    await provisionDb(DB);
    await flushRedis();
    sms = new CapturingSmsProvider();
    app = await buildTestApp((b) => b.overrideProvider(SMS_PROVIDER).useValue(sms));
    db = freshDb();
    paymentProvider = app.get<TestPaymentProvider>(PAYMENT_PROVIDER);
    payoutProvider = app.get<TestPayoutProvider>(PAYOUT_PROVIDER);
    reconciliation = app.get(ReconciliationService);
    anomalies = app.get(AnomalyService);
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    await app?.close();
    if (reachable) await dropDatabase(DB);
  });

  beforeEach(async () => {
    if (reachable) await flushRedis();
  });

  const t = (name: string, fn: () => Promise<void>): void =>
    it(name, async () => {
      if (!reachable) return;
      await fn();
    });

  async function fullStaff() {
    return createStaffSession(app!, db!, ['KYC', 'CATEGORIES', 'SERVICES', 'ORDERS', 'USERS', 'PAYMENTS']);
  }

  let webhookCounter = 0;
  function signedPaymentWebhook(payloadObj: Record<string, unknown>) {
    const raw = JSON.stringify(payloadObj);
    return { raw, signature: paymentProvider.signPayload(Buffer.from(raw)) };
  }
  function postPaymentWebhook(raw: string, signature: string) {
    return request(app!.getHttpServer())
      .post('/api/v1/payments/webhooks/TEST')
      .set('Content-Type', 'application/json')
      .set(TEST_PROVIDER_SIGNATURE_HEADER, signature)
      .send(raw);
  }

  interface StuckPaymentFixture {
    paymentId: string;
    providerPaymentId: string;
    contractId: string;
    buyer: UserSession;
    seller: UserSession;
    priceSom: number;
  }

  /** Contract ACTIVE-ga qadar (accept), payment yaratiladi — webhook YUBORILMAYDI (PROCESSING'da "qotib" qoladi). */
  async function createStuckPayment(priceSom = 900_000): Promise<StuckPaymentFixture> {
    const staff = await fullStaff();
    const { serviceId, seller } = await createActiveService(app!, sms, staff.accessToken, { priceSom });
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const created = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] })
      .expect(200);
    const contractId = created.body.id as string;
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    webhookCounter += 1;
    const pay = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', `reconcile-pay-${webhookCounter}`)
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: pay.body.id as string } });
    expect(payment.status).toBe('PROCESSING');
    return { paymentId: payment.id, providerPaymentId: payment.providerPaymentId!, contractId, buyer, seller, priceSom };
  }

  interface StuckRefundFixture {
    refundId: string;
    providerRefundId: string;
    contractId: string;
    buyer: UserSession;
    staffToken: string;
    priceSom: number;
  }

  /** Funded ACTIVE contract → to'liq refund so'raladi — webhook YUBORILMAYDI. */
  async function createStuckRefund(priceSom = 900_000): Promise<StuckRefundFixture> {
    const fixture = await createStuckPayment(priceSom);
    paymentProvider.queueQueryScenario(fixture.providerPaymentId, 'SUCCEEDED');
    const applied = await reconciliation.reconcilePayment(
      await db!.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } }),
      'STAFF',
    );
    expect(applied.outcome).toBe('RECONCILED');

    const staff = await fullStaff();
    webhookCounter += 1;
    const refundRes = await request(app!.getHttpServer())
      .post('/api/v1/staff/refunds')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .set('Idempotency-Key', `reconcile-refund-${webhookCounter}`)
      .send({ contractId: fixture.contractId, reason: 'Reconciliation e2e — to‘liq qaytarish' })
      .expect(200);
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: refundRes.body.id as string } });
    expect(refund.status).toBe('PROCESSING');
    return {
      refundId: refund.id,
      providerRefundId: refund.providerRefundId!,
      contractId: fixture.contractId,
      buyer: fixture.buyer,
      staffToken: staff.accessToken,
      priceSom,
    };
  }

  interface StuckPayoutFixture {
    payoutId: string;
    providerPayoutId: string;
    seller: UserSession;
    availableSom: number;
    amountSom: number;
  }

  async function sellerBalance(token: string): Promise<number> {
    const res = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.available as number;
  }

  /** Settled contract → seller balansga ega → payout so'raladi — webhook YUBORILMAYDI. */
  async function createStuckPayout(priceSom = 900_000): Promise<StuckPayoutFixture> {
    const fixture = await createStuckPayment(priceSom);
    paymentProvider.queueQueryScenario(fixture.providerPaymentId, 'SUCCEEDED');
    await reconciliation.reconcilePayment(await db!.payment.findUniqueOrThrow({ where: { id: fixture.paymentId } }), 'STAFF');

    const milestone = await db!.milestone.findFirstOrThrow({ where: { contractId: fixture.contractId } });
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${fixture.contractId}/milestones/${milestone.id}/submit`)
      .set('Authorization', `Bearer ${fixture.seller.accessToken}`)
      .send({ message: 'Reconciliation submit deliverable' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${fixture.contractId}/milestones/${milestone.id}/approve`)
      .set('Authorization', `Bearer ${fixture.buyer.accessToken}`)
      .expect(200);

    const availableSom = await sellerBalance(fixture.seller.accessToken);
    webhookCounter += 1;
    const payoutRes = await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${fixture.seller.accessToken}`)
      .set('Idempotency-Key', `reconcile-payout-${webhookCounter}`)
      .send({ amount: availableSom, destinationReference: 'Uzcard •••• 1234' })
      .expect(200);
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: payoutRes.body.id as string } });
    expect(payout.status).toBe('PROCESSING');
    return { payoutId: payout.id, providerPayoutId: payout.providerPayoutId!, seller: fixture.seller, availableSom, amountSom: availableSom };
  }

  // ── Payment reconciliation ────────────────────────────────────────────

  t('PROCESSING Payment + provider SUCCEEDED → RECONCILED, escrow webhook bilan BIR XIL yo‘ldan funded', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'SUCCEEDED');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('RECONCILED');

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('SUCCEEDED');
    const funding = await db!.ledgerTransaction.count({ where: { type: 'PAYMENT_FUNDING', sourceId: fx.paymentId } });
    expect(funding).toBe(1);

    const run = await db!.reconciliationRun.findFirstOrThrow({ where: { operationType: 'PAYMENT', operationId: fx.paymentId } });
    expect(run.status).toBe('RECONCILED');
    expect(run.observedProviderStatus).toBe('SUCCEEDED');
  });

  t('PROCESSING Payment + provider FAILED → FAILED, PAYMENT_FUNDING yaratilmaydi', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'FAILED');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('RECONCILED');

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('FAILED');
    const funding = await db!.ledgerTransaction.count({ where: { type: 'PAYMENT_FUNDING', sourceId: fx.paymentId } });
    expect(funding).toBe(0);
  });

  t('PROCESSING Payment + provider PENDING → mutatsiya YO‘Q (NO_CHANGE)', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'PENDING');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('NO_CHANGE');

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('PROCESSING');
  });

  t('provider TIMEOUT (ambiguous) → mutatsiya YO‘Q, ERROR run, batch TO‘XTAMAYDI', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'TIMEOUT');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('ERROR');
    expect(result.abortBatch).toBe(false);

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('PROCESSING'); // LOCAL TIMEOUT != PROVIDER FAILURE
  });

  t('provider AUTH_ERROR (config) → mutatsiya YO‘Q, ERROR run, batch TO‘XTATILADI', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'AUTH_ERROR');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('ERROR');
    expect(result.abortBatch).toBe(true);

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('PROCESSING');
  });

  t('provider NOT_FOUND → WARNING anomaliya, mutatsiya YO‘Q (darhol FAILED emas)', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'NOT_FOUND');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('ANOMALY');

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('PROCESSING');
    const anomaly = await db!.financialAnomaly.findFirstOrThrow({ where: { entityType: 'PAYMENT', entityId: fx.paymentId } });
    expect(anomaly.code).toBe('PROVIDER_NOT_FOUND');
    expect(anomaly.severity).toBe('WARNING');
  });

  t('provider UNKNOWN (MALFORMED javob) → WARNING anomaliya, mutatsiya YO‘Q', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'MALFORMED');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    const result = await reconciliation.reconcilePayment(payment, 'AUTOMATIC');
    expect(result.outcome).toBe('ANOMALY');
    const anomaly = await db!.financialAnomaly.findFirstOrThrow({ where: { entityType: 'PAYMENT', entityId: fx.paymentId } });
    expect(anomaly.code).toBe('PROVIDER_STATUS_UNKNOWN');
  });

  t('Webhook va reconcile PARALLEL — aynan BITTA moliyaviy mutatsiya (race xavfsiz)', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'SUCCEEDED');
    const { raw, signature } = signedPaymentWebhook({
      eventId: `reconcile-race-evt-${fx.paymentId}`,
      providerPaymentId: fx.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: fx.priceSom * 100,
      currency: 'UZS',
    });
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });

    const [webhookRes, reconcileResult] = await Promise.all([
      postPaymentWebhook(raw, signature),
      reconciliation.reconcilePayment(payment, 'AUTOMATIC'),
    ]);
    expect(webhookRes.status).toBe(200);
    expect(['RECONCILED', 'NO_CHANGE']).toContain(reconcileResult.outcome);

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('SUCCEEDED');
    const funding = await db!.ledgerTransaction.count({ where: { type: 'PAYMENT_FUNDING', sourceId: fx.paymentId } });
    expect(funding).toBe(1); // aynan BITTA — ikkalasi ham SUCCEEDED CAS'ga urinadi, faqat bittasi g'olib
  });

  t('10 ta PARALLEL manual reconcile chaqiruvi — aynan BITTA yozuv RECONCILED, ledger BITTA marta yozildi', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'SUCCEEDED');
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });

    const results = await Promise.all(Array.from({ length: 10 }, () => reconciliation.reconcilePayment(payment, 'STAFF')));
    const reconciled = results.filter((r) => r.outcome === 'RECONCILED');
    const noChange = results.filter((r) => r.outcome === 'NO_CHANGE');
    expect(reconciled).toHaveLength(1);
    expect(noChange).toHaveLength(9);

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('SUCCEEDED');
    const funding = await db!.ledgerTransaction.count({ where: { type: 'PAYMENT_FUNDING', sourceId: fx.paymentId } });
    expect(funding).toBe(1);
  });

  t('Ziddiyatli holat: local FAILED, provider endi SUCCEEDED deydi → CRITICAL anomaliya, mutatsiya YO‘Q (terminal monotonlik)', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'FAILED');
    const payment1 = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    await reconciliation.reconcilePayment(payment1, 'AUTOMATIC');
    const failedPayment = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(failedPayment.status).toBe('FAILED');

    // Endi FAILED bo'lgan payment uchun `reconcilePayment` eligibility
    // tekshiruvi (PENDING/PROCESSING) ATAYLAB rad etadi — ziddiyat FAQAT
    // WEBHOOK/RECONCILE hali PENDING/PROCESSING'da bo'lganda, terminal CAS
    // ichida (`applyTerminalStatus`) yuzaga keladi. Buni to'g'ridan-to'g'ri
    // isbotlash uchun ICHKI holatni simulyatsiya qilamiz: yana PROCESSING'ga
    // qaytarib (faqat test uchun, DB'da to'g'ridan-to'g'ri), keyin ikkita
    // qarama-qarshi natijani PARALLEL qo'llaymiz.
    const fx2 = await createStuckPayment();
    const payment2 = await db!.payment.findUniqueOrThrow({ where: { id: fx2.paymentId } });
    paymentProvider.queueQueryScenario(fx2.providerPaymentId, 'FAILED');
    const first = await reconciliation.reconcilePayment(payment2, 'AUTOMATIC');
    expect(first.outcome).toBe('RECONCILED');

    // Endi local FAILED (terminal). Provider keyinroq (masalan noto'g'ri/
    // kech) SUCCEEDED deb aytsa — bu CONFLICT: `applyReconciledStatus` buni
    // avtomatik qabul qilmaydi, chunki eligibility tekshiruvi FAILED'ni
    // PENDING/PROCESSING emasligi sababli reconcile'dan chetlatadi.
    const stillFailed = await db!.payment.findUniqueOrThrow({ where: { id: fx2.paymentId } });
    paymentProvider.queueQueryScenario(fx2.providerPaymentId, 'SUCCEEDED');
    const second = await reconciliation.reconcilePayment(stillFailed, 'AUTOMATIC');
    expect(second.outcome).toBe('SKIPPED'); // terminal — qayta ko'rib chiqilmaydi, ANOMALY ham YARATILMAYDI
  });

  // ── Refund reconciliation ────────────────────────────────────────────

  t('PROCESSING Refund + provider SUCCEEDED → RECONCILED, REFUND journal yaratiladi', async () => {
    const fx = await createStuckRefund();
    paymentProvider.queueQueryScenario(fx.providerRefundId, 'SUCCEEDED');
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: fx.refundId } });
    const result = await reconciliation.reconcileRefund(refund, 'AUTOMATIC');
    expect(result.outcome).toBe('RECONCILED');

    const fresh = await db!.refund.findUniqueOrThrow({ where: { id: fx.refundId } });
    expect(fresh.status).toBe('SUCCEEDED');
    const journal = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: fx.refundId } });
    expect(journal).toBe(1);
  });

  t('PROCESSING Refund + provider FAILED → FAILED', async () => {
    const fx = await createStuckRefund();
    paymentProvider.queueQueryScenario(fx.providerRefundId, 'FAILED');
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: fx.refundId } });
    const result = await reconciliation.reconcileRefund(refund, 'AUTOMATIC');
    expect(result.outcome).toBe('RECONCILED');
    const fresh = await db!.refund.findUniqueOrThrow({ where: { id: fx.refundId } });
    expect(fresh.status).toBe('FAILED');
  });

  // ── Payout reconciliation ────────────────────────────────────────────

  t('PROCESSING Payout + provider SUCCEEDED → RECONCILED', async () => {
    const fx = await createStuckPayout();
    payoutProvider.queueQueryScenario(fx.providerPayoutId, 'SUCCEEDED');
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    const result = await reconciliation.reconcilePayout(payout, 'AUTOMATIC');
    expect(result.outcome).toBe('RECONCILED');
    const fresh = await db!.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    expect(fresh.status).toBe('SUCCEEDED');
  });

  t('PROCESSING Payout + provider FAILED → FAILED, PAYOUT_RELEASE orqali balans TIKLANADI', async () => {
    const fx = await createStuckPayout();
    payoutProvider.queueQueryScenario(fx.providerPayoutId, 'FAILED');
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    const result = await reconciliation.reconcilePayout(payout, 'AUTOMATIC');
    expect(result.outcome).toBe('RECONCILED');

    const fresh = await db!.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    expect(fresh.status).toBe('FAILED');
    const release = await db!.ledgerTransaction.count({ where: { type: 'PAYOUT_RELEASE', sourceId: fx.payoutId } });
    expect(release).toBe(1);
    const balance = await sellerBalance(fx.seller.accessToken);
    expect(balance).toBe(fx.availableSom); // rezervatsiya bekor qilindi — balans asl holatiga qaytdi
  });

  t('PROCESSING Payout + provider PENDING (uzoq PROCESSING) → avtomatik release YO‘Q, faqat NO_CHANGE', async () => {
    const fx = await createStuckPayout();
    payoutProvider.queueQueryScenario(fx.providerPayoutId, 'PENDING');
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    const result = await reconciliation.reconcilePayout(payout, 'AUTOMATIC');
    expect(result.outcome).toBe('NO_CHANGE');
    const fresh = await db!.payout.findUniqueOrThrow({ where: { id: fx.payoutId } });
    expect(fresh.status).toBe('PROCESSING');
    const release = await db!.ledgerTransaction.count({ where: { type: 'PAYOUT_RELEASE', sourceId: fx.payoutId } });
    expect(release).toBe(0);
  });

  // ── Stuck-scan / batch ─────────────────────────────────────────────────

  t('findStuckPayments — chegaradan (`PAYMENT_RECONCILE_AFTER_SECONDS`) yangi PROCESSING payment’ni QAYTARMAYDI', async () => {
    const fx = await createStuckPayment();
    const stuck = await reconciliation.findStuckPayments(500);
    expect(stuck.some((p) => p.id === fx.paymentId)).toBe(false); // hali "eski" emas
  });

  t('findStuckPayments — updatedAt chegaradan OLDIN bo‘lsa QAYTARADI', async () => {
    const fx = await createStuckPayment();
    await db!.payment.update({ where: { id: fx.paymentId }, data: { updatedAt: new Date(Date.now() - 400_000) } });
    const stuck = await reconciliation.findStuckPayments(500);
    expect(stuck.some((p) => p.id === fx.paymentId)).toBe(true);
  });

  t('runBatch — AUTOMATIC trigger orqali stuck payment’ni topib RECONCILED qiladi', async () => {
    const fx = await createStuckPayment();
    await db!.payment.update({ where: { id: fx.paymentId }, data: { updatedAt: new Date(Date.now() - 400_000) } });
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'SUCCEEDED');

    const stats = await reconciliation.runBatch('AUTOMATIC');
    expect(stats.reconciled).toBeGreaterThanOrEqual(1);

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('SUCCEEDED');
  });

  // ── Staff HTTP endpoints ────────────────────────────────────────────────

  t('PAYMENTS huquqisiz staff — manual reconcile 403', async () => {
    const fx = await createStuckPayment();
    const limited = await createStaffSession(app!, db!, ['KYC']);
    const res = await request(app!.getHttpServer())
      .post(`/api/v1/staff/reconciliation/payments/${fx.paymentId}/reconcile`)
      .set('Authorization', `Bearer ${limited.accessToken}`);
    expect(res.status).toBe(403);
  });

  t('Staff manual reconcile (HTTP) — Payment SUCCEEDED bo‘ladi, ReconciliationRun qaytadi', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'SUCCEEDED');
    const staff = await fullStaff();
    const res = await request(app!.getHttpServer())
      .post(`/api/v1/staff/reconciliation/payments/${fx.paymentId}/reconcile`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);
    expect(res.body.status).toBe('RECONCILED');
    expect(res.body.observedProviderStatus).toBe('SUCCEEDED');

    const fresh = await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } });
    expect(fresh.status).toBe('SUCCEEDED');
  });

  t('GET /staff/reconciliation/anomalies — WARNING anomaliya ro‘yxatda ko‘rinadi va acknowledge qilinadi', async () => {
    const fx = await createStuckPayment();
    paymentProvider.queueQueryScenario(fx.providerPaymentId, 'NOT_FOUND');
    await reconciliation.reconcilePayment(await db!.payment.findUniqueOrThrow({ where: { id: fx.paymentId } }), 'AUTOMATIC');

    const staff = await fullStaff();
    const list = await request(app!.getHttpServer())
      .get('/api/v1/staff/reconciliation/anomalies')
      .query({ entityType: 'PAYMENT', resolved: 'false' })
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);
    const found = (list.body.items as { id: string; entityId: string }[]).find((a) => a.entityId === fx.paymentId);
    expect(found).toBeDefined();

    const ack = await request(app!.getHttpServer())
      .post(`/api/v1/staff/reconciliation/anomalies/${found!.id}/acknowledge`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ note: 'Tekshirildi — test ma’lumoti' })
      .expect(200);
    expect(ack.body.resolvedAt).toBeTruthy();
  });

  t('GET /staff/reconciliation/summary — stuck/anomaly sonlarini qaytaradi', async () => {
    const staff = await fullStaff();
    const res = await request(app!.getHttpServer())
      .get('/api/v1/staff/reconciliation/summary')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);
    expect(typeof res.body.stuckPayments).toBe('number');
    expect(typeof res.body.totalAnomalies).toBe('number');
    expect(res.body.unresolvedBySeverity).toHaveProperty('CRITICAL');
  });

  t('POST /staff/financial-integrity/scan — ishlaydi va anomaliyalarni qaytaradi', async () => {
    const staff = await fullStaff();
    const res = await request(app!.getHttpServer())
      .post('/api/v1/staff/financial-integrity/scan')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);
    expect(typeof res.body.critical).toBe('number');
    expect(typeof res.body.total).toBe('number');
  });

  t('AnomalyService.raise — bir xil (code, entityType, entityId) qayta chaqirilsa DUPLIKAT yaratmaydi', async () => {
    const fx = await createStuckPayment();
    await anomalies.raise({
      code: 'PROVIDER_NOT_FOUND',
      severity: 'WARNING',
      entityType: 'PAYMENT',
      entityId: fx.paymentId,
      description: 'birinchi',
    });
    await anomalies.raise({
      code: 'PROVIDER_NOT_FOUND',
      severity: 'WARNING',
      entityType: 'PAYMENT',
      entityId: fx.paymentId,
      description: 'ikkinchi (duplikat urinish)',
    });
    const count = await db!.financialAnomaly.count({
      where: { code: 'PROVIDER_NOT_FOUND', entityType: 'PAYMENT', entityId: fx.paymentId },
    });
    expect(count).toBe(1);
  });
});
