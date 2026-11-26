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
 * Bosqich 8 — Dispute + post-settlement refund + split settlement. Ikki
 * rejim: pre-settlement (Contract ACTIVE, ESCROW o'zi hold) va
 * post-settlement (Contract COMPLETED, `DISPUTE_HOLD` orqali rezerv).
 */
describe('Dispute (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let provider!: TestPaymentProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('dispute.e2e');
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
    return createStaffSession(app!, db!, ['KYC', 'CATEGORIES', 'SERVICES', 'ORDERS', 'USERS', 'PAYMENTS', 'DISPUTES']);
  }

  interface ActiveContractFixture {
    contractId: string;
    buyer: UserSession;
    seller: UserSession;
    priceSom: number;
    staffToken: string;
    milestoneId: string;
  }

  async function createActiveContract(priceSom = 900_000): Promise<ActiveContractFixture> {
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
    return { contractId, buyer, seller, priceSom, staffToken: staff.accessToken, milestoneId };
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
      .set('Idempotency-Key', `dispute-pay-${webhookCounter}`)
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = signedWebhook({
      eventId: `dispute-pay-evt-${webhookCounter}`,
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100,
      currency: 'UZS',
    });
    await postWebhook(raw, signature).expect(200);
  }

  async function settleFully(contractId: string, milestoneId: string, seller: UserSession, buyer: UserSession) {
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Dispute test deliverable' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
  }

  /** To'liq oqim: funded + settled (COMPLETED) contract — post-settlement dispute uchun. */
  async function createSettledContract(priceSom = 900_000): Promise<ActiveContractFixture> {
    const fixture = await createActiveContract(priceSom);
    await payAndConfirm(fixture.contractId, fixture.buyer, priceSom);
    await settleFully(fixture.contractId, fixture.milestoneId, fixture.seller, fixture.buyer);
    return fixture;
  }

  function openDispute(token: string, contractId: string, idemKey: string, reason = 'QUALITY', description = 'Ish sifati talabga javob bermaydi') {
    return request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/disputes`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idemKey)
      .send({ reason, description });
  }
  function startReview(staffToken: string, disputeId: string) {
    return request(app!.getHttpServer())
      .post(`/api/v1/staff/disputes/${disputeId}/start-review`)
      .set('Authorization', `Bearer ${staffToken}`);
  }
  function resolveDispute(
    staffToken: string,
    disputeId: string,
    idemKey: string,
    buyerAwardAmount: number,
    sellerAwardAmount: number,
    resolutionReason = 'Dalillar ko‘rib chiqildi, qaror qabul qilindi',
  ) {
    return request(app!.getHttpServer())
      .post(`/api/v1/staff/disputes/${disputeId}/resolve`)
      .set('Authorization', `Bearer ${staffToken}`)
      .set('Idempotency-Key', idemKey)
      .send({ buyerAwardAmount, sellerAwardAmount, resolutionReason });
  }
  function rejectDispute(staffToken: string, disputeId: string, resolutionReason = 'Dalillar yetarli emas') {
    return request(app!.getHttpServer())
      .post(`/api/v1/staff/disputes/${disputeId}/reject`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ resolutionReason });
  }
  function cancelDispute(token: string, disputeId: string) {
    return request(app!.getHttpServer())
      .post(`/api/v1/me/disputes/${disputeId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
  }
  function addEvidence(token: string, disputeId: string, body: Record<string, unknown>) {
    return request(app!.getHttpServer())
      .post(`/api/v1/me/disputes/${disputeId}/evidence`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function refundWebhookFor(providerRefundId: string, amountSom: number, status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    webhookCounter += 1;
    return signedWebhook({
      kind: 'REFUND',
      eventId: `dispute-refund-evt-${webhookCounter}`,
      providerRefundId,
      eventType: status === 'SUCCEEDED' ? 'refund.succeeded' : 'refund.failed',
      status,
      amount: amountSom * 100,
      currency: 'UZS',
    });
  }

  // ── Ochish — ishtirokchi / egalik ──────────────────────────────────────

  t('Buyer dispute ochadi (pre-settlement)', async () => {
    const { contractId, buyer, priceSom } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const res = await openDispute(buyer.accessToken, contractId, 'dispute-open-1').expect(200);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.preSettlement).toBe(true);
    expect(res.body.heldAmount).toBe(priceSom);
  });

  t('Seller dispute ochadi (pre-settlement)', async () => {
    const { contractId, buyer, seller, priceSom } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const res = await openDispute(seller.accessToken, contractId, 'dispute-open-2').expect(200);
    expect(res.body.status).toBe('OPEN');
  });

  t('Outsider (ishtirokchi bo‘lmagan) — 404 (existence leak yo‘q)', async () => {
    const { contractId, buyer, priceSom } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const outsider = await loginNewUser(app!, sms, 'BUYER');
    const res = await openDispute(outsider.accessToken, contractId, 'dispute-outsider-1');
    expect(res.status).toBe(404);
  });

  t('To‘lovsiz (PENDING_SELLER emas, lekin unfunded ACTIVE) contract uchun ham dispute ochiladi — pre-settlement, agrredAmount hold', async () => {
    // ACTIVE contract to'lovsiz ham bo'lishi mumkin (accept qilingan, lekin
    // hali to'lanmagan) — bu HOLDA HAM dispute ochish mumkin (Contract.status
    // ACTIVE), chunki bo'lim 6 policy Contract.status'ga qaraydi, Payment'ga emas.
    const { contractId, buyer, priceSom } = await createActiveContract();
    const res = await openDispute(buyer.accessToken, contractId, 'dispute-unfunded-1').expect(200);
    expect(res.body.preSettlement).toBe(true);
    expect(res.body.heldAmount).toBe(priceSom);
  });

  t('Ikkinchi ochiq dispute (parallel) — DISPUTE_ALREADY_OPEN', async () => {
    const { contractId, buyer, seller, priceSom } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const [r1, r2] = await Promise.all([
      openDispute(buyer.accessToken, contractId, 'dispute-double-a'),
      openDispute(seller.accessToken, contractId, 'dispute-double-b'),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = [r1, r2].find((r) => r.status === 409)!;
    expect(conflict.body.code).toBe('DISPUTE_ALREADY_OPEN');
    const count = await db!.dispute.count({ where: { contractId } });
    expect(count).toBe(1);
  });

  // ── Evidence / staff ruxsat ─────────────────────────────────────────────

  t('Evidence qo‘shish — buyer/seller/staff', async () => {
    const { contractId, buyer, seller, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-evidence-1').expect(200);
    const disputeId = opened.body.id as string;

    await addEvidence(buyer.accessToken, disputeId, { type: 'TEXT', text: 'Ekran surati yubordim, sifat past' }).expect(200);
    await addEvidence(seller.accessToken, disputeId, { type: 'FILE', fileReference: 's3://bucket/proof.png' }).expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/disputes/${disputeId}/evidence`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'TEXT', text: 'Staff izohi' })
      .expect(200);

    const list = await request(app!.getHttpServer())
      .get(`/api/v1/me/disputes/${disputeId}/evidence`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(3);

    const events = await request(app!.getHttpServer())
      .get(`/api/v1/me/disputes/${disputeId}/events`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(events.body.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['OPENED', 'EVIDENCE_ADDED']),
    );
  });

  t('DISPUTES ruxsatisiz staff — /staff/disputes 403', async () => {
    const noPermStaff = await createStaffSession(app!, db!, ['DASHBOARD']);
    const res = await request(app!.getHttpServer())
      .get('/api/v1/staff/disputes')
      .set('Authorization', `Bearer ${noPermStaff.accessToken}`);
    expect(res.status).toBe(403);
  });

  // ── Workflow: review / reject / cancel ─────────────────────────────────

  t('Staff start-review — OPEN → UNDER_REVIEW', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-review-1').expect(200);
    const res = await startReview(staffToken, opened.body.id as string).expect(200);
    expect(res.body.status).toBe('UNDER_REVIEW');
  });

  t('Staff reject — hech qanday moliyaviy harakat yo‘q', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-reject-1').expect(200);
    const res = await rejectDispute(staffToken, opened.body.id as string).expect(200);
    expect(res.body.status).toBe('REJECTED');
    const ledgerCount = await db!.ledgerTransaction.count({ where: { sourceId: opened.body.id as string } });
    expect(ledgerCount).toBe(0);
  });

  t('Post-settlement dispute REJECTED — hold TO‘LIQ SELLER_PAYABLE’ga qaytadi', async () => {
    const { contractId, buyer, seller, staffToken } = await createSettledContract();
    const balanceBefore = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;

    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-reject-post-1').expect(200);
    expect(opened.body.preSettlement).toBe(false);
    const balanceDuring = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;
    expect(balanceDuring).toBe(0); // to'liq hold qilindi

    await rejectDispute(staffToken, opened.body.id as string).expect(200);
    const balanceAfter = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;
    expect(balanceAfter).toBe(balanceBefore);

    const release = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'DISPUTE_HOLD_RELEASE', sourceId: opened.body.id as string } },
      include: { entries: true },
    });
    expect(release.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
  });

  t('User cancel — faqat OPEN, faqat ochgan tomon', async () => {
    const { contractId, buyer, seller, priceSom } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-cancel-1').expect(200);

    const forbiddenCancel = await cancelDispute(seller.accessToken, opened.body.id as string);
    expect(forbiddenCancel.status).toBe(404);

    const res = await cancelDispute(buyer.accessToken, opened.body.id as string).expect(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  // ── Resolution — pre-settlement ─────────────────────────────────────────

  t('Pre-settlement BUYER_FULL_REFUND — ESCROW to‘liq bo‘shaydi, Contract CANCELLED, provider refund SUCCEEDED', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-buyerfull-1').expect(200);
    const disputeId = opened.body.id as string;

    const resolved = await resolveDispute(staffToken, disputeId, 'dispute-buyerfull-resolve-1', priceSom, 0).expect(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolutionType).toBe('BUYER_FULL_REFUND');

    const refund = await db!.refund.findFirstOrThrow({ where: { disputeId } });
    expect(refund.amount).toBe(BigInt(priceSom) * 100n);
    const { raw, signature } = refundWebhookFor(refund.providerRefundId!, priceSom, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);

    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('CANCELLED');
    const refundTx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'REFUND', sourceId: refund.id } },
      include: { entries: { include: { account: true } } },
    });
    expect(refundTx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    expect(refundTx.entries.find((e) => e.account.type === 'ESCROW')).toBeDefined();
  });

  t('Pre-settlement SPLIT — Contract COMPLETED darhol, buyer refund DEFERRED', async () => {
    const { contractId, buyer, seller, priceSom, staffToken } = await createActiveContract(1_000_000);
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-split-pre-1').expect(200);
    const disputeId = opened.body.id as string;

    const buyerAward = 400_000;
    const sellerAward = 600_000;
    const resolved = await resolveDispute(staffToken, disputeId, 'dispute-split-pre-resolve-1', buyerAward, sellerAward).expect(200);
    expect(resolved.body.resolutionType).toBe('SPLIT');

    // Contract DARHOL COMPLETED (seller award > 0 — webhook kutmaydi).
    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('COMPLETED');

    const resolutionTx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'DISPUTE_RESOLUTION', sourceId: disputeId } },
      include: { entries: { include: { account: true } } },
    });
    expect(resolutionTx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    const escrowEntry = resolutionTx.entries.find((e) => e.account.type === 'ESCROW')!;
    expect(escrowEntry.amount).toBe(-(BigInt(sellerAward) * 100n));
    const sellerEntry = resolutionTx.entries.find((e) => e.account.type === 'SELLER_PAYABLE')!;
    const feeEntry = resolutionTx.entries.find((e) => e.account.type === 'PLATFORM_REVENUE');
    expect(sellerEntry.amount + (feeEntry?.amount ?? 0n)).toBe(BigInt(sellerAward) * 100n);

    const refund = await db!.refund.findFirstOrThrow({ where: { disputeId } });
    expect(refund.amount).toBe(BigInt(buyerAward) * 100n);
    const { raw, signature } = refundWebhookFor(refund.providerRefundId!, buyerAward, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);

    const balance = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(balance.body.available).toBe(sellerEntry.amount ? Number(sellerEntry.amount / 100n) : 0);
  });

  t('Zero-fee split (fee snapshot 0) — 2 ta yozuv (PLATFORM_REVENUE yo‘q), balanslangan', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract(500_000);
    await db!.contract.update({ where: { id: contractId }, data: { platformFeeRateBpsSnapshot: 0 } });
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-zerofee-1').expect(200);
    const disputeId = opened.body.id as string;

    await resolveDispute(staffToken, disputeId, 'dispute-zerofee-resolve-1', 200_000, 300_000).expect(200);
    const resolutionTx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'DISPUTE_RESOLUTION', sourceId: disputeId } },
      include: { entries: true },
    });
    expect(resolutionTx.entries).toHaveLength(2);
    expect(resolutionTx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
  });

  t('Noto‘g‘ri summa (heldAmount’ga teng emas) — INVALID_AMOUNT', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-badamount-1').expect(200);
    const res = await resolveDispute(staffToken, opened.body.id as string, 'dispute-badamount-resolve-1', priceSom, 1);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_AMOUNT');
  });

  // ── Resolution — post-settlement ─────────────────────────────────────────

  t('Post-settlement BUYER_FULL_REFUND — DISPUTE_HOLD’dan REFUND_CLEARING’ga, seller balans o‘zgarmaydi (allaqachon 0)', async () => {
    const { contractId, buyer, staffToken } = await createSettledContract();
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-post-buyerfull-1').expect(200);
    expect(opened.body.preSettlement).toBe(false);
    const disputeId = opened.body.id as string;

    const resolved = await resolveDispute(staffToken, disputeId, 'dispute-post-buyerfull-resolve-1', opened.body.heldAmount, 0).expect(200);
    expect(resolved.body.resolutionType).toBe('BUYER_FULL_REFUND');

    const refund = await db!.refund.findFirstOrThrow({ where: { disputeId } });
    const { raw, signature } = refundWebhookFor(refund.providerRefundId!, opened.body.heldAmount, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);

    const refundTx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'REFUND', sourceId: refund.id } },
      include: { entries: { include: { account: true } } },
    });
    expect(refundTx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    expect(refundTx.entries.find((e) => e.account.type === 'DISPUTE_HOLD')).toBeDefined();
    expect(refundTx.entries.find((e) => e.account.type === 'ESCROW')).toBeUndefined();

    // Contract COMPLETED bo'lib qoladi (post-settlement — status o'zgarmaydi).
    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('COMPLETED');
  });

  t('Post-settlement SELLER_FULL_RELEASE — hold to‘liq SELLER_PAYABLE’ga qaytadi, komissiya YO‘Q (ikkinchi marta olinmaydi)', async () => {
    const { contractId, buyer, seller, staffToken } = await createSettledContract();
    const balanceBeforeDispute = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;

    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-post-sellerfull-1').expect(200);
    const disputeId = opened.body.id as string;
    await resolveDispute(staffToken, disputeId, 'dispute-post-sellerfull-resolve-1', 0, opened.body.heldAmount).expect(200);

    const balanceAfter = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;
    expect(balanceAfter).toBe(balanceBeforeDispute);
  });

  t('Post-settlement SPLIT — DISPUTE_HOLD manbali resolution journal, seller balans to‘g‘ri', async () => {
    const { contractId, buyer, seller, staffToken } = await createSettledContract(1_000_000);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-post-split-1').expect(200);
    const disputeId = opened.body.id as string;
    const heldAmount = opened.body.heldAmount as number;
    const sellerAward = Math.floor(heldAmount * 0.6);
    const buyerAward = heldAmount - sellerAward;

    await resolveDispute(staffToken, disputeId, 'dispute-post-split-resolve-1', buyerAward, sellerAward).expect(200);
    const resolutionTx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'DISPUTE_RESOLUTION', sourceId: disputeId } },
      include: { entries: { include: { account: true } } },
    });
    expect(resolutionTx.entries).toHaveLength(2); // DISPUTE_HOLD manbasida komissiya YO'Q (bo'lim: ikki marta fee olinmaydi)
    expect(resolutionTx.entries.find((e) => e.account.type === 'DISPUTE_HOLD')).toBeDefined();
    expect(resolutionTx.entries.find((e) => e.account.type === 'PLATFORM_REVENUE')).toBeUndefined();
    expect(resolutionTx.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);
    const sellerEntry = resolutionTx.entries.find((e) => e.account.type === 'SELLER_PAYABLE')!;
    expect(sellerEntry.amount).toBe(BigInt(sellerAward) * 100n); // to'liq, komissiyasiz

    const refund = await db!.refund.findFirstOrThrow({ where: { disputeId } });
    const { raw, signature } = refundWebhookFor(refund.providerRefundId!, buyerAward, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);

    const balance = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(balance.body.available).toBe(sellerAward);
  });

  // ── Payout allaqachon SUCCEEDED / race bilan interaction ───────────────

  t('Payout allaqachon SUCCEEDED (funds tashqariga chiqqan) — dispute BARIBIR ochiladi, heldAmount=0, negative balans YO‘Q', async () => {
    const { contractId, buyer, seller, staffToken } = await createSettledContract();
    const balance = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;
    await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('Idempotency-Key', 'dispute-payout-already-1')
      .send({ amount: balance, destinationReference: 'Uzcard •••• 1234' })
      .expect(200);

    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-payout-already-open-1').expect(200);
    expect(opened.body.heldAmount).toBe(0);

    const sellerPayableBalance = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;
    expect(sellerPayableBalance).toBeGreaterThanOrEqual(0);

    // Resolve — heldAmount=0 bo'lgani uchun ikkala award ham 0 bo'lishi SHART.
    await resolveDispute(staffToken, opened.body.id as string, 'dispute-payout-already-resolve-1', 0, 0).expect(200);
  });

  t('Dispute-open vs Payout — parallel, faqat BITTASI seller balansidan foydalanadi (advisory lock domeni umumiy)', async () => {
    const { contractId, buyer, seller } = await createSettledContract();
    const balance = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;

    const [disputeRes, payoutRes] = await Promise.all([
      openDispute(buyer.accessToken, contractId, 'dispute-vs-payout-1'),
      request(app!.getHttpServer())
        .post('/api/v1/seller/payouts')
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('Idempotency-Key', 'dispute-vs-payout-payout-1')
        .send({ amount: balance, destinationReference: 'Uzcard •••• 1234' }),
    ]);

    expect(disputeRes.status).toBe(200);
    // Ikkalasi ham "muvaffaqiyatli" bo'lishi mumkin (dispute HAR DOIM ochiladi),
    // lekin moliyaviy natija SERIALIZATSIYA qilingan bo'lishi SHART: yoki
    // to'liq hold + payout INSUFFICIENT, yoki to'liq payout + hold=0.
    const finalBalance = (
      await request(app!.getHttpServer()).get('/api/v1/seller/balance').set('Authorization', `Bearer ${seller.accessToken}`).expect(200)
    ).body.available as number;
    if (payoutRes.status === 200) {
      expect(disputeRes.body.heldAmount).toBe(0);
      expect(finalBalance).toBe(0);
    } else {
      expect(payoutRes.body.code).toBe('INSUFFICIENT_BALANCE');
      expect(disputeRes.body.heldAmount).toBe(balance);
      expect(finalBalance).toBe(0);
    }
  });

  // ── Concurrency: parallel resolve ───────────────────────────────────────

  t('Parallel resolve (buyer-full vs seller-full) — FAQAT BITTASI yutadi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-parallelresolve-1').expect(200);
    const disputeId = opened.body.id as string;

    const [r1, r2] = await Promise.all([
      resolveDispute(staffToken, disputeId, 'dispute-parallelresolve-a', priceSom, 0),
      resolveDispute(staffToken, disputeId, 'dispute-parallelresolve-b', 0, priceSom),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const resolutionCount = await db!.dispute.count({ where: { id: disputeId, status: 'RESOLVED' } });
    expect(resolutionCount).toBe(1);
  });

  t('10 ta parallel resolve so‘rovi (bir xil dispute) — faqat BITTASI yutadi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-parallel10-1').expect(200);
    const disputeId = opened.body.id as string;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => resolveDispute(staffToken, disputeId, `dispute-parallel10-${i}`, priceSom, 0)),
    );
    const succeeded = results.filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(1);

    const dispute = await db!.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    expect(dispute.status).toBe('RESOLVED');
    const refundCount = await db!.refund.count({ where: { disputeId } });
    expect(refundCount).toBe(1);
  });

  // ── Reconciliation-oriented: source exactly-once ────────────────────────

  t('Duplicate REFUND webhook (dispute-driven) — faqat BITTA marta qayta ishlanadi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const opened = await openDispute(buyer.accessToken, contractId, 'dispute-dupwebhook-1').expect(200);
    const disputeId = opened.body.id as string;
    await resolveDispute(staffToken, disputeId, 'dispute-dupwebhook-resolve-1', priceSom, 0).expect(200);

    const refund = await db!.refund.findFirstOrThrow({ where: { disputeId } });
    const { raw, signature } = refundWebhookFor(refund.providerRefundId!, priceSom, 'SUCCEEDED');
    await postWebhook(raw, signature).expect(200);
    await postWebhook(raw, signature).expect(200);

    const count = await db!.ledgerTransaction.count({ where: { type: 'REFUND', sourceId: refund.id } });
    expect(count).toBe(1);
  });

  // ── Staff ro'yxat/filtr ──────────────────────────────────────────────────

  t('Staff — contractId bo‘yicha filtrlab ro‘yxatni ko‘radi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    await openDispute(buyer.accessToken, contractId, 'dispute-stafflist-1').expect(200);

    const list = await request(app!.getHttpServer())
      .get('/api/v1/staff/disputes')
      .query({ contractId })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].openedByUserId).toBe(buyer.userId);
  });
});
