import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { PAYMENT_PROVIDER } from '@/modules/payment/providers/payment-provider.interface';
import { TestPaymentProvider, TEST_PROVIDER_SIGNATURE_HEADER } from '@/modules/payment/providers/test/test-payment.provider';
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
 * Bosqich 7 — Refund (buyer tomonga qaytarish). FAQAT pre-settlement
 * (Contract ACTIVE + Payment SUCCEEDED), FAQAT to'liq refund, FAQAT staff
 * boshlaydi. Webhook — `payments/webhooks/TEST` (Refund Payment bilan BIR
 * XIL provider'ni bo'lishadi, `kind` diskriminatori orqali).
 */
describe('Refund (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let provider!: TestPaymentProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('refund.e2e');
    if (!reachable) return;
    await provisionDb(DB);
    await flushRedis();
    sms = new CapturingSmsProvider();
    app = await buildTestApp((b) => b.overrideProvider(SMS_PROVIDER).useValue(sms));
    db = freshDb();
    provider = app.get<TestPaymentProvider>(PAYMENT_PROVIDER);
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

  interface ActiveContractFixture {
    contractId: string;
    buyer: UserSession;
    seller: UserSession;
    priceSom: number;
    staffToken: string;
    milestoneIds: string[];
  }

  async function createActiveContract(milestones?: { title: string; amount: number }[]): Promise<ActiveContractFixture> {
    const staff = await fullStaff();
    const priceSom = milestones ? milestones.reduce((s, m) => s + m.amount, 0) : 900_000;
    const { serviceId, seller } = await createActiveService(app!, sms, staff.accessToken, { priceSom });
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const created = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        serviceId,
        deadline: futureIsoDate(),
        milestones: milestones ?? [{ title: 'Yagona bosqich', amount: priceSom }],
      })
      .expect(200);
    const contractId = created.body.id as string;
    const milestoneIds = (created.body.milestones as { id: string }[]).map((m) => m.id);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    return { contractId, buyer, seller, priceSom, staffToken: staff.accessToken, milestoneIds };
  }

  let webhookCounter = 0;
  function signedWebhook(payloadObj: Record<string, unknown>) {
    const raw = JSON.stringify(payloadObj);
    return { raw, signature: provider.signPayload(Buffer.from(raw)) };
  }
  function postWebhook(raw: string, signature: string) {
    return request(app!.getHttpServer())
      .post('/api/v1/payments/webhooks/TEST')
      .set('Content-Type', 'application/json')
      .set(TEST_PROVIDER_SIGNATURE_HEADER, signature)
      .send(raw);
  }

  async function payAndConfirm(contractId: string, buyer: UserSession, priceSom: number) {
    webhookCounter += 1;
    const created = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', `refund-pay-${webhookCounter}`)
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = signedWebhook({
      eventId: `refund-pay-evt-${webhookCounter}`,
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100,
      currency: 'UZS',
    });
    await postWebhook(raw, signature).expect(200);
    return db!.payment.findUniqueOrThrow({ where: { id: payment.id } });
  }

  async function submitAndApprove(contractId: string, milestoneId: string, seller: UserSession, buyer: UserSession) {
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Refund test deliverable' })
      .expect(200);
    return request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
  }

  function requestRefund(contractId: string, staffToken: string, idemKey: string, reason = 'Xaridor talabi bo‘yicha to‘liq qaytarish') {
    return request(app!.getHttpServer())
      .post('/api/v1/staff/refunds')
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', idemKey)
      .send({ contractId, reason });
  }

  function refundWebhook(refundProviderId: string, amountSom: number, status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    webhookCounter += 1;
    return signedWebhook({
      kind: 'REFUND',
      eventId: `refund-evt-${webhookCounter}`,
      providerRefundId: refundProviderId,
      eventType: status === 'SUCCEEDED' ? 'refund.succeeded' : 'refund.failed',
      status,
      amount: amountSom * 100,
      currency: 'UZS',
    });
  }

  // ── Yaratish — validatsiya ────────────────────────────────────────────

  t('To‘lovsiz contract uchun refund — REFUND_NOT_ALLOWED', async () => {
    const { contractId, staffToken } = await createActiveContract();
    const res = await requestRefund(contractId, staffToken, 'refund-unpaid-1');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REFUND_NOT_ALLOWED');
  });

  t('Allaqachon yakunlangan (COMPLETED) contract uchun refund — REFUND_NOT_ALLOWED', async () => {
    const { contractId, buyer, seller, priceSom, staffToken, milestoneIds } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    await submitAndApprove(contractId, milestoneIds[0]!, seller, buyer);
    const res = await requestRefund(contractId, staffToken, 'refund-completed-1');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REFUND_NOT_ALLOWED');
  });

  t('PAYMENTS ruxsatisiz staff — 403', async () => {
    const { contractId, buyer, priceSom } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const noPermStaff = await createStaffSession(app!, db!, ['DASHBOARD']);
    const res = await requestRefund(contractId, noPermStaff.accessToken, 'refund-noperm-1');
    expect(res.status).toBe(403);
  });

  t('Duplicate refund so‘rovi (bir xil to‘lov uchun ikkinchi marta) — REFUND_ALREADY_REQUESTED', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    await requestRefund(contractId, staffToken, 'refund-dup-1').expect(200);
    const second = await requestRefund(contractId, staffToken, 'refund-dup-2');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('REFUND_ALREADY_REQUESTED');
  });

  t('Bir xil Idempotency-Key — bitta Refund qatori (idempotent replay)', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const first = await requestRefund(contractId, staffToken, 'refund-idem-1').expect(200);
    const second = await requestRefund(contractId, staffToken, 'refund-idem-1').expect(200);
    expect(second.body.id).toBe(first.body.id);
    const count = await db!.refund.count({ where: { contractId } });
    expect(count).toBe(1);
  });

  // ── Provider natijasi ─────────────────────────────────────────────────

  t('Provider REJECT (yaratishda) — Refund darhol FAILED, ledger journal yaratilmaydi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    const payment = await payAndConfirm(contractId, buyer, priceSom);
    // Bo'lim 45 — `refundPayment` scenario `paymentId` bo'yicha navbatga
    // qo'yiladi (`Payment.id` chaqiruvdan OLDIN ma'lum, `Refund.id`dan farqli).
    provider.queueScenario(payment.id, 'REJECT');

    const res = await requestRefund(contractId, staffToken, 'refund-reject-1');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYMENT_PROVIDER_ERROR');

    const refund = await db!.refund.findFirstOrThrow({ where: { contractId } });
    expect(refund.status).toBe('FAILED');
    const ledgerCount = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: refund.id } });
    expect(ledgerCount).toBe(0);
    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('ACTIVE');
  });

  t('Provider TIMEOUT (yaratishda) — Refund PENDING’da qoladi (ambiguous, ko‘r-ko‘rona FAILED qilinmaydi)', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    const payment = await payAndConfirm(contractId, buyer, priceSom);
    provider.queueScenario(payment.id, 'TIMEOUT');

    const res = await requestRefund(contractId, staffToken, 'refund-timeout-1');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');

    const refund = await db!.refund.findFirstOrThrow({ where: { contractId } });
    expect(refund.status).toBe('PENDING');
    const ledgerCount = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: refund.id } });
    expect(ledgerCount).toBe(0);
  });

  t('Webhook orqali refund FAILED — Refund.status FAILED, ledger journal yaratilmaydi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const created = await requestRefund(contractId, staffToken, 'refund-fail-1').expect(200);
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: created.body.id as string } });
    expect(refund.status).toBe('PROCESSING');

    const { raw, signature } = refundWebhook(refund.providerRefundId!, priceSom, 'FAILED');
    await postWebhook(raw, signature).expect(200);

    const failed = await db!.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(failed.status).toBe('FAILED');
    const ledgerCount = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: refund.id } });
    expect(ledgerCount).toBe(0);
    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('ACTIVE');
  });

  // ── Muvaffaqiyatli refund — ledger + Contract holati ───────────────────

  t('Muvaffaqiyatli refund — balanslangan REFUND journal (ESCROW -amount ; REFUND_CLEARING +amount), Contract → CANCELLED', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const created = await requestRefund(contractId, staffToken, 'refund-ok-1').expect(200);
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: created.body.id as string } });

    const { raw, signature } = refundWebhook(refund.providerRefundId!, priceSom, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);

    const succeeded = await db!.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(succeeded.status).toBe('SUCCEEDED');

    const tx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'REFUND', sourceId: refund.id } },
      include: { entries: { include: { account: true } } },
    });
    expect(tx.entries).toHaveLength(2);
    expect(tx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    const escrow = tx.entries.find((e) => e.account.type === 'ESCROW')!;
    const clearing = tx.entries.find((e) => e.account.type === 'REFUND_CLEARING')!;
    expect(escrow.amount).toBe(-(BigInt(priceSom) * 100n));
    expect(clearing.amount).toBe(BigInt(priceSom) * 100n);
    expect(escrow.account.ownerId).toBe(buyer.userId);
    expect(clearing.account.ownerType).toBe('PLATFORM');

    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('CANCELLED');
  });

  t('Takroriy webhook (bir xil eventId) — faqat BITTA REFUND journal', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const created = await requestRefund(contractId, staffToken, 'refund-dupwh-1').expect(200);
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = refundWebhook(refund.providerRefundId!, priceSom, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);
    await postWebhook(raw, signature).expect(200);

    const count = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: refund.id } });
    expect(count).toBe(1);
  });

  t('10 ta parallel bir xil webhook — faqat BITTA REFUND journal (race)', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const created = await requestRefund(contractId, staffToken, 'refund-parallel-1').expect(200);
    const refund = await db!.refund.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = refundWebhook(refund.providerRefundId!, priceSom, 'SUCCEEDED');
    const results = await Promise.all(Array.from({ length: 10 }, () => postWebhook(raw, signature)));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const count = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: refund.id } });
    expect(count).toBe(1);
    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('CANCELLED');
  });

  // ── Settlement bilan poyga (bo'lim 18/62 simmetriyasi) ─────────────────

  t('Refund PENDING bo‘lgan holda oxirgi milestone approve — CONTRACT_REFUND_IN_PROGRESS (settlement bloklanadi)', async () => {
    const { contractId, buyer, seller, priceSom, staffToken, milestoneIds } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    await requestRefund(contractId, staffToken, 'refund-race-1').expect(200);

    const res = await submitAndApprove(contractId, milestoneIds[0]!, seller, buyer);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTRACT_REFUND_IN_PROGRESS');

    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('ACTIVE');
    const settlementCount = await db!.ledgerTransaction.count({ where: { type: 'CONTRACT_SETTLEMENT', sourceId: contractId } });
    expect(settlementCount).toBe(0);
  });

  // ── O'qish API'lari ────────────────────────────────────────────────────

  t('Buyer — o‘z refundini ko‘radi, boshqasinikini ko‘ra olmaydi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const created = await requestRefund(contractId, staffToken, 'refund-read-1').expect(200);

    const own = await request(app!.getHttpServer())
      .get(`/api/v1/me/refunds/${created.body.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(own.body.id).toBe(created.body.id);
    expect(own.body.providerRefundId).toBeUndefined();

    const otherBuyer = await loginNewUser(app!, sms, 'BUYER');
    const forbidden = await request(app!.getHttpServer())
      .get(`/api/v1/me/refunds/${created.body.id}`)
      .set('Authorization', `Bearer ${otherBuyer.accessToken}`);
    expect(forbidden.status).toBe(404);
  });

  t('Staff — ro‘yxatni contractId bo‘yicha filtrlab ko‘radi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    await requestRefund(contractId, staffToken, 'refund-list-1').expect(200);

    const list = await request(app!.getHttpServer())
      .get('/api/v1/staff/refunds')
      .query({ contractId })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].requestedByStaffId).toBeDefined();
  });
});
