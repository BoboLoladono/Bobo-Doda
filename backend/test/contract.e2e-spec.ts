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
  createApprovedSeller,
  createStaffSession,
  freshDb,
  futureIsoDate,
  loginNewUser,
  type UserSession,
} from './support/fixtures';

const DB = 'health_e2e';

/** Bosqich 4 — Contract/Order/Milestone: yaratish, holat mashinasi, egalik, concurrency. */
describe('Contract + Milestone (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let provider!: TestPaymentProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('contract.e2e');
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

  // Har test kamida 2-3 ta OTP login qiladi (buyer + seller + ba'zan
  // begona/qo'shimcha ishtirokchi) — bitta faylda 15+ test bir xil loopback
  // IP'dan `OTP_IP_HOURLY_LIMIT` (20)ni tezda tugatib qo'yardi. Bu fayl
  // OTP RATE-LIMIT'ning O'ZINI sinamaydi (`auth.e2e-spec.ts` sinaydi) —
  // shuning uchun har test oldidan tozalash xavfsiz.
  beforeEach(async () => {
    if (reachable) await flushRedis();
  });

  const t = (name: string, fn: () => Promise<void>): void =>
    it(name, async () => {
      if (!reachable) return;
      await fn();
    });

  async function fullStaff() {
    return createStaffSession(app!, db!, ['KYC', 'CATEGORIES', 'SERVICES', 'ORDERS', 'USERS']);
  }

  let fundCounter = 0;
  /**
   * Bosqich 6 — `submitMilestone()` endi funded contract talab qiladi
   * (`CONTRACT_NOT_FUNDED`, bo'lim 18). Bu fayl Bosqich 4'da yozilgan —
   * to'lov tushunchasidan OLDIN — shuning uchun submit/approve oqimini
   * sinaydigan HAR bir test endi aynan shu qadamdan o'tishi SHART.
   */
  async function fundContract(contractId: string, buyer: UserSession, priceSom: number): Promise<void> {
    fundCounter += 1;
    const created = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', `contract-fund-${fundCounter}`)
      .expect(200);
    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const rawBody = JSON.stringify({
      eventId: `contract-fund-evt-${fundCounter}`,
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100,
      currency: 'UZS',
    });
    await request(app!.getHttpServer())
      .post('/api/v1/payments/webhooks/TEST')
      .set('Content-Type', 'application/json')
      .set(TEST_PROVIDER_SIGNATURE_HEADER, provider.signPayload(Buffer.from(rawBody)))
      .send(rawBody)
      .expect(200);
  }

  // ── Yaratish ──────────────────────────────────────────────────────────

  t('Buyer muvaffaqiyatli yaratadi — snapshot to‘g‘ri, milestone’lar tartibda', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom, seller } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        serviceId,
        deadline: futureIsoDate(),
        milestones: [
          { title: 'Birinchi bosqich', amount: priceSom * 0.4 },
          { title: 'Ikkinchi bosqich', amount: priceSom * 0.6 },
        ],
      })
      .expect(200);

    expect(res.body.status).toBe('PENDING_SELLER');
    expect(res.body.buyerId).toBe(buyer.userId);
    expect(res.body.sellerId).toBe(seller.userId);
    expect(res.body.agreedAmount).toBe(priceSom);
    expect(res.body.platformFeeRateBps).toBe(1000);
    expect(res.body.platformFeeAmount).toBe(Math.floor((priceSom * 1000) / 10000));
    expect(res.body.milestones).toHaveLength(2);
    expect(res.body.milestones[0].position).toBe(1);
    expect(res.body.milestones[1].position).toBe(2);
    expect(res.body.milestones.every((m: { status: string }) => m.status === 'PENDING')).toBe(true);
  });

  t('Milestone yig‘indisi mos kelmasa — MILESTONE_AMOUNT_MISMATCH', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom - 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MILESTONE_AMOUNT_MISMATCH');
  });

  t('O‘tmishdagi deadline — DEADLINE_INVALID', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        serviceId,
        deadline: '2020-01-01T00:00:00.000Z',
        milestones: [{ title: 'Yagona bosqich', amount: priceSom }],
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('DEADLINE_INVALID');
  });

  t('ACTIVE bo‘lmagan (DRAFT) xizmatdan yaratib bo‘lmaydi — SERVICE_NOT_AVAILABLE', async () => {
    const staff = await fullStaff();
    const seller = await createApprovedSeller(app!, sms, staff.accessToken);
    const cat = await request(app!.getHttpServer())
      .post('/api/v1/staff/categories')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ slug: `draft-svc-${Date.now()}`, nameUz: 'X', nameRu: 'X', nameEn: 'X' })
      .expect(200);
    const draftSvc = await request(app!.getHttpServer())
      .post('/api/v1/seller/services')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ categoryId: cat.body.id, title: 'Draft service here', description: 'x'.repeat(25), price: 1000, deliveryDays: 1 })
      .expect(200);
    const buyer = await loginNewUser(app!, sms, 'BUYER');

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId: draftSvc.body.id, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: 1000 }] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SERVICE_NOT_AVAILABLE');
  });

  t('O‘z xizmatini sotib olish — CONTRACT_SELF_PURCHASE_NOT_ALLOWED', async () => {
    const staff = await fullStaff();
    // Ikkala rolga ega bo'lishning YAGONA mavjud yo'li: BUYER sifatida
    // boshlab, seller arizasi APPROVED bo'lishi (`roles[]`ga SELLER shunda
    // qo'shiladi — ADR-04). `/me/roles/switch` FAQAT allaqachon ega bo'lgan
    // rolga o'tkazadi, YANGI rol bermaydi — shuning uchun "choose SELLER
    // keyin switch BUYER" ishlamaydi (roles=[SELLER] bo'lib qoladi).
    const user = await loginNewUser(app!, sms, 'BUYER');
    const applied = await request(app!.getHttpServer())
      .post('/api/v1/me/seller-application')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ legalName: 'Legal Name', displayName: 'Self Purchase Seller' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/seller-applications/${applied.body.id}/approve`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);

    const asSeller = await request(app!.getHttpServer())
      .post('/api/v1/me/roles/switch')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ role: 'SELLER' })
      .expect(200);
    const sellerToken = asSeller.body.accessToken as string;

    const category = await request(app!.getHttpServer())
      .post('/api/v1/staff/categories')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ slug: `self-purchase-${Date.now()}`, nameUz: 'X', nameRu: 'X', nameEn: 'X' })
      .expect(200);
    const priceSom = 700_000;
    const svc = await request(app!.getHttpServer())
      .post('/api/v1/seller/services')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ categoryId: category.body.id, title: 'My own listed service', description: 'x'.repeat(25), price: priceSom, deliveryDays: 2 })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/services/${svc.body.id}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/services/${svc.body.id}/approve`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);

    const asBuyer = await request(app!.getHttpServer())
      .post('/api/v1/me/roles/switch')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ role: 'BUYER' })
      .expect(200);

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${asBuyer.body.accessToken}`)
      .send({
        serviceId: svc.body.id,
        deadline: futureIsoDate(),
        milestones: [{ title: 'Yagona bosqich', amount: priceSom }],
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONTRACT_SELF_PURCHASE_NOT_ALLOWED');
  });

  t('BLOCKED buyer yarata olmaydi (ACCOUNT_BLOCKED)', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/users/${buyer.userId}/block`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ reason: 'test block for contract creation' })
      .expect(200);

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BLOCKED');
  });

  t('SUSPENDED seller (sellerStatus) — yangi contract yaratib bo‘lmaydi (SELLER_NOT_APPROVED)', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom, seller } = await createActiveService(app!, sms, staff.accessToken);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/sellers/${seller.userId}/suspend`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ reason: 'test seller suspension for contract creation' })
      .expect(200);
    const buyer = await loginNewUser(app!, sms, 'BUYER');

    const res = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELLER_NOT_APPROVED');
  });

  t('Snapshot immutable — Service keyin tahrirlansa/pauza qilinsa ham Contract o‘zgarmaydi', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom, seller } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');

    const created = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] })
      .expect(200);
    const originalTitleSnapshot = created.body.serviceTitleSnapshot;

    await request(app!.getHttpServer())
      .patch(`/api/v1/seller/services/${serviceId}`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ title: 'Butunlay yangilangan sarlavha' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/services/${serviceId}/pause`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    const after = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${created.body.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(after.body.serviceTitleSnapshot).toBe(originalTitleSnapshot);
    expect(after.body.serviceTitleSnapshot).not.toBe('Butunlay yangilangan sarlavha');
    expect(after.body.agreedAmount).toBe(priceSom); // narx ham o'zgarmagan
  });

  // ── Egalik ────────────────────────────────────────────────────────────

  async function createPendingContract() {
    const staff = await fullStaff();
    const { serviceId, priceSom, seller } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const created = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] })
      .expect(200);
    return {
      staff,
      seller,
      buyer,
      priceSom,
      contractId: created.body.id as string,
      milestoneId: created.body.milestones[0].id as string,
    };
  }

  t('Begona seller/buyer shartnomani ko‘ra olmaydi (404, mavjudligi leak qilinmaydi)', async () => {
    const { contractId } = await createPendingContract();
    const stranger = await loginNewUser(app!, sms, 'BUYER');
    const strangerSeller = await createApprovedSeller(app!, sms, (await fullStaff()).accessToken);

    const asBuyerStranger = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contractId}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asBuyerStranger.status).toBe(404);
    expect(asBuyerStranger.body.code).toBe('CONTRACT_NOT_FOUND');

    const asSellerStranger = await request(app!.getHttpServer())
      .get(`/api/v1/seller/contracts/${contractId}`)
      .set('Authorization', `Bearer ${strangerSeller.accessToken}`);
    expect(asSellerStranger.status).toBe(404);
  });

  // ── Accept / Reject / Cancel ─────────────────────────────────────────

  t('Seller accept — ACTIVE, milestone’lar IN_PROGRESS', async () => {
    const { seller, contractId } = await createPendingContract();
    const res = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.milestones.every((m: { status: string }) => m.status === 'IN_PROGRESS')).toBe(true);
  });

  t('Seller reject — REJECTED, qayta accept qilib bo‘lmaydi', async () => {
    const { seller, contractId } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/reject`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    const again = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_TRANSITION');
  });

  t('Buyer cancel (PENDING_SELLER’da) — CANCELLED; ACTIVE’dan keyin cancel INVALID_TRANSITION', async () => {
    const { buyer, contractId } = await createPendingContract();
    // Boshqa (yangi) shartnoma — PENDING_SELLER holatida bekor qilish uchun.
    const cancelled = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/cancel`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    // Endi ACTIVE holatidagi (accept qilingan) shartnoma bilan sinaymiz.
    const { buyer: buyer2, seller: seller2, contractId: contractId2 } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId2}/accept`)
      .set('Authorization', `Bearer ${seller2.accessToken}`)
      .expect(200);
    const invalidCancel = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId2}/cancel`)
      .set('Authorization', `Bearer ${buyer2.accessToken}`);
    expect(invalidCancel.status).toBe(409);
    expect(invalidCancel.body.code).toBe('INVALID_TRANSITION');
  });

  t('Parallel accept vs reject — faqat BITTASI g‘olib chiqadi', async () => {
    const { seller, contractId } = await createPendingContract();
    const [acceptRes, rejectRes] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/seller/contracts/${contractId}/accept`)
        .set('Authorization', `Bearer ${seller.accessToken}`),
      request(app!.getHttpServer())
        .post(`/api/v1/seller/contracts/${contractId}/reject`)
        .set('Authorization', `Bearer ${seller.accessToken}`),
    ]);
    const statuses = [acceptRes.status, rejectRes.status].sort();
    expect(statuses).toEqual([200, 409]);

    const final = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(['ACTIVE', 'REJECTED']).toContain(final.status);
  });

  // ── Milestone: submit / revision / approve ──────────────────────────

  t('Holat mashinasi: submit → revision → resubmit → approve; noto‘g‘ri o‘tish rad etiladi', async () => {
    const { buyer, seller, contractId, milestoneId, priceSom } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await fundContract(contractId, buyer, priceSom);

    // Hali IN_PROGRESS bo'lmagan (submit qilinmagan) bosqichni approve qilib bo'lmaydi.
    const badApprove = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(badApprove.status).toBe(409);
    expect(badApprove.body.code).toBe('INVALID_TRANSITION');

    const submitted = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Tayyor', deliverableUrls: ['https://example.com/file.pdf'] })
      .expect(200);
    expect(submitted.body.status).toBe('SUBMITTED');

    const revision = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/request-revision`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'Iltimos qaytadan ko‘rib chiqing' })
      .expect(200);
    expect(revision.body.status).toBe('REVISION_REQUESTED');

    const resubmitted = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Tuzatildi' })
      .expect(200);
    expect(resubmitted.body.status).toBe('SUBMITTED');

    const approved = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');

    // Yakuniy (yagona) milestone approve bo'lgach — shartnoma ham COMPLETED.
    const finalContract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(finalContract.status).toBe('COMPLETED');

    // APPROVED — final, qayta o'zgartirib bo'lmaydi.
    const doubleApprove = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`);
    expect(doubleApprove.status).toBe(409);
  });

  t('Ega bo‘lmagan foydalanuvchi milestone’ga ta’sir qila olmaydi (404)', async () => {
    const { seller, contractId, milestoneId } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    const stranger = await createApprovedSeller(app!, sms, (await fullStaff()).accessToken);
    const res = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('MILESTONE_NOT_FOUND');
  });

  t('Parallel submit vs submit — faqat BITTASI g‘olib chiqadi', async () => {
    const { buyer, seller, contractId, milestoneId, priceSom } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await fundContract(contractId, buyer, priceSom);

    const [r1, r2] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .send({ message: 'Parallel topshirish 1' }),
      request(app!.getHttpServer())
        .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .send({ message: 'Parallel topshirish 2' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });

  t('Bo‘sh deliverable topshirish rad etiladi (422 EMPTY_DELIVERABLE)', async () => {
    const { buyer, seller, contractId, milestoneId, priceSom } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await fundContract(contractId, buyer, priceSom);
    const emptyRes = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({});
    expect(emptyRes.status).toBe(422);
    expect(emptyRes.body.code).toBe('EMPTY_DELIVERABLE');
  });

  t('Parallel approve vs request-revision (bir xil milestone) — faqat BITTASI g‘olib chiqadi', async () => {
    const { buyer, seller, contractId, milestoneId, priceSom } = await createPendingContract();
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await fundContract(contractId, buyer, priceSom);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'Tayyor natija' })
      .expect(200);

    const [approveRes, revisionRes] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
        .set('Authorization', `Bearer ${buyer.accessToken}`),
      request(app!.getHttpServer())
        .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/request-revision`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ reason: 'parallel race test reason here' }),
    ]);
    expect([approveRes.status, revisionRes.status].sort()).toEqual([200, 409]);
  });

  t('YAKUNIY (oxirgi ikkita) milestone parallel approve qilinsa — contract ANIQ BIR MARTA COMPLETED bo‘ladi', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom, seller } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const created = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        serviceId,
        deadline: futureIsoDate(),
        milestones: [
          { title: 'Race milestone A', amount: priceSom * 0.5 },
          { title: 'Race milestone B', amount: priceSom * 0.5 },
        ],
      })
      .expect(200);
    const contractId = created.body.id as string;
    const milestones = created.body.milestones as { id: string }[];
    const mA = milestones[0]!;
    const mB = milestones[1]!;

    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    await fundContract(contractId, buyer, priceSom);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${mA.id}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'A bosqich natijasi' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${mB.id}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ message: 'B bosqich natijasi' })
      .expect(200);

    const [approveA, approveB] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/me/contracts/${contractId}/milestones/${mA.id}/approve`)
        .set('Authorization', `Bearer ${buyer.accessToken}`),
      request(app!.getHttpServer())
        .post(`/api/v1/me/contracts/${contractId}/milestones/${mB.id}/approve`)
        .set('Authorization', `Bearer ${buyer.accessToken}`),
    ]);
    expect(approveA.status).toBe(200);
    expect(approveB.status).toBe(200);

    const finalContract = await db!.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(finalContract.status).toBe('COMPLETED');

    // Faqat BITTA CONTRACT_COMPLETED audit/outbox yozuvi — ikki marta emas.
    const completedAudits = await db!.auditLog.count({
      where: { resourceType: 'CONTRACT', resourceId: contractId, action: 'CONTRACT_COMPLETED' },
    });
    expect(completedAudits).toBe(1);
    const completedOutbox = await db!.outboxEvent.count({
      where: { aggregateType: 'CONTRACT', aggregateId: contractId, eventType: 'CONTRACT_COMPLETED' },
    });
    expect(completedOutbox).toBe(1);
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  t('Idempotency-Key — takroriy so‘rov IKKINCHI Contract yaratmaydi, bir xil javobni qaytaradi', async () => {
    const staff = await fullStaff();
    const { serviceId, priceSom } = await createActiveService(app!, sms, staff.accessToken);
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const key = `idem-${Date.now()}`;
    const payload = { serviceId, deadline: futureIsoDate(), milestones: [{ title: 'Yagona bosqich', amount: priceSom }] };

    const first = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    const second = await request(app!.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    expect(second.body.id).toBe(first.body.id);
    const count = await db!.contract.count({ where: { buyerId: buyer.userId, serviceId } });
    expect(count).toBe(1);
  });

  // ── Staff ─────────────────────────────────────────────────────────────

  t('Staff — ORDERS huquqisiz kirolmaydi; huquq bilan ro‘yxat/detalni o‘qiy oladi', async () => {
    const { contractId } = await createPendingContract();
    const noPerm = await createStaffSession(app!, db!, ['KYC']);
    const denied = await request(app!.getHttpServer())
      .get(`/api/v1/staff/contracts/${contractId}`)
      .set('Authorization', `Bearer ${noPerm.accessToken}`);
    expect(denied.status).toBe(403);

    const withPerm = await createStaffSession(app!, db!, ['ORDERS']);
    const list = await request(app!.getHttpServer())
      .get('/api/v1/staff/contracts')
      .set('Authorization', `Bearer ${withPerm.accessToken}`)
      .expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);

    const detail = await request(app!.getHttpServer())
      .get(`/api/v1/staff/contracts/${contractId}`)
      .set('Authorization', `Bearer ${withPerm.accessToken}`)
      .expect(200);
    expect(detail.body.id).toBe(contractId);
  });
});
