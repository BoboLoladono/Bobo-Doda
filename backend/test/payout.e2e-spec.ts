import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { PAYMENT_PROVIDER } from '@/modules/payment/providers/payment-provider.interface';
import { TestPaymentProvider, TEST_PROVIDER_SIGNATURE_HEADER } from '@/modules/payment/providers/test/test-payment.provider';
import { PAYOUT_PROVIDER } from '@/modules/payout/providers/payout-provider.interface';
import { TestPayoutProvider, TEST_PAYOUT_PROVIDER_SIGNATURE_HEADER } from '@/modules/payout/providers/test/test-payout.provider';
import {
  CapturingSmsProvider,
  createActiveService,
  createStaffSession,
  freshDb,
  futureIsoDate,
  loginNewUser,
  type UserSession,
} from './support/fixtures';

const DB = 'health_e2e';

/**
 * Bosqich 7 — Payout (seller pulini chiqarish). Ledger-derived balans,
 * reservation-before-external-call, over-payout himoyasi (bo'lim 62 —
 * "eng muhim payout test"). Payment/Refund'dan ALOHIDA provider/route.
 */
describe('Payout (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let paymentProvider!: TestPaymentProvider;
  let payoutProvider!: TestPayoutProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('payout.e2e');
    if (!reachable) return;
    await provisionDb(DB);
    await flushRedis();
    sms = new CapturingSmsProvider();
    app = await buildTestApp((b) => b.overrideProvider(SMS_PROVIDER).useValue(sms));
    db = freshDb();
    paymentProvider = app.get<TestPaymentProvider>(PAYMENT_PROVIDER);
    payoutProvider = app.get<TestPayoutProvider>(PAYOUT_PROVIDER);
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

  interface SettledSellerFixture {
    seller: UserSession;
    availableSom: number;
  }

  /** APPROVED seller + ACTIVE service → funded+settled contract → seller SELLER_PAYABLE balansi bor. */
  async function createSellerWithBalance(priceSom = 900_000): Promise<SettledSellerFixture> {
    const staff = await fullStaff();
    const { serviceId, seller } = await createActiveService(app!, sms, staff.accessToken, { priceSom });
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const created = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] })
      .expect(200);
    const contractId = created.body.id as string;
    const milestoneId = (created.body.milestones as { id: string }[])[0]!.id;
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    webhookCounter += 1;
    const pay = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', `payout-fixture-pay-${webhookCounter}`)
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: pay.body.id as string } });
    const { raw, signature } = signedPaymentWebhook({
      eventId: `payout-fixture-evt-${webhookCounter}`,
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100,
      currency: 'UZS',
    });
    await postPaymentWebhook(raw, signature).expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Payout test deliverable' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    const balanceRes = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    return { seller, availableSom: balanceRes.body.available as number };
  }

  function createPayout(token: string, idemKey: string, amount: number, destinationReference = 'Uzcard •••• 1234') {
    return request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idemKey)
      .send({ amount, destinationReference });
  }

  function payoutWebhook(providerPayoutId: string, amountSom: number, status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    webhookCounter += 1;
    const raw = JSON.stringify({
      eventId: `payout-evt-${webhookCounter}`,
      providerPayoutId,
      eventType: status === 'SUCCEEDED' ? 'payout.succeeded' : 'payout.failed',
      status,
      amount: amountSom * 100,
      currency: 'UZS',
    });
    return { raw, signature: payoutProvider.signPayload(Buffer.from(raw)) };
  }
  function postPayoutWebhook(raw: string, signature: string) {
    return request(app!.getHttpServer())
      .post('/api/v1/payouts/webhooks/TEST')
      .set('Content-Type', 'application/json')
      .set(TEST_PAYOUT_PROVIDER_SIGNATURE_HEADER, signature)
      .send(raw);
  }

  async function sellerBalance(token: string): Promise<number> {
    const res = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.available as number;
  }

  // ── Validatsiya / ruxsat ────────────────────────────────────────────────

  t('Balansdan ko‘p summa so‘ralsa — INSUFFICIENT_BALANCE', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const res = await createPayout(seller.accessToken, 'payout-insufficient-1', availableSom + 1);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
  });

  t('Aniq balans summasi bilan payout — muvaffaqiyatli, balans 0 ga tushadi', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const res = await createPayout(seller.accessToken, 'payout-exact-1', availableSom).expect(200);
    expect(res.body.status).toBe('PROCESSING');
    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(0);
  });

  t('Tasdiqlanmagan (APPROVED bo‘lmagan) seller — SELLER_NOT_APPROVED', async () => {
    const notApproved = await loginNewUser(app!, sms, 'SELLER');
    const res = await createPayout(notApproved.accessToken, 'payout-notapproved-1', 1000);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELLER_NOT_APPROVED');
  });

  t('Bloklangan (BLOCKED) seller — ACCOUNT_BLOCKED', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    await db!.user.update({ where: { id: seller.userId }, data: { status: 'BLOCKED' } });
    const res = await createPayout(seller.accessToken, 'payout-blocked-1', Math.min(1000, availableSom));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BLOCKED');
  });

  t('Boshqa seller payoutini ko‘ra olmaydi (egalik) — 404', async () => {
    const first = await createSellerWithBalance();
    const created = await createPayout(first.seller.accessToken, 'payout-owner-1', first.availableSom).expect(200);
    const second = await createSellerWithBalance();
    const res = await request(app!.getHttpServer())
      .get(`/api/v1/seller/payouts/${created.body.id}`)
      .set('Authorization', `Bearer ${second.seller.accessToken}`);
    expect(res.status).toBe(404);
  });

  // ── Reservation — DARHOL, over-payout himoyasi ────────────────────────

  t('Reservation DARHOL balansni kamaytiradi (webhook kutmasdan)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const half = Math.floor(availableSom / 2);
    await createPayout(seller.accessToken, 'payout-immediate-1', half).expect(200);
    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(availableSom - half);
  });

  t('2 ta PARALLEL payout, ikkalasi ham balansning >50%i — FAQAT BITTASI muvaffaqiyatli (over-payout himoyasi)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const amount = Math.floor(availableSom * 0.6);
    const [r1, r2] = await Promise.all([
      createPayout(seller.accessToken, 'payout-race2-a', amount),
      createPayout(seller.accessToken, 'payout-race2-b', amount),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 422]);
    const insufficient = [r1, r2].find((r) => r.status === 422)!;
    expect(insufficient.body.code).toBe('INSUFFICIENT_BALANCE');

    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(availableSom - amount);
    const payoutCount = await db!.payout.count({ where: { sellerId: seller.userId } });
    expect(payoutCount).toBe(1); // faqat MUVAFFAQIYATLI so'rov Payout qatori yaratadi
    const successfulPayout = await db!.payout.findFirstOrThrow({ where: { sellerId: seller.userId } });
    const reservationCount = await db!.ledgerTransaction.count({
      where: { type: 'PAYOUT_RESERVATION', sourceId: successfulPayout.id },
    });
    expect(reservationCount).toBe(1);
  });

  t('10 ta PARALLEL payout, har biri balansning 20%i (jami 200%) — FAQAT 5 tasi muvaffaqiyatli (bo‘lim 62 — eng muhim payout testi)', async () => {
    const { seller, availableSom } = await createSellerWithBalance(1_000_000);
    const slice = Math.floor(availableSom / 5); // 5 tasi to'lib, qolgan 5 tasi INSUFFICIENT bo'lishi kerak
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createPayout(seller.accessToken, `payout-race10-${i}`, slice)),
    );
    const succeeded = results.filter((r) => r.status === 200);
    const failed = results.filter((r) => r.status === 422);
    expect(succeeded).toHaveLength(5);
    expect(failed).toHaveLength(5);
    expect(failed.every((r) => r.body.code === 'INSUFFICIENT_BALANCE')).toBe(true);

    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(availableSom - slice * 5);
    const payoutCount = await db!.payout.count({ where: { sellerId: seller.userId } });
    expect(payoutCount).toBe(5);
  });

  // ── Provider natijasi (yaratishda) ─────────────────────────────────────

  t('Provider REJECT (yaratishda) — Payout darhol FAILED, rezervatsiya RELEASE qilinadi (balans tiklanadi)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    // Bo'lim 45 — `createPayout` scenario `sellerId` bo'yicha navbatga
    // qo'yiladi (`Payout.id` server ichida generatsiya bo'ladi, `sellerId`
    // esa chaqiruvdan OLDIN ma'lum — Refund'ning `paymentId` kaliti bilan
    // bir xil naqsh).
    payoutProvider.queueScenario(seller.userId, 'REJECT');

    const res = await createPayout(seller.accessToken, 'payout-reject-1', availableSom);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYOUT_PROVIDER_ERROR');

    const payout = await db!.payout.findFirstOrThrow({ where: { sellerId: seller.userId } });
    expect(payout.status).toBe('FAILED');

    const release = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'PAYOUT_RELEASE', sourceId: payout.id } },
    });
    expect(release).toBeDefined();
    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(availableSom);
  });

  t('Provider TIMEOUT (yaratishda) — Payout PENDING’da qoladi, mablag‘ rezerv holicha qoladi (ambiguous)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    payoutProvider.queueScenario(seller.userId, 'TIMEOUT');

    const res = await createPayout(seller.accessToken, 'payout-timeout-1', availableSom);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYOUT_PROVIDER_UNAVAILABLE');

    const payout = await db!.payout.findFirstOrThrow({ where: { sellerId: seller.userId } });
    expect(payout.status).toBe('PENDING');
    const releaseCount = await db!.ledgerTransaction.count({ where: { type: 'PAYOUT_RELEASE', sourceId: payout.id } });
    expect(releaseCount).toBe(0);
    // Ambiguous — mablag' HALI rezervda (ko'r-ko'rona release qilinmaydi, bo'lim 48).
    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(0);
  });

  // ── Webhook — muvaffaqiyat/muvaffaqiyatsizlik ──────────────────────────

  t('Webhook SUCCEEDED — Payout.status SUCCEEDED, QO‘SHIMCHA ledger yozuvi YO‘Q (faqat reservation qoladi)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const created = await createPayout(seller.accessToken, 'payout-succeed-1', availableSom).expect(200);
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = payoutWebhook(payout.providerPayoutId!, availableSom, 'SUCCEEDED');
    await postPayoutWebhook(raw, signature).expect(200);

    const succeeded = await db!.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(succeeded.status).toBe('SUCCEEDED');
    const ledgerCount = await db!.ledgerTransaction.count({ where: { sourceId: payout.id } });
    expect(ledgerCount).toBe(1); // faqat PAYOUT_RESERVATION, PAYOUT_COMPLETION YO'Q
    const reservation = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'PAYOUT_RESERVATION', sourceId: payout.id } },
    });
    expect(reservation).toBeDefined();
    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(0);
  });

  t('Webhook FAILED — Payout.status FAILED, PAYOUT_RELEASE journal (balans tiklanadi)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const created = await createPayout(seller.accessToken, 'payout-fail-1', availableSom).expect(200);
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = payoutWebhook(payout.providerPayoutId!, availableSom, 'FAILED');
    await postPayoutWebhook(raw, signature).expect(200);

    const failed = await db!.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(failed.status).toBe('FAILED');

    const release = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'PAYOUT_RELEASE', sourceId: payout.id } },
      include: { entries: { include: { account: true } } },
    });
    expect(release.entries).toHaveLength(2);
    expect(release.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    const payable = release.entries.find((e) => e.account.type === 'SELLER_PAYABLE')!;
    expect(payable.amount).toBe(BigInt(availableSom) * 100n);

    const balance = await sellerBalance(seller.accessToken);
    expect(balance).toBe(availableSom);
  });

  t('Takroriy webhook (bir xil eventId, SUCCEEDED) — faqat BITTA marta qayta ishlanadi', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const created = await createPayout(seller.accessToken, 'payout-dupwh-1', availableSom).expect(200);
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = payoutWebhook(payout.providerPayoutId!, availableSom, 'SUCCEEDED');
    await postPayoutWebhook(raw, signature).expect(200);
    await postPayoutWebhook(raw, signature).expect(200);

    const succeededAudits = await db!.auditLog.count({
      where: { resourceType: 'PAYOUT', resourceId: payout.id, action: 'PAYOUT_SUCCEEDED' },
    });
    expect(succeededAudits).toBe(1);
  });

  t('10 ta parallel bir xil SUCCEEDED webhook — faqat BITTA marta qayta ishlanadi (race)', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    const created = await createPayout(seller.accessToken, 'payout-parallelwh-1', availableSom).expect(200);
    const payout = await db!.payout.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = payoutWebhook(payout.providerPayoutId!, availableSom, 'SUCCEEDED');
    const results = await Promise.all(Array.from({ length: 10 }, () => postPayoutWebhook(raw, signature)));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const succeededAudits = await db!.auditLog.count({
      where: { resourceType: 'PAYOUT', resourceId: payout.id, action: 'PAYOUT_SUCCEEDED' },
    });
    expect(succeededAudits).toBe(1);
    const final = await db!.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(final.status).toBe('SUCCEEDED');
  });

  // ── Staff o'qish ────────────────────────────────────────────────────────

  t('PAYMENTS ruxsatisiz staff — /staff/payouts 403', async () => {
    const noPermStaff = await createStaffSession(app!, db!, ['DASHBOARD']);
    const res = await request(app!.getHttpServer())
      .get('/api/v1/staff/payouts')
      .set('Authorization', `Bearer ${noPermStaff.accessToken}`);
    expect(res.status).toBe(403);
  });

  t('Staff — sellerId bo‘yicha filtrlab ro‘yxatni ko‘radi', async () => {
    const { seller, availableSom } = await createSellerWithBalance();
    await createPayout(seller.accessToken, 'payout-stafflist-1', availableSom).expect(200);
    const staff = await fullStaff();

    const list = await request(app!.getHttpServer())
      .get('/api/v1/staff/payouts')
      .query({ sellerId: seller.userId })
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].sellerId).toBe(seller.userId);
  });
});
