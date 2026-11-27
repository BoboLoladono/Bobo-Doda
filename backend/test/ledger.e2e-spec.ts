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
 * Bosqich 6 — Double-entry Ledger: Payment funding, Contract settlement,
 * seller balance, staff read, unfunded gating, concurrency. Ledger'ning
 * DB-darajasidagi himoyalari (append-only, balans/valyuta trigger)
 * `db-roles.e2e-spec.ts`da alohida tasdiqlangan — bu fayl DOMAIN oqimini
 * (HTTP API orqali) sinaydi.
 */
describe('Ledger (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let provider!: TestPaymentProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('ledger.e2e');
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

  /** ACTIVE xizmat → buyer contract yaratadi (bitta yoki ko'p milestone) → seller accept qiladi. */
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

  /** To'liq oqim: to'lov yaratish + webhook orqali SUCCEEDED qilish. Payment qatorini qaytaradi. */
  async function payAndConfirm(contractId: string, buyer: UserSession, priceSom: number) {
    webhookCounter += 1;
    const created = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', `ledger-pay-${webhookCounter}`)
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = signedWebhook({
      eventId: `ledger-evt-${webhookCounter}`,
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
      .send({ message: 'Ledger test deliverable' })
      .expect(200);
    return request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
  }

  // ── Payment funding ───────────────────────────────────────────────────

  t('To‘lov SUCCEEDED bo‘lganda — balanslangan PAYMENT_FUNDING journal (PAYMENT_CLEARING -amount ; ESCROW +amount)', async () => {
    const { contractId, buyer, priceSom } = await createActiveContract();
    const payment = await payAndConfirm(contractId, buyer, priceSom);

    const tx = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'PAYMENT_FUNDING', sourceId: payment.id } },
      include: { entries: { include: { account: true } } },
    });
    expect(tx.currency).toBe('UZS');
    expect(tx.entries).toHaveLength(2);
    const sum = tx.entries.reduce((s, e) => s + e.amount, 0n);
    expect(sum).toBe(0n);

    const clearing = tx.entries.find((e) => e.account.type === 'PAYMENT_CLEARING')!;
    const escrow = tx.entries.find((e) => e.account.type === 'ESCROW')!;
    expect(clearing.amount).toBe(-BigInt(priceSom) * 100n);
    expect(escrow.amount).toBe(BigInt(priceSom) * 100n);
    expect(escrow.account.ownerType).toBe('USER');
    expect(escrow.account.ownerId).toBe(buyer.userId);
  });

  t('Failed to‘lov (provider REJECT) — ledger journal umuman yaratilmaydi', async () => {
    const { contractId, buyer } = await createActiveContract();
    provider.queueScenario(contractId, 'REJECT');
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', 'ledger-failed-1')
      .expect(422);

    const payment = await db!.payment.findFirstOrThrow({ where: { contractId } });
    expect(payment.status).toBe('FAILED');
    const count = await db!.ledgerTransaction.count({ where: { sourceId: payment.id } });
    expect(count).toBe(0);
  });

  t('Takroriy webhook (bir xil eventId) — faqat BITTA PAYMENT_FUNDING journal', async () => {
    const { contractId, buyer, priceSom } = await createActiveContract();
    const created = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', 'ledger-dup-1')
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = signedWebhook({
      eventId: 'ledger-dup-evt-1',
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100,
      currency: 'UZS',
    });
    await postWebhook(raw, signature).expect(200);
    await postWebhook(raw, signature).expect(200);

    const count = await db!.ledgerTransaction.count({
      where: { type: 'PAYMENT_FUNDING', sourceId: payment.id },
    });
    expect(count).toBe(1);
  });

  t('10 ta parallel bir xil webhook — faqat BITTA PAYMENT_FUNDING journal (race)', async () => {
    const { contractId, buyer, priceSom } = await createActiveContract();
    const created = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', 'ledger-parallel-1')
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const { raw, signature } = signedWebhook({
      eventId: 'ledger-parallel-evt-1',
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100,
      currency: 'UZS',
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => postWebhook(raw, signature)));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const count = await db!.ledgerTransaction.count({ where: { type: 'PAYMENT_FUNDING', sourceId: payment.id } });
    expect(count).toBe(1);
  });

  // ── Gating: unfunded contract ─────────────────────────────────────────

  t('Unfunded contract — seller ish topshira olmaydi (CONTRACT_NOT_FUNDED), ledger bo‘sh', async () => {
    const { contractId, seller, milestoneIds } = await createActiveContract();
    const res = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneIds[0]!}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Unfunded deliverable test' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONTRACT_NOT_FUNDED');

    const contractLedgerCount = await db!.ledgerTransaction.count({ where: { sourceId: contractId } });
    expect(contractLedgerCount).toBe(0);
  });

  t('Defensive invariant: to‘lovsiz milestone (DB orqali majburiy SUBMITTED) approve qilinsa — 500, HAMMASI rollback', async () => {
    const { contractId, buyer, milestoneIds } = await createActiveContract();
    // Bo'lim 17/59 — "boshqa qatlamga ishonmaydi": submit gate'ini ATAYLAB
    // DB orqali chetlab o'tamiz (kelajakdagi kod xatosini simulyatsiya
    // qilish uchun) va settlement'ning O'ZINI mustaqil himoyasini sinaymiz.
    await db!.milestone.update({
      where: { id: milestoneIds[0]! },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });

    const res = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneIds[0]!}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INVARIANT_VIOLATION');

    // Butun tranzaksiya rollback bo'lgan — milestone ham APPROVED bo'lib
    // QOLMAGAN, Contract ham COMPLETED bo'lib QOLMAGAN (bo'lim 17: "silent
    // COMPLETED + failed settlement yo'q").
    const milestone = await db!.milestone.findUniqueOrThrow({ where: { id: milestoneIds[0]! } });
    expect(milestone.status).toBe('SUBMITTED');
    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('ACTIVE');
    const ledgerCount = await db!.ledgerTransaction.count({ where: { sourceId: contractId } });
    expect(ledgerCount).toBe(0);
  });

  // ── Contract settlement ───────────────────────────────────────────────

  t('To‘liq shartnoma yakunlanishi — ESCROW -agreedAmount ; SELLER_PAYABLE +net ; PLATFORM_REVENUE +fee', async () => {
    const { contractId, buyer, seller, priceSom, staffToken, milestoneIds } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    const approveRes = await submitAndApprove(contractId, milestoneIds[0]!, seller, buyer);
    expect(approveRes.status).toBe(200);

    const contract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe('COMPLETED');

    const settlement = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'CONTRACT_SETTLEMENT', sourceId: contractId } },
      include: { entries: { include: { account: true } } },
    });
    expect(settlement.entries).toHaveLength(3);
    expect(settlement.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);

    const escrow = settlement.entries.find((e) => e.account.type === 'ESCROW')!;
    const payable = settlement.entries.find((e) => e.account.type === 'SELLER_PAYABLE')!;
    const revenue = settlement.entries.find((e) => e.account.type === 'PLATFORM_REVENUE')!;
    expect(escrow.amount).toBe(-(BigInt(priceSom) * 100n));
    expect(payable.amount + revenue.amount).toBe(BigInt(priceSom) * 100n);
    expect(payable.account.ownerId).toBe(seller.userId);

    // Seller balance API — ledgerdan hisoblangan.
    const balance = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(balance.body.currency).toBe('UZS');
    expect(BigInt(balance.body.available) * 100n).toBe(payable.amount);

    // Staff — read-only ko'rinish.
    const staffDetail = await request(app!.getHttpServer())
      .get(`/api/v1/staff/ledger/transactions/${settlement.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(staffDetail.body.entries).toHaveLength(3);
    expect(staffDetail.body.type).toBe('CONTRACT_SETTLEMENT');
  });

  t('Bo‘lim 58 — zero-fee contract: settlement 2 ta yozuv bilan balanslangan (PLATFORM_REVENUE yo‘q)', async () => {
    const { contractId, buyer, seller, priceSom, milestoneIds } = await createActiveContract();
    await payAndConfirm(contractId, buyer, priceSom);
    // Fee snapshot'ni ATAYLAB 0'ga majburlaymiz (real fee konstantasi bilan
    // yetib bo'lmaydigan chetki holatni sinash uchun — bo'lim 58).
    await db!.contract.update({ where: { id: contractId }, data: { platformFeeAmountSnapshot: 0n } });

    const approveRes = await submitAndApprove(contractId, milestoneIds[0]!, seller, buyer);
    expect(approveRes.status).toBe(200);

    const settlement = await db!.ledgerTransaction.findUniqueOrThrow({
      where: { type_sourceId: { type: 'CONTRACT_SETTLEMENT', sourceId: contractId } },
      include: { entries: { include: { account: true } } },
    });
    expect(settlement.entries).toHaveLength(2);
    expect(settlement.entries.some((e) => e.account.type === 'PLATFORM_REVENUE')).toBe(false);
    expect(settlement.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);

    const balance = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(balance.body.available).toBe(priceSom); // fee=0 → seller to'liq summani oladi
  });

  t('2 ta milestone, oxirgi PARALLEL approve — faqat BITTA CONTRACT_SETTLEMENT journal', async () => {
    const { contractId, buyer, seller, priceSom, milestoneIds } = await createActiveContract([
      { title: 'Birinchi', amount: 400_000 },
      { title: 'Ikkinchi', amount: 500_000 },
    ]);
    await payAndConfirm(contractId, buyer, priceSom);
    for (const id of milestoneIds) {
      await request(app!.getHttpServer())
        .post(`/api/v1/seller/contracts/${contractId}/milestones/${id}/submit`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .send({ message: 'Parallel approve deliverable' })
        .expect(200);
    }
    const approveResults = await Promise.all(
      milestoneIds.map((id) =>
        request(app!.getHttpServer())
          .post(`/api/v1/me/contracts/${contractId}/milestones/${id}/approve`)
          .set('Authorization', `Bearer ${buyer.accessToken}`),
      ),
    );
    expect(approveResults.every((r) => r.status === 200)).toBe(true);

    const settlementCount = await db!.ledgerTransaction.count({
      where: { type: 'CONTRACT_SETTLEMENT', sourceId: contractId },
    });
    expect(settlementCount).toBe(1);
    const completedAudits = await db!.auditLog.count({
      where: { resourceType: 'CONTRACT', resourceId: contractId, action: 'CONTRACT_COMPLETED' },
    });
    expect(completedAudits).toBe(1);
  });

  // ── Seller balance izolyatsiyasi ──────────────────────────────────────

  t('Seller balance — faqat o‘z SELLER_PAYABLE hisobini ko‘radi (izolyatsiya)', async () => {
    const first = await createActiveContract([{ title: 'Bosqich A', amount: 300_000 }]);
    await payAndConfirm(first.contractId, first.buyer, first.priceSom);
    await submitAndApprove(first.contractId, first.milestoneIds[0]!, first.seller, first.buyer);

    const second = await createActiveContract([{ title: 'Bosqich B', amount: 700_000 }]);
    await payAndConfirm(second.contractId, second.buyer, second.priceSom);
    await submitAndApprove(second.contractId, second.milestoneIds[0]!, second.seller, second.buyer);

    const balanceA = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${first.seller.accessToken}`)
      .expect(200);
    const balanceB = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${second.seller.accessToken}`)
      .expect(200);

    expect(balanceA.body.available).not.toBe(balanceB.body.available);
    expect(balanceA.body.available).toBeLessThan(second.priceSom);
    expect(balanceB.body.available).toBeGreaterThan(first.priceSom - 1);
  });

  t('Buyer /seller/balance ni chaqira olmaydi (rol chegarasi)', async () => {
    const { buyer } = await createActiveContract();
    const res = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(res.status).toBe(403);
  });

  // ── Staff ledger o'qish ───────────────────────────────────────────────

  t('PAYMENTS ruxsatisiz staff — /staff/ledger/transactions 403', async () => {
    const noPermStaff = await createStaffSession(app!, db!, ['DASHBOARD']);
    const res = await request(app!.getHttpServer())
      .get('/api/v1/staff/ledger/transactions')
      .set('Authorization', `Bearer ${noPermStaff.accessToken}`);
    expect(res.status).toBe(403);
  });

  t('Staff — sourceId bo‘yicha filtrlab ro‘yxatni ko‘radi', async () => {
    const { contractId, buyer, priceSom, staffToken } = await createActiveContract();
    const payment = await payAndConfirm(contractId, buyer, priceSom);

    const list = await request(app!.getHttpServer())
      .get('/api/v1/staff/ledger/transactions')
      .query({ sourceId: payment.id })
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].type).toBe('PAYMENT_FUNDING');
  });
});
