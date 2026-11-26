const prevEnv = {
  PAYOUT_PROVIDER: process.env.PAYOUT_PROVIDER,
  PAYOUTS_ENABLED: process.env.PAYOUTS_ENABLED,
  COMPANY_NAME: process.env.COMPANY_NAME,
  COMPANY_BANK_NAME: process.env.COMPANY_BANK_NAME,
  COMPANY_BANK_ACCOUNT: process.env.COMPANY_BANK_ACCOUNT,
  COMPANY_BANK_MFO: process.env.COMPANY_BANK_MFO,
  COMPANY_BANK_INN: process.env.COMPANY_BANK_INN,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
};

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tmpUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bobododa-e2e-uploads-'));

process.env.PAYOUT_PROVIDER = 'MANUAL';
process.env.PAYOUTS_ENABLED = 'true';
process.env.COMPANY_NAME = 'Bobo-Doda Test MCHJ';
process.env.COMPANY_BANK_NAME = 'Kapitalbank ATB Test';
process.env.COMPANY_BANK_ACCOUNT = '20208000900000001234';
process.env.COMPANY_BANK_MFO = '00445';
process.env.COMPANY_BANK_INN = '300000001';
process.env.UPLOAD_DIR = tmpUploadDir;

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { ContractService } from '@/modules/contract/contract.service';
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

