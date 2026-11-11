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
  createApprovedSeller,
  createCategory,
  createStaffSession,
  freshDb,
  futureIsoDate,
  loginNewUser,
  type UserSession,
} from './support/fixtures';

const DB = 'health_e2e';

describe('Job-to-Contract End-to-End Workflow & Invariants (e2e, isolated Postgres + Redis)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let provider!: TestPaymentProvider;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('job-contract.e2e');
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

  let webhookCounter = 0;
  async function fundContract(contractId: string, buyer: UserSession, priceSom: number): Promise<void> {
    webhookCounter += 1;
    const created = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', `job-fund-idemp-${webhookCounter}`)
      .expect(200);

    const payment = await db!.payment.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const rawBody = JSON.stringify({
      eventId: `job-fund-evt-${webhookCounter}`,
      providerPaymentId: payment.providerPaymentId,
      eventType: 'payment.succeeded',
      status: 'SUCCEEDED',
      amount: priceSom * 100, // in tiyin
      currency: 'UZS',
    });

    await request(app!.getHttpServer())
      .post('/api/v1/payments/webhooks/TEST')
      .set('Content-Type', 'application/json')
      .set(TEST_PROVIDER_SIGNATURE_HEADER, provider.signPayload(Buffer.from(rawBody)))
      .send(rawBody)
      .expect(200);
  }

  t('Full Job-to-Contract workflow: creation, proposal, boundaries, atomic hire, User Rule #2 same-day cancellation, and escrow settlement', async () => {
    // 1. Setup actors
    const staff = await createStaffSession(app!, db!, ['KYC', 'CATEGORIES', 'SERVICES', 'ORDERS', 'USERS']);
    const categoryId = await createCategory(app!, staff.accessToken, `cat-jobs-${Date.now()}`);

    const buyer1 = await loginNewUser(app!, sms, 'BUYER');
    const strangerBuyer = await loginNewUser(app!, sms, 'BUYER');
    const approvedSeller = await createApprovedSeller(app!, sms, staff.accessToken);
    const unapprovedSeller = await loginNewUser(app!, sms, 'SELLER'); // No staff KYC approval
    const sellerToSuspend = await createApprovedSeller(app!, sms, staff.accessToken);

    // 2. Buyer posts Job 1
    const job1Res = await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .send({
        category: categoryId,
        title: 'Backend API va Mikroservis arxitekturasi',
        description: 'Ushbu loyihada PostgreSQL va NestJS bilan yuqori yuklamali tizim yaratish kerak.',
        budgetMin: 500_000,
        budgetMax: 1_000_000,
        deadline: futureIsoDate(30),
      })
      .expect(200);

    const job1Id = job1Res.body.id as string;

    // Buyer posts Job 2 (for User Rule #2 same-day cancellation testing)
    const job2Res = await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .send({
        category: categoryId,
        title: 'Ikkinchi loyiha (Frontend integratsiya)',
        description: 'Next.js va TailwindCSS asosidagi foydalanuvchi interfeysini ishlab chiqish.',
        budgetMin: 300_000,
        budgetMax: 700_000,
        deadline: futureIsoDate(30),
      })
      .expect(200);

    const job2Id = job2Res.body.id as string;

    // 3. Approved Seller submits proposal on Job 1
    const prop1Res = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${job1Id}/proposals`)
      .set('Authorization', `Bearer ${approvedSeller.accessToken}`)
      .send({
        bidAmount: 600_000,
        coverLetter: 'Men ushbu arxitekturani 3 kunda to‘liq va sifatli ishlab beraman.',
        estimatedDeliveryDays: 5,
      })
      .expect(200);

    const proposal1Id = prop1Res.body.id as string;

    // Unapproved Seller tries to submit proposal on Job 1 -> Rejected by SellerEligibilityGuard (403)
    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${job1Id}/proposals`)
      .set('Authorization', `Bearer ${unapprovedSeller.accessToken}`)
      .send({
        bidAmount: 550_000,
        coverLetter: 'Hali KYC o‘tmaganman lekin tajribam bor.',
      })
      .expect(403);

    // sellerToSuspend submits proposal on Job 1
    const propSuspendRes = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${job1Id}/proposals`)
      .set('Authorization', `Bearer ${sellerToSuspend.accessToken}`)
      .send({
        bidAmount: 580_000,
        coverLetter: 'Yaxshi taklif qilaman.',
      })
      .expect(200);
    const proposalSuspendId = propSuspendRes.body.id as string;

    // Suspend sellerToSuspend
    await db!.user.update({
      where: { id: sellerToSuspend.userId },
      data: { sellerStatus: 'SUSPENDED' },
    });

    // Approved Seller ALSO submits a proposal on Job 2 (competing proposal on same day)
    const prop2Res = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${job2Id}/proposals`)
      .set('Authorization', `Bearer ${approvedSeller.accessToken}`)
      .send({
        bidAmount: 400_000,
        coverLetter: 'Buni ham bir vaqtda qila olaman.',
      })
      .expect(200);

    const proposal2Id = prop2Res.body.id as string;

    // 4. Boundary Check: Stranger buyer cannot hire
    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposal1Id}/hire`)
      .set('Authorization', `Bearer ${strangerBuyer.accessToken}`)
      .send({})
      .expect(403);

    // Boundary Check: Suspended/Unapproved seller proposal cannot be hired -> SELLER_NOT_APPROVED (403)
    const unapprHire = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposalSuspendId}/hire`)
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .send({});
    expect(unapprHire.status).toBe(403);
    expect(unapprHire.body.code).toBe('SELLER_NOT_APPROVED');

    // Boundary Check: Mismatched milestones sum rejected
    const mismatchHire = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposal1Id}/hire`)
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .send({
        milestones: [
          { title: '1-bosqich', amount: 200_000 },
          { title: '2-bosqich', amount: 300_000 }, // sum 500_000 !== bid 600_000
        ],
      });
    expect(mismatchHire.status).toBe(422);
    expect(mismatchHire.body.code).toBe('MILESTONE_AMOUNT_MISMATCH');

    // 5. Authoritative Hire Execution with valid milestone breakdown
    const hireRes = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposal1Id}/hire`)
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .send({
        milestones: [
          { title: '1-bosqich: API va Modellar', amount: 200_000 },
          { title: '2-bosqich: Integratsiya va Testlar', amount: 400_000 },
        ],
      })
      .expect(200);

    const contract = hireRes.body;
    expect(contract.sourceType).toBe('JOB');
    expect(contract.jobId).toBe(job1Id);
    expect(contract.proposalId).toBe(proposal1Id);
    expect(contract.serviceId).toBeNull();
    expect(contract.buyerId).toBe(buyer1.userId);
    expect(contract.sellerId).toBe(approvedSeller.userId);
    expect(contract.status).toBe('PENDING_SELLER');
    expect(contract.agreedAmount).toBe(600_000);
    expect(contract.milestones).toHaveLength(2);
    expect(contract.milestones[0].amount).toBe(200_000);
    expect(contract.milestones[1].amount).toBe(400_000);

    // Assert Job 1 is now CLOSED
    const freshJob1 = await db!.job.findUniqueOrThrow({ where: { id: job1Id } });
    expect(freshJob1.status).toBe('CLOSED');

    // Assert Proposal 1 is now yollandi
    const freshProp1 = await db!.jobProposal.findUniqueOrThrow({ where: { id: proposal1Id } });
    expect(freshProp1.status).toBe('yollandi');

    // 6. Idempotency Check: Calling hire again returns the exact same contract
    const idempotentHire = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposal1Id}/hire`)
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .send({})
      .expect(200);
    expect(idempotentHire.body.id).toBe(contract.id);

    // 7. Enforce User Rule #2 (Same-day conflict cancellation):
    // Proposal 2 on Job 2 (by the same seller, on the same calendar day) MUST be automatically cancelled (rad_etilgan)!
    const freshProp2 = await db!.jobProposal.findUniqueOrThrow({ where: { id: proposal2Id } });
    expect(freshProp2.status).toBe('rad_etilgan');
    const prop2Payload = freshProp2.payload as Record<string, unknown>;
    expect(prop2Payload.reason).toContain('Boshqa ishga yollanganligi sababli bekor qilindi');

    // Job 2 proposalsCount must have decremented
    const freshJob2 = await db!.job.findUniqueOrThrow({ where: { id: job2Id } });
    expect(freshJob2.proposalsCount).toBe(0);

    // 8. Full Financial Contract Lifecycle on the created Job Contract:
    // A. Seller accepts the contract
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contract.id}/accept`)
      .set('Authorization', `Bearer ${approvedSeller.accessToken}`)
      .expect(200);

    const activeContract = await db!.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(activeContract.status).toBe('ACTIVE');

    // B. Buyer funds the contract via escrow
    await fundContract(contract.id, buyer1, 600_000);

    // Verify ledger: PAYMENT_FUNDING entry exists
    const fundingTx = await db!.ledgerTransaction.findFirst({
      where: { type: 'PAYMENT_FUNDING' },
      include: { entries: true },
    });
    expect(fundingTx).not.toBeNull();
    const fundingSum = fundingTx!.entries.reduce((sum, e) => sum + e.amount, 0n);
    expect(fundingSum).toBe(0n); // Zero-sum balanced

    // C. Milestone 1: Submit & Approve
    const m1 = contract.milestones[0];
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contract.id}/milestones/${m1.id}/submit`)
      .set('Authorization', `Bearer ${approvedSeller.accessToken}`)
      .send({ message: 'API va Modellar tayyor' })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contract.id}/milestones/${m1.id}/approve`)
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .expect(200);

    // D. Milestone 2: Submit & Approve (Final milestone triggers completion & financial settlement)
    const m2 = contract.milestones[1];
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contract.id}/milestones/${m2.id}/submit`)
      .set('Authorization', `Bearer ${approvedSeller.accessToken}`)
      .send({ message: 'Integratsiya va testlar muvaffaqiyatli yakunlandi' })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contract.id}/milestones/${m2.id}/approve`)
      .set('Authorization', `Bearer ${buyer1.accessToken}`)
      .expect(200);

    // Assert Contract status is now COMPLETED
    const completedContract = await db!.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(completedContract.status).toBe('COMPLETED');

    // E. Verify Financial Settlement in Double-Entry Ledger
    const settlementTx = await db!.ledgerTransaction.findFirst({
      where: { type: 'CONTRACT_SETTLEMENT', sourceId: contract.id },
      include: { entries: { include: { account: true } } },
    });
    expect(settlementTx).not.toBeNull();
    // Zero-sum double-entry invariant
    const settlementSum = settlementTx!.entries.reduce((sum, e) => sum + e.amount, 0n);
    expect(settlementSum).toBe(0n);

    // Check seller payable entry: net amount credited to SELLER_PAYABLE
    const sellerPayableEntry = settlementTx!.entries.find(
      (e) => e.account.type === 'SELLER_PAYABLE' && e.account.ownerId === approvedSeller.userId,
    );
    expect(sellerPayableEntry).toBeDefined();
    expect(sellerPayableEntry!.amount).toBeGreaterThan(0n);

    // Verify platform revenue entry
    const revenueEntry = settlementTx!.entries.find((e) => e.account.type === 'PLATFORM_REVENUE');
    expect(revenueEntry).toBeDefined();
    expect(revenueEntry!.amount).toBeGreaterThan(0n);

    // Sum of net seller payable + platform fee must equal agreedAmount in tiyin (600,000 * 100)
    expect(sellerPayableEntry!.amount + revenueEntry!.amount).toBe(60_000_000n);
  });

  t('Parallel concurrent hire race: serialized by row lock, exactly one contract created with unique proposalId', async () => {
    const staff = await createStaffSession(app!, db!, ['KYC', 'CATEGORIES', 'SERVICES', 'ORDERS', 'USERS']);
    const categoryId = await createCategory(app!, staff.accessToken, `cat-race-${Date.now()}`);

    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const seller = await createApprovedSeller(app!, sms, staff.accessToken);

    const jobRes = await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        category: categoryId,
        title: 'Parallel race condition test job',
        description: 'Concurrency and row locking testing for job-to-contract creation.',
        budgetMin: 400_000,
        budgetMax: 800_000,
        deadline: futureIsoDate(30),
      })
      .expect(200);

    const propRes = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobRes.body.id}/proposals`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        bidAmount: 500_000,
        coverLetter: 'Parallel execution proposal bid',
      })
      .expect(200);

    const proposalId = propRes.body.id as string;

    // Fire 2 concurrent hire calls simultaneously
    const [res1, res2] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/jobs/proposals/${proposalId}/hire`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({}),
      request(app!.getHttpServer())
        .post(`/api/v1/jobs/proposals/${proposalId}/hire`)
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({}),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Both responses reference the identical single created contract
    expect(res1.body.id).toBe(res2.body.id);

    // Verify DB count: exactly 1 contract exists for this proposal
    const contractCount = await db!.contract.count({
      where: { proposalId },
    });
    expect(contractCount).toBe(1);
  });
});
