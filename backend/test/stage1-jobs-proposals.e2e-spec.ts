import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import {
  CapturingSmsProvider,
  createApprovedSeller,
  createCategory,
  createStaffSession,
  freshDb,
  futureIsoDate,
  loginNewUser,
} from './support/fixtures';

const DB = 'health_e2e';

describe('Stage 1 Jobs & Proposals Server/DB Invariants (e2e, real Postgres + Redis)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('stage1-jobs-proposals.e2e');
    if (!reachable) return;
    await provisionDb(DB);
    await flushRedis();
    sms = new CapturingSmsProvider();
    app = await buildTestApp((b) => b.overrideProvider(SMS_PROVIDER).useValue(sms));
    db = freshDb();
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

  t('enforces session identity, authorization boundaries, validation, closed-job rejection, parallel dedup, and DB constraints', async () => {
    const staff = await createStaffSession(app!, db!, ['KYC', 'CATEGORIES', 'SERVICES', 'ORDERS', 'USERS']);
    const categoryId = await createCategory(app!, staff.accessToken, `cat-stage1-${Date.now()}`);

    const buyerA = await loginNewUser(app!, sms, 'BUYER');
    const buyerC = await loginNewUser(app!, sms, 'BUYER');
    const sellerB = await createApprovedSeller(app!, sms, staff.accessToken);
    const sellerD = await createApprovedSeller(app!, sms, staff.accessToken);

    // 1. Unauthenticated writes are rejected with 401
    await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .send({
        category: categoryId,
        title: 'Unauth job title',
        description: 'This request has no session token and must be rejected.',
        budgetMin: 100_000,
        budgetMax: 200_000,
      })
      .expect(401);

    // 2. Client cannot spoof buyerId in job creation body (forbidNonWhitelisted rejects extra fields)
    await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyerA.accessToken}`)
      .send({
        buyerId: buyerC.userId,
        category: categoryId,
        title: 'Spoofed buyer job title',
        description: 'Trying to create a job under another buyer identity must fail.',
        budgetMin: 100_000,
        budgetMax: 200_000,
      })
      .expect(422);

    // Seller cannot create a job (403)
    await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({
        category: categoryId,
        title: 'Seller trying to post job',
        description: 'Only buyer role may publish job postings on the marketplace.',
        budgetMin: 100_000,
        budgetMax: 200_000,
      })
      .expect(403);

    // 3. Buyer A creates a valid job; owner comes strictly from JWT session
    const jobRes = await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyerA.accessToken}`)
      .send({
        category: categoryId,
        title: 'Stage 1 Marketplace Integration Job',
        description: 'Need a production-ready marketplace workflow with NestJS and PostgreSQL.',
        budgetMin: 500_000,
        budgetMax: 1_500_000,
        skillsRequired: ['NestJS', 'PostgreSQL'],
        deadline: futureIsoDate(14),
      })
      .expect(200);

    const jobId = jobRes.body.id as string;
    expect(jobRes.body.buyerId).toBe(buyerA.userId);

    // Unauthenticated proposal write is rejected
    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .send({
        bidAmount: 800_000,
        estimatedDeliveryDays: 5,
        coverLetter: 'Unauthenticated proposal must be rejected immediately.',
      })
      .expect(401);

    // 4. Server validation rejects invalid bidAmount, estimatedDeliveryDays, and short coverLetter
    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({
        bidAmount: 500, // < 1000
        estimatedDeliveryDays: 5,
        coverLetter: 'Valid cover letter text here.',
      })
      .expect(422);

    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({
        bidAmount: 800_000,
        estimatedDeliveryDays: 0, // < 1
        coverLetter: 'Valid cover letter text here.',
      })
      .expect(422);

    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({
        bidAmount: 800_000,
        estimatedDeliveryDays: 5,
        coverLetter: 'hi', // < 5
      })
      .expect(422);

    // Client cannot spoof sellerId in proposal body
    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({
        sellerId: sellerD.userId,
        bidAmount: 800_000,
        estimatedDeliveryDays: 5,
        coverLetter: 'Trying to spoof sellerId in proposal payload.',
      })
      .expect(422);

    // 5. Parallel duplicate submission by Seller B creates exactly 1 active proposal in DB
    const [p1, p2] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/jobs/${jobId}/proposals`)
        .set('Authorization', `Bearer ${sellerB.accessToken}`)
        .send({
          bidAmount: 950_000,
          estimatedDeliveryDays: 7,
          coverLetter: 'Salom! Loyihani 7 kun ichida toza arxitektura va testlar bilan topshiraman.',
        }),
      request(app!.getHttpServer())
        .post(`/api/v1/jobs/${jobId}/proposals`)
        .set('Authorization', `Bearer ${sellerB.accessToken}`)
        .send({
          bidAmount: 950_000,
          estimatedDeliveryDays: 7,
          coverLetter: 'Salom! Loyihani 7 kun ichida toza arxitektura va testlar bilan topshiraman.',
        }),
    ]);

    const statuses = [p1.status, p2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const savedProposals = await db!.jobProposal.findMany({ where: { jobId, sellerId: sellerB.userId } });
    expect(savedProposals).toHaveLength(1);
    expect(Number(savedProposals[0]!.bidAmount)).toBe(950_000);
    expect(savedProposals[0]!.estimatedDeliveryDays).toBe(7);

    const jobRow = await db!.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(jobRow.proposalsCount).toBe(1);

    const proposalId = savedProposals[0]!.id;

    // 6. Authorization boundaries: other buyer and competitor seller cannot read proposals
    await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}/proposals`)
      .expect(401);

    await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${buyerC.accessToken}`)
      .expect(403);

    await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerD.accessToken}`)
      .expect(403);

    await request(app!.getHttpServer())
      .get(`/api/v1/jobs/proposals/${proposalId}`)
      .set('Authorization', `Bearer ${sellerD.accessToken}`)
      .expect(403);

    await request(app!.getHttpServer())
      .get(`/api/v1/jobs/proposals/${proposalId}`)
      .set('Authorization', `Bearer ${buyerC.accessToken}`)
      .expect(403);

    // Buyer A sees the proposal with exact price, delivery days, and cover letter
    const buyerListRes = await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${buyerA.accessToken}`)
      .expect(200);
    expect(buyerListRes.body).toHaveLength(1);
    expect(buyerListRes.body[0]).toMatchObject({
      id: proposalId,
      sellerId: sellerB.userId,
      bidAmount: 950_000,
      estimatedDeliveryDays: 7,
      coverLetter: 'Salom! Loyihani 7 kun ichida toza arxitektura va testlar bilan topshiraman.',
    });

    // 7. DB-level constraints reject invalid direct writes (unique + CHECK constraints)
    await expect(
      db!.jobProposal.create({
        data: {
          id: 'prop_db_dup',
          jobId,
          sellerId: sellerB.userId,
          bidAmount: 500_000n,
          estimatedDeliveryDays: 3,
          coverLetter: 'Duplicate direct DB insert must fail.',
          payload: { id: 'prop_db_dup', bidAmount: 500_000 },
        },
      }),
    ).rejects.toThrow();

    await expect(
      db!.jobProposal.create({
        data: {
          id: 'prop_db_bad_bid',
          jobId,
          sellerId: sellerD.userId,
          bidAmount: 100n, // violates bidAmount >= 1000 CHECK
          estimatedDeliveryDays: 3,
          coverLetter: 'Below minimum bid direct DB insert must fail.',
          payload: { id: 'prop_db_bad_bid', bidAmount: 100 },
        },
      }),
    ).rejects.toThrow();

    // 8. Closed job rejects new proposals
    await request(app!.getHttpServer())
      .patch(`/api/v1/jobs/${jobId}/close`)
      .set('Authorization', `Bearer ${buyerA.accessToken}`)
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerD.accessToken}`)
      .send({
        bidAmount: 700_000,
        estimatedDeliveryDays: 4,
        coverLetter: 'Closed job must reject this proposal.',
      })
      .expect(422);
  });
});