describe('First Release Marketplace E2E (10% fee, negotiation, manual bank inflow/payout, dispute pause, refund)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;
  let contractService!: ContractService;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('first-release.e2e');
    if (!reachable) return;
    await provisionDb(DB);
    await flushRedis();
    sms = new CapturingSmsProvider();
    app = await buildTestApp((b) => b.overrideProvider(SMS_PROVIDER).useValue(sms));
    db = freshDb();
    contractService = app.get(ContractService);
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    await app?.close();
    if (reachable) await dropDatabase(DB);
    fs.rmSync(tmpUploadDir, { recursive: true, force: true });
    for (const [key, val] of Object.entries(prevEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
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
    return createStaffSession(app!, db!, [
      'KYC',
      'CATEGORIES',
      'SERVICES',
      'ORDERS',
      'USERS',
      'PAYMENTS',
      'DISPUTES',
    ]);
  }

  async function seedJobAndProposals(): Promise<{
    staffToken: string;
    buyer: UserSession;
    sellerA: UserSession;
    sellerB: UserSession;
    jobId: string;
    proposalAId: string;
    proposalBId: string;
  }> {
    const staff = await fullStaff();
    const slug = `design-${uuidv7()}`;
    await createCategory(app!, staff.accessToken, slug);

    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const sellerA = await createApprovedSeller(app!, sms, staff.accessToken);
    const sellerB = await createApprovedSeller(app!, sms, staff.accessToken);

    const jobRes = await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        category: slug,
        title: 'Korporativ veb-sayt dizayni va frontendi',
        description: 'Kamida 5 sahifali zamonaviy sayt, mobil moslashuv va figma manba fayllari kerak.',
        budgetMin: 80_000,
        budgetMax: 200_000,
        deadline: futureIsoDate(30),
      })
      .expect(200);
    const jobId = jobRes.body.id as string;

    const propARes = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({
        bidAmount: 100_000,
        coverLetter: 'Barcha sahifalar uchun responsiv Figma va Next.js maket tayyorlayman.',
        estimatedDeliveryDays: 7,
      })
      .expect(200);

    const propBRes = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${jobId}/proposals`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({
        bidAmount: 120_000,
        coverLetter: 'Ikkinchi mutaxassis sifatida to‘liq brending bilan bajaraman.',
        estimatedDeliveryDays: 10,
      })
      .expect(200);

    return {
      staffToken: staff.accessToken,
      buyer,
      sellerA,
      sellerB,
      jobId,
      proposalAId: propARes.body.id as string,
      proposalBId: propBRes.body.id as string,
    };
  }

  t('100,000 -> 10,000 fee + 90,000 net -> manual bank receipt -> revision history -> masked destination -> 60,000 manual payout -> reject refund', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { staffToken, buyer, sellerA, sellerB, jobId, proposalAId, proposalBId } = await seedJobAndProposals();

    // Bank details config check
    const bankDetails = await request(app!.getHttpServer())
      .get('/api/v1/payments/bank-details')
      .expect(200);
    expect(bankDetails.body.configured).toBe(true);
    expect(bankDetails.body.details.accountNumber).toBe('20208000900000001234');

    // Hire Candidate A -> PENDING_SELLER; job stays OPEN & Candidate B stays intact
    const hireRes = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposalAId}/hire`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        deliverableSummary: 'Figma manba fayllari va responsive HTML/CSS to‘plami',
        acceptanceCriteria: 'Desktop va mobil ekranlarda xatosiz ochiladi, 3 marta tuzatish bepul',
        revisionsIncluded: 1,
        milestones: [{ title: 'To‘liq sayt dizayni', amount: 100_000, dueDate: futureIsoDate(14) }],
      })
      .expect(200);
    const contractId = hireRes.body.id as string;
    const milestoneId = (hireRes.body.milestones as { id: string }[])[0]!.id;

    expect(hireRes.body.status).toBe('PENDING_SELLER');
    expect(hireRes.body.agreedAmount).toBe(100_000);
    expect(hireRes.body.platformFeeRateBps).toBe(1000);
    expect(hireRes.body.platformFeeAmount).toBe(10_000);
    expect(hireRes.body.paymentPurposeCode).toMatch(/^BD-/);

    const jobWhileNegotiating = await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(jobWhileNegotiating.body.status).toBe('ochiq');

    // Concurrent hire for Candidate B while Candidate A is still PENDING_SELLER -> 409
    await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposalBId}/hire`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        milestones: [{ title: 'Zaxira bosqich', amount: 120_000, dueDate: futureIsoDate(14) }],
      })
      .expect(409);

    // Candidate A accepts -> ACTIVE, job CLOSED ('yopilgan'), Candidate B declined.
    const accepted = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    expect(accepted.body.status).toBe('ACTIVE');

    const jobAfterAccept = await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}`)
      .expect(200);
    expect(jobAfterAccept.body.status).toBe('yopilgan');

    const propBState = await request(app!.getHttpServer())
      .get(`/api/v1/jobs/proposals/${proposalBId}`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .expect(200);
    expect(propBState.body.status).toBe('rad_etilgan');

    // Buyer uploads bank receipt image (purpose=BANK_PROOF) and submits manual bank proof
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ).toString('base64');
    const uploadedReceipt = await request(app!.getHttpServer())
      .post('/api/v1/me/uploads')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        fileName: 'bank-chek.png',
        mimeType: 'image/png',
        dataBase64: tinyPng,
        purpose: 'BANK_PROOF',
        contractId,
      })
      .expect(200);
    expect(uploadedReceipt.body.url).toMatch(/^\/api\/v1\/uploads\//);

    // Proof stays PENDING_REVIEW -> contract is NOT funded yet
    const proofRes = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment/manual-proof`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        declaredAmount: 100_000,
        receiptFileUrl: uploadedReceipt.body.url,
        receiptNote: `To‘lov maqsadi: ${hireRes.body.paymentPurposeCode}`,
      })
      .expect(200);
    expect(proofRes.body.status).toBe('PENDING_REVIEW');

    // Privacy checks for BANK_PROOF file:
    // 1) Unauthenticated -> 401
    await request(app!.getHttpServer()).get(uploadedReceipt.body.url).expect(401);
    // 2) Same contract's specialist MUST NOT view buyer's private bank receipt -> 403
    await request(app!.getHttpServer())
      .get(uploadedReceipt.body.url)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(403);
    // 3) Stranger marketplace user -> 403
    await request(app!.getHttpServer())
      .get(uploadedReceipt.body.url)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .expect(403);
    // 4) Staff with only ORDERS permission (no PAYMENTS) -> 403
    const ordersOnlyStaff = await createStaffSession(app!, db!, ['ORDERS']);
    await request(app!.getHttpServer())
      .get(uploadedReceipt.body.url)
      .set('Authorization', `Bearer ${ordersOnlyStaff.accessToken}`)
      .expect(403);
    // 5) Genuine buyer & PAYMENTS staff succeed with private non-cacheable headers
    const buyerReceiptRes = await request(app!.getHttpServer())
      .get(uploadedReceipt.body.url)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(buyerReceiptRes.headers['cache-control']).toContain('no-store');
    expect(buyerReceiptRes.headers['cache-control']).toContain('private');
    expect(buyerReceiptRes.headers['cache-control']).not.toContain('public');

    const staffReceiptRes = await request(app!.getHttpServer())
      .get(uploadedReceipt.body.url)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(staffReceiptRes.headers['cache-control']).toContain('no-store');

    const buyerContractBeforeVerify = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contractId}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(buyerContractBeforeVerify.body.isFunded).toBe(false);

    // Partial/underpaid verification (80,000) -> flagged UNDERPAID, NOT funded!
    const underpaidRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payments/bank-proofs/${proofRes.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        receivedAmount: 80_000,
        bankOperationRef: 'BANK-IN-PARTIAL-001',
        note: '20 000 so‘m kam tushgan',
      })
      .expect(200);
    expect(underpaidRes.body.status).toBe('UNDERPAID');
    expect(underpaidRes.body.mismatchAmount).toBe(-20_000);

    const stillNotFunded = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contractId}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(stillNotFunded.body.isFunded).toBe(false);

    // Buyer uploads remaining proof -> staff verifies 100,000 with unique ref -> funded!
    const proof2Res = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment/manual-proof`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        declaredAmount: 100_000,
        receiptFileUrl: uploadedReceipt.body.url,
        receiptNote: 'To‘liq to‘lov cheki',
      })
      .expect(200);

    // Reusing BANK-IN-PARTIAL-001 must fail 409 DUPLICATE_BANK_REF
    const dupInRef = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payments/bank-proofs/${proof2Res.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        receivedAmount: 100_000,
        bankOperationRef: 'BANK-IN-PARTIAL-001',
      })
      .expect(409);
    expect(dupInRef.body.code).toBe('DUPLICATE_BANK_REF');

    const verifiedIn = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payments/bank-proofs/${proof2Res.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        receivedAmount: 100_000,
        bankOperationRef: 'BANK-IN-FULL-001',
        note: 'Bank ko‘chirmasida tasdiqlandi',
      })
      .expect(200);
    expect(verifiedIn.body.status).toBe('APPROVED');

    const fundedContract = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contractId}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(fundedContract.body.isFunded).toBe(true);

    // Balance while IN_PROGRESS -> pending (expected net) = 90,000, available = 0
    const pendingBalance = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    expect(pendingBalance.body.pending).toBe(90_000);
    expect(pendingBalance.body.available).toBe(0);

    // Empty work submission MUST fail with 422 EMPTY_DELIVERABLE
    const emptySubmit = await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({ message: '   ', deliverableUrls: [] })
      .expect(422);
    expect(emptySubmit.body.code).toBe('EMPTY_DELIVERABLE');

    // Specialist uploads work deliverable file & submits v1
    const deliverableUpload = await request(app!.getHttpServer())
      .post('/api/v1/me/uploads')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({
        fileName: 'sayt-maket-v1.pdf',
        mimeType: 'application/pdf',
        dataBase64: Buffer.from('%PDF-1.4\n%test deliverable v1\n').toString('base64'),
        purpose: 'DELIVERABLE',
        contractId,
        milestoneId,
      })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({
        message: '1-versiya maket va mobil ko‘rinish tayyorlandi.',
        deliverableUrls: [deliverableUpload.body.url],
      })
      .expect(200);

    // Deliverable file privacy:
    // - Unauthenticated -> 401
    // - Stranger (sellerB) -> 403
    // - PAYMENTS-only staff (without ORDERS/DISPUTES) -> 403
    // - Buyer, SellerA, and ORDERS staff -> 200 + private non-cacheable headers
    await request(app!.getHttpServer()).get(deliverableUpload.body.url).expect(401);
    await request(app!.getHttpServer())
      .get(deliverableUpload.body.url)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .expect(403);
    const paymentsOnlyStaff = await createStaffSession(app!, db!, ['PAYMENTS']);
    await request(app!.getHttpServer())
      .get(deliverableUpload.body.url)
      .set('Authorization', `Bearer ${paymentsOnlyStaff.accessToken}`)
      .expect(403);
    const buyerWorkRes = await request(app!.getHttpServer())
      .get(deliverableUpload.body.url)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(buyerWorkRes.headers['cache-control']).toContain('no-store');
    await request(app!.getHttpServer())
      .get(deliverableUpload.body.url)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

    // Unowned legacy orphan disk file stays private & is never deleted
    const orphanName = `${uuidv7()}.png`;
    fs.writeFileSync(path.join(tmpUploadDir, orphanName), Buffer.from(tinyPng, 'base64'));
    await request(app!.getHttpServer()).get(`/api/v1/uploads/${orphanName}`).expect(401);
    await request(app!.getHttpServer())
      .get(`/api/v1/uploads/${orphanName}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(403);
    await request(app!.getHttpServer())
      .get(`/api/v1/uploads/${orphanName}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
    expect(fs.existsSync(path.join(tmpUploadDir, orphanName))).toBe(true);

    // Buyer requests 1st revision (within revisionsIncluded: 1)
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/request-revision`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'Bosh sahifadagi tugma rangini kontrastliroq qiling' })
      .expect(200);

    // Specialist submits v2
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({
        message: '2-versiya: kontrast tuzatildi va havola yangilandi.',
        deliverableUrls: ['https://example.com/sayt-v2'],
      })
      .expect(200);

    // Buyer tries 2nd revision -> exceeds revisionsIncluded: 1 -> 409 REVISION_LIMIT_REACHED
    const revLimit = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/request-revision`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ reason: 'Yana qo‘shimcha o‘zgarish kerak edi' })
      .expect(409);
    expect(revLimit.body.code).toBe('REVISION_LIMIT_REACHED');

    // Buyer sees both v1 and v2 + revision history in contract detail (newest first)
    const buyerContractWithHistory = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contractId}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    const msDetail = buyerContractWithHistory.body.milestones[0];
    expect(msDetail.submissions).toHaveLength(2);
    expect(msDetail.submissions[0].deliverableUrls).toContain('https://example.com/sayt-v2');
    expect(msDetail.submissions[1].deliverableUrls).toContain(deliverableUpload.body.url);
    expect(msDetail.revisionRequests).toHaveLength(1);
    expect(msDetail.revisionCount).toBe(1);

    // Buyer approves -> COMPLETED once, 10% commission settled (90,000 available)
    const approved = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');

    // Duplicate approve returns ALREADY_SETTLED (409), not double settlement
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/milestones/${milestoneId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(409);

    const breakdownAfterSettle = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance/breakdown')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    expect(breakdownAfterSettle.body.summary).toMatchObject({
      grossEarned: 100_000,
      commissionWithheld: 10_000,
      netEarned: 90_000,
      available: 90_000,
      pending: 0,
      reserved: 0,
      paid: 0,
    });

    // Add masked Uzcard destination -> MUST start as PENDING_REVIEW (isVerified=false)
    const destRes = await request(app!.getHttpServer())
      .post('/api/v1/seller/payout-destinations')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({
        type: 'BANK_CARD',
        providerLabel: 'Uzcard',
        rawAccountOrCard: '8600123456789012',
        holderName: 'Dilshodbek Karimov',
        isDefault: true,
      })
      .expect(200);
    expect(destRes.body.maskedValue).toContain('9012');
    expect(destRes.body.maskedValue).not.toContain('12345678');
    expect(destRes.body.isVerified).toBe(false);
    expect(destRes.body.verificationStatus).toBe('PENDING_REVIEW');

    // Payout request against unverified recipient MUST fail 409 PAYOUT_DESTINATION_NOT_VERIFIED
    const unverifiedPayout = await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({ amount: 60_000, destinationId: destRes.body.id })
      .expect(409);
    expect(unverifiedPayout.body.code).toBe('PAYOUT_DESTINATION_NOT_VERIFIED');

    // Legacy record lacking independent staff proof cannot pass either
    await db!.sellerPayoutDestination.update({
      where: { id: destRes.body.id },
      data: { isVerified: true, verificationStatus: 'VERIFIED', verifiedByStaffId: null },
    });
    await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({ amount: 60_000, destinationId: destRes.body.id })
      .expect(409);
    await db!.sellerPayoutDestination.update({
      where: { id: destRes.body.id },
      data: { isVerified: false, verificationStatus: 'PENDING_REVIEW' },
    });

    // Authorized finance staff verifies recipient in bank cabinet & links bankRecipientId
    const verifiedDestRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payout-destinations/${destRes.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        verificationMethod: 'BANK_PORTAL_BENEFICIARY',
        bankRecipientId: 'CORP-REC-8801',
        verificationNote: 'Tashkilot bank kabinetida oluvchi sifatida tasdiqlandi va KYC bilan moslandi',
      })
      .expect(200);
    expect(verifiedDestRes.body.isVerified).toBe(true);
    expect(verifiedDestRes.body.verificationStatus).toBe('VERIFIED');
    expect(verifiedDestRes.body.bankRecipientId).toBe('CORP-REC-8801');

    // Verify audit log recorded staff verification WITHOUT storing full card digits
    const destAudit = await db!.auditLog.findFirst({
      where: { resourceId: destRes.body.id, action: 'PAYOUT_DESTINATION_VERIFIED' },
    });
    expect(destAudit).toBeTruthy();
    expect(JSON.stringify(destAudit)).not.toContain('8600123456789012');
    expect(JSON.stringify(destAudit)).toContain('CORP-REC-8801');

    // Specialist requests 60,000 manual payout on verified recipient -> zero external HTTP calls!
    const callsBeforePayout = fetchSpy.mock.calls.length;
    const payoutRes = await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({ amount: 60_000, destinationId: destRes.body.id })
      .expect(200);
    const payoutId = payoutRes.body.id as string;
    expect(fetchSpy.mock.calls.length).toBe(callsBeforePayout);
    expect(payoutRes.body.status).toBe('PENDING');
    expect(payoutRes.body.destinationReference).toContain('CORP-REC-8801');

    const balAfterRequest = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    expect(balAfterRequest.body).toMatchObject({
      available: 30_000,
      reserved: 60_000,
      paid: 0,
    });

    // Concurrent admin start-processing: exactly one 200, one 409!
    const [claim1, claim2] = await Promise.all([
      request(app!.getHttpServer())
        .post(`/api/v1/staff/payouts/${payoutId}/start-processing`)
        .set('Authorization', `Bearer ${staffToken}`),
      request(app!.getHttpServer())
        .post(`/api/v1/staff/payouts/${payoutId}/start-processing`)
        .set('Authorization', `Bearer ${staffToken}`),
    ]);
    expect([claim1.status, claim2.status].sort()).toEqual([200, 409]);

    // Wrong transferred amount fails with 422 PAYOUT_AMOUNT_MISMATCH
    const mismatchMark = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        bankOperationRef: 'PAYOUT-REF-60000',
        transferredAmount: 55_000,
      })
      .expect(422);
    expect(mismatchMark.body.code).toBe('PAYOUT_AMOUNT_MISMATCH');

    // Admin records real manual bank transfer of 60,000
    const paidRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payouts/${payoutId}/mark-paid`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        bankOperationRef: 'PAYOUT-REF-60000',
        transferredAmount: 60_000,
        bankTransferredAt: new Date().toISOString(),
        note: 'Kapitalbank orqali o‘tkazildi',
      })
      .expect(200);
    expect(paidRes.body.status).toBe('SUCCEEDED');

    const balAfterPaid = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    expect(balAfterPaid.body).toMatchObject({
      grossEarned: 100_000,
      commissionWithheld: 10_000,
      netEarned: 90_000,
      available: 30_000,
      reserved: 0,
      paid: 60_000,
    });

    // Admin can see specialist ledger report
    const specialistsReport = await request(app!.getHttpServer())
      .get('/api/v1/staff/payouts/specialists')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    const sellerRow = (specialistsReport.body as Array<Record<string, unknown>>).find(
      (r) => r.sellerId === sellerA.userId,
    );
    expect(sellerRow).toMatchObject({
      grossTotal: 100_000,
      commissionTotal: 10_000,
      netTotal: 90_000,
      paidTotal: 60_000,
      availableBalance: 30_000,
    });

    // Append-only payout correction updates reference while keeping audit trail
    const corrected = await request(app!.getHttpServer())
      .post(`/api/v1/staff/payouts/${payoutId}/correct`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        bankOperationRef: 'PAYOUT-REF-60000-CORR',
        reason: 'Bank kvitansiyadagi aniq raqamga moslashtirildi',
      })
      .expect(200);
    expect(corrected.body.bankOperationRef).toBe('PAYOUT-REF-60000-CORR');
    expect(corrected.body.corrections).toHaveLength(1);

    // Replacing destination requires re-verification while leaving prior 60,000 payout pointing at old verified recipient
    const replacedDest = await request(app!.getHttpServer())
      .patch(`/api/v1/seller/payout-destinations/${destRes.body.id}`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({
        type: 'BANK_CARD',
        providerLabel: 'Humo',
        rawAccountOrCard: '9860999988887777',
        holderName: 'Dilshodbek Karimov',
        isDefault: true,
      })
      .expect(200);
    expect(replacedDest.body.verificationStatus).toBe('PENDING_REVIEW');
    expect(replacedDest.body.isVerified).toBe(false);

    // Prior 60,000 payout STILL keeps the historical verified recipient (9012 / CORP-REC-8801)
    const historicalPayout = await request(app!.getHttpServer())
      .get(`/api/v1/staff/payouts/${payoutId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);
    expect(historicalPayout.body.destinationReference).toContain('9012');
    expect(historicalPayout.body.destinationReference).toContain('CORP-REC-8801');

    // Requesting 30,000 on unverified replacement fails until staff re-verifies
    await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({ amount: 30_000, destinationId: replacedDest.body.id })
      .expect(409);

    await request(app!.getHttpServer())
      .post(`/api/v1/staff/payout-destinations/${replacedDest.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        verificationMethod: 'BANK_DOCUMENT_AND_MICRO_TRANSFER',
        verificationEvidenceRef: 'MICRO-TX-7777',
        verificationNote: 'Almashtirilgan Humo karta mikro-o‘tkazma bilan tasdiqlandi',
      })
      .expect(200);

    // Remaining 30,000 requested then rejected -> reserved returns to available (30,000), paid stays 60,000
    const payout2 = await request(app!.getHttpServer())
      .post('/api/v1/seller/payouts')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({ amount: 30_000, destinationId: replacedDest.body.id })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/staff/payouts/${payout2.body.id}/reject`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'Qabul qiluvchi karta vaqtincha bloklangan' })
      .expect(200);

    const balAfterReject = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    expect(balAfterReject.body).toMatchObject({
      available: 30_000,
      reserved: 0,
      paid: 60_000,
    });

    fetchSpy.mockRestore();
  });

  t('Candidate A rejects PENDING_SELLER terms -> job stays OPEN & buyer falls back to Candidate B; legacy 500 bps contract keeps 5% fee', async () => {
    const { staffToken, buyer, sellerA, sellerB, jobId, proposalAId, proposalBId } = await seedJobAndProposals();

    // Hire A
    const hireA = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposalAId}/hire`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        milestones: [{ title: 'A bosqich', amount: 100_000, dueDate: futureIsoDate(10) }],
      })
      .expect(200);

    // Seller A rejects -> Job remains OPEN, Proposal B remains PENDING
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${hireA.body.id}/reject`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);

    const jobStillOpen = await request(app!.getHttpServer())
      .get(`/api/v1/jobs/${jobId}`)
      .expect(200);
    expect(jobStillOpen.body.status).toBe('ochiq');

    // Hire Candidate B succeeds cleanly!
    const hireB = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposalBId}/hire`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        milestones: [{ title: 'B bosqich', amount: 120_000, dueDate: futureIsoDate(12) }],
      })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${hireB.body.id}/accept`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .expect(200);

    // Backfill/verify legacy contract snapshot at 500 bps (5% -> 6,000 fee) settles at 5% instead of 10%
    await db!.contract.update({
      where: { id: hireB.body.id },
      data: {
        platformFeeRateBpsSnapshot: 500,
        platformFeeAmountSnapshot: 600_000n, // 6,000 so'm in tiyin (5% of 120,000)
      },
    });
    const proof = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${hireB.body.id}/payment/manual-proof`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ declaredAmount: 120_000, receiptNote: 'Legacy 5% check' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/payments/bank-proofs/${proof.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ receivedAmount: 120_000, bankOperationRef: `LEG-${uuidv7().slice(0, 8)}` })
      .expect(200);

    const msBId = (hireB.body.milestones as { id: string }[])[0]!.id;
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${hireB.body.id}/milestones/${msBId}/submit`)
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .send({ message: 'Legacy 5% ish topshirildi' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${hireB.body.id}/milestones/${msBId}/approve`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    const sellerBBalance = await request(app!.getHttpServer())
      .get('/api/v1/seller/balance')
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .expect(200);
    // 120,000 * 5% = 6,000 fee -> 114,000 net!
    expect(sellerBBalance.body).toMatchObject({
      grossEarned: 120_000,
      commissionWithheld: 6_000,
      netEarned: 114_000,
      available: 114_000,
    });
  });

  t('Open dispute pauses autoAcceptOverdueMilestones; cancelled funded contract supports manual bank refund confirmation', async () => {
    const { staffToken, buyer, sellerA, proposalAId } = await seedJobAndProposals();

    const hire = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${proposalAId}/hire`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        milestones: [{ title: 'Dispute va refund bosqichi', amount: 100_000, dueDate: futureIsoDate(10) }],
      })
      .expect(200);
    const contractId = hire.body.id as string;
    const milestoneId = (hire.body.milestones as { id: string }[])[0]!.id;

    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/accept`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);

    const proof = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/payment/manual-proof`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ declaredAmount: 100_000, receiptNote: 'Refund test payment' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/payments/bank-proofs/${proof.body.id}/verify`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ receivedAmount: 100_000, bankOperationRef: `FUND-REF-${uuidv7().slice(0, 8)}` })
      .expect(200);

    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contractId}/milestones/${milestoneId}/submit`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({ message: 'Topshirilgan natija havolasi', deliverableUrls: ['https://example.com/work'] })
      .expect(200);

    // Backdate submittedAt past 72h, then open dispute BEFORE running autoAcceptOverdueMilestones
    await db!.milestone.update({
      where: { id: milestoneId },
      data: { submittedAt: new Date(Date.now() - 100 * 3600_000) },
    });

    await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contractId}/disputes`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({
        reason: 'QUALITY',
        description: 'Sifati kelishilgan mezonga mos kelmayapti, nizo ochildi.',
      })
      .expect(200);

    const buyerDetailDisputed = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contractId}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(buyerDetailDisputed.body.milestones[0].autoAcceptPaused).toBe(true);
    expect(buyerDetailDisputed.body.milestones[0].reviewDeadline).toBeNull();

    const sweep = await contractService.autoAcceptOverdueMilestones();
    expect(sweep.approvedCount).toBe(0);
    expect(sweep.skippedDisputed).toBeGreaterThanOrEqual(1);

    // Close open dispute? Actually test manual bank refund on a fresh active funded contract cancelled/refunded by staff
    const staff2 = await fullStaff();
    const slug2 = `refund-${uuidv7()}`;
    await createCategory(app!, staff2.accessToken, slug2);
    const job2 = await request(app!.getHttpServer())
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        category: slug2,
        title: 'Qaytariladigan buyurtma e’loni',
        description: 'Bekor qilingandan keyin bank qaytaruvi tekshiriladi.',
        budgetMin: 100_000,
        budgetMax: 150_000,
      })
      .expect(200);
    const prop2 = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/${job2.body.id}/proposals`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .send({ bidAmount: 100_000, coverLetter: 'Qaytarish sinovi taklifi' })
      .expect(200);
    const contract2 = await request(app!.getHttpServer())
      .post(`/api/v1/jobs/proposals/${prop2.body.id}/hire`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        milestones: [{ title: 'Qaytariladigan bosqich', amount: 100_000, dueDate: futureIsoDate(10) }],
      })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/contracts/${contract2.body.id}/accept`)
      .set('Authorization', `Bearer ${sellerA.accessToken}`)
      .expect(200);
    const proofRefund = await request(app!.getHttpServer())
      .post(`/api/v1/me/contracts/${contract2.body.id}/payment/manual-proof`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ declaredAmount: 100_000, receiptNote: 'Bank orqali to‘lov' })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/payments/bank-proofs/${proofRefund.body.id}/verify`)
      .set('Authorization', `Bearer ${staff2.accessToken}`)
      .send({ receivedAmount: 100_000, bankOperationRef: `RF-IN-${uuidv7().slice(0, 8)}` })
      .expect(200);

    const refundCreated = await request(app!.getHttpServer())
      .post('/api/v1/staff/refunds')
      .set('Authorization', `Bearer ${staff2.accessToken}`)
      .set('Idempotency-Key', uuidv7())
      .send({
        contractId: contract2.body.id,
        reason: 'Tomonlar kelishuviga ko‘ra bekor qilindi',
      })
      .expect(200);
    expect(refundCreated.body.status).toBe('PROCESSING');

    const refundConfirmed = await request(app!.getHttpServer())
      .post(`/api/v1/staff/refunds/${refundCreated.body.id}/confirm-bank-return`)
      .set('Authorization', `Bearer ${staff2.accessToken}`)
      .send({
        bankOperationRef: `BANK-RET-${uuidv7().slice(0, 8)}`,
        note: 'Xaridorga bank orqali qaytarildi',
      })
      .expect(200);
    expect(refundConfirmed.body.status).toBe('SUCCEEDED');

    const contract2After = await request(app!.getHttpServer())
      .get(`/api/v1/me/contracts/${contract2.body.id}`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);
    expect(contract2After.body.status).toBe('CANCELLED');
  });
});
