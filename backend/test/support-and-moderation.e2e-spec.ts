import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { CapturingSmsProvider, createStaffSession, freshDb, loginNewUser } from './support/fixtures';

const DB = 'health_e2e';

describe('Support, Reports, Appeals, and Reviews Operations (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('support-and-moderation.e2e');
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

  // ── Scenario 1: Support Ticket Lifecycle ───────────────────────────────────

  t('User creates ticket -> Staff views & replies -> User messages -> Staff closes', async () => {
    const user = await loginNewUser(app!, sms, 'BUYER');
    const staff = await createStaffSession(app!, db!, ['SUPPORT'], 'OPERATIONS');

    // 1. User submits ticket
    const createRes = await request(app!.getHttpServer())
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        topic: 'texnik',
        subject: 'Tizimga kirishda xatolik',
        message: 'SMS kod telefonimga kech kelmoqda, tekshirib bering.',
      })
      .expect(201);

    const ticketId = createRes.body.id;
    expect(ticketId).toBeDefined();
    expect(createRes.body.status).toBe('ochiq');

    // 2. Staff views tickets queue
    const listRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/tickets')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);

    expect(listRes.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ticketId, subject: 'Tizimga kirishda xatolik' })]),
    );

    // 3. Staff replies to ticket
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/reply`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({
        replyText: 'SMS provayder sozlamalari yangilandi. Qayta urinib ko‘ring.',
        newStatus: 'javob_berildi',
      })
      .expect(200);

    // 4. User views ticket conversation
    const userView = await request(app!.getHttpServer())
      .get(`/api/v1/support/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    expect(userView.body.status).toBe('javob_berildi');
    expect(userView.body.messages).toHaveLength(2);
    expect(userView.body.messages[1].isAdmin).toBe(true);

    // 5. User sends follow-up message
    await request(app!.getHttpServer())
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ text: 'Rahmat, endi kod darhol kelmoqda!' })
      .expect(201);

    // 6. Staff closes ticket
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/close`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ note: 'Foydalanuvchi muammosi hal bo‘ldi' })
      .expect(200);

    const closedCheck = await db!.supportTicket.findUnique({ where: { id: ticketId } });
    expect(closedCheck!.status).toBe('CLOSED');

    // 7. Verify AuditLog
    const replyAudit = await db!.auditLog.findFirst({
      where: { resourceId: ticketId, action: 'TICKET_REPLIED' },
    });
    expect(replyAudit).not.toBeNull();
  });

  // ── Scenario 2: Trust & Safety Report Lifecycle ────────────────────────────

  t('User files trust report -> Staff reviews & takes action -> Audit logged', async () => {
    const reporter = await loginNewUser(app!, sms, 'BUYER');
    const targetUser = await loginNewUser(app!, sms, 'SELLER');
    const staff = await createStaffSession(app!, db!, ['REPORTS'], 'OPERATIONS');

    // 1. User reports suspicious seller
    const reportRes = await request(app!.getHttpServer())
      .post('/api/v1/reports')
      .set('Authorization', `Bearer ${reporter.accessToken}`)
      .send({
        targetType: 'user',
        targetId: targetUser.userId,
        targetTitle: 'Shubhali sotuvchi profili',
        reasonType: 'off_platform',
        description: 'Foydalanuvchi to‘lovni platformadan tashqarida (karta orqali) qilishni talab qildi.',
        severity: 'high',
      })
      .expect(201);

    const reportId = reportRes.body.id;
    expect(reportId).toBeDefined();

    // 2. Staff views reports queue
    const queueRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/reports')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);

    expect(queueRes.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: reportId, reasonType: 'off_platform' })]),
    );

    // 3. Staff resolves report with action
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/reports/${reportId}/action`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({
        action: 'resolved',
        note: 'Sotuvchi tekshirildi va ogohlantirish berildi.',
        userAction: 'warned',
      })
      .expect(200);

    const updatedReport = await db!.trustReport.findUnique({ where: { id: reportId } });
    expect(updatedReport!.status).toBe('RESOLVED');
    expect(updatedReport!.actionTaken).toBe('WARNED');

    // 4. Verify AuditLog
    const audit = await db!.auditLog.findFirst({
      where: { resourceId: reportId, action: 'REPORT_REVIEWED' },
    });
    expect(audit).not.toBeNull();
  });

  // ── Scenario 3: User Appeal Lifecycle & Reactivation ───────────────────────

  t('Admin blocks user -> Blocked user appeals -> Staff accepts -> User reactivated', async () => {
    const user = await loginNewUser(app!, sms, 'BUYER');
    const adminOps = await createStaffSession(app!, db!, ['USERS'], 'OPERATIONS');
    const appealsStaff = await createStaffSession(app!, db!, ['APPEALS'], 'OPERATIONS');

    // 1. Admin blocks user
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/users/${user.userId}/block`)
      .set('Authorization', `Bearer ${adminOps.accessToken}`)
      .send({ reason: 'Shubhali faoliyat' })
      .expect(200);

    let dbUser = await db!.user.findUnique({ where: { id: user.userId } });
    expect(dbUser!.status).toBe('BLOCKED');

    // 2. Blocked user submits an appeal (allowed without AccountStatusGuard blocking them)
    const appealRes = await request(app!.getHttpServer())
      .post('/api/v1/appeals')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        restrictionType: 'blocked',
        originalReason: 'Shubhali faoliyat',
        appealText: 'Hisobim xatolik tufayli bloklangan, barcha to‘lovlar qonuniy.',
      })
      .expect(201);

    const appealId = appealRes.body.id;
    expect(appealId).toBeDefined();

    // 3. Staff reviews appeal in queue
    const queueRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/appeals')
      .set('Authorization', `Bearer ${appealsStaff.accessToken}`)
      .expect(200);

    expect(queueRes.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: appealId, restrictionType: 'blocked' })]),
    );

    // 4. Staff accepts appeal
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/appeals/${appealId}/decide`)
      .set('Authorization', `Bearer ${appealsStaff.accessToken}`)
      .send({
        decision: 'accepted',
        note: 'Foydalanuvchi shaxsi tasdiqlandi, blok bekor qilindi.',
      })
      .expect(200);

    // 5. User is reactivated in DB
    dbUser = await db!.user.findUnique({ where: { id: user.userId } });
    expect(dbUser!.status).toBe('ACTIVE');

    // 6. User write operations work again
    await request(app!.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ fullName: 'Tikланган Xaridor' })
      .expect(200);

    // 7. Verify AuditLog
    const audit = await db!.auditLog.findFirst({
      where: { resourceId: appealId, action: 'APPEAL_DECIDED' },
    });
    expect(audit).not.toBeNull();
  });

  // ── Scenario 4: Review Moderation Lifecycle ────────────────────────────────

  t('Buyer submits review on completed contract -> Public sees -> Staff hides review', async () => {
    const buyer = await loginNewUser(app!, sms, 'BUYER');
    const seller = await loginNewUser(app!, sms, 'SELLER');
    const staff = await createStaffSession(app!, db!, ['REVIEWS'], 'OPERATIONS');

    const category = await db!.category.findFirst();
    const serviceId = '019313b2-0000-7000-8000-000000000002';
    await db!.service.create({
      data: {
        id: serviceId,
        sellerId: seller.userId,
        categoryId: category!.id,
        title: 'Logo dizayn tayyorlash',
        description: 'Vektor formatdagi logo xizmati',
        price: 500_000n,
        deliveryDays: 3,
        status: 'ACTIVE',
      },
    });

    // Create completed contract fixture in DB
    const contractId = '019313b2-0000-7000-8000-000000000001';
    await db!.contract.create({
      data: {
        id: contractId,
        buyerId: buyer.userId,
        sellerId: seller.userId,
        sourceType: 'SERVICE',
        serviceId,
        serviceTitleSnapshot: 'Logo dizayn tayyorlash',
        serviceDescriptionSnapshot: 'Vektor formatdagi logo',
        categoryNameSnapshot: 'Dizayn',
        sellerDisplayNameSnapshot: 'Usta Dizayner',
        agreedAmount: 500_000n,
        currency: 'UZS',
        platformFeeRateBpsSnapshot: 500,
        platformFeeAmountSnapshot: 25_000n,
        deadline: new Date(Date.now() + 86400000),
        status: 'COMPLETED',
      },
    });

    // 1. Buyer submits review
    const reviewRes = await request(app!.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/review`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        rating: 5,
        comment: 'Mukammal bajarildi, tavsiya qilaman!',
      })
      .expect(201);

    const reviewId = reviewRes.body.id;
    expect(reviewId).toBeDefined();

    // 2. Duplicate review fails
    await request(app!.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/review`)
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ rating: 4, comment: 'Yana bitta sharh' })
      .expect(409);

    // 3. Public seller reviews endpoint shows review
    const publicReviews = await request(app!.getHttpServer())
      .get(`/api/v1/sellers/${seller.userId}/reviews`)
      .expect(200);

    expect(publicReviews.body.items).toHaveLength(1);
    expect(publicReviews.body.items[0].id).toBe(reviewId);

    // 4. Staff views reviews queue
    const staffReviews = await request(app!.getHttpServer())
      .get('/api/v1/staff/reviews')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .expect(200);

    expect(staffReviews.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: reviewId, rating: 5 })]),
    );

    // 5. Staff hides review
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/reviews/${reviewId}/hide`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ reason: 'Spam deb topildi' })
      .expect(200);

    // 6. Public endpoint no longer returns hidden review
    const publicAfterHide = await request(app!.getHttpServer())
      .get(`/api/v1/sellers/${seller.userId}/reviews`)
      .expect(200);

    expect(publicAfterHide.body.items).toHaveLength(0);

    // 7. Verify AuditLog
    const audit = await db!.auditLog.findFirst({
      where: { resourceId: reviewId, action: 'REVIEW_HIDDEN' },
    });
    expect(audit).not.toBeNull();
  });

  // ── Scenario 5: RBAC Isolation & Permission Boundaries ─────────────────────

  t('Staff without specific permissions receives 403 on protected admin queues', async () => {
    const opsStaffOnlyUsers = await createStaffSession(app!, db!, ['USERS'], 'OPERATIONS');

    // Attempt to access support queue -> 403
    await request(app!.getHttpServer())
      .get('/api/v1/staff/tickets')
      .set('Authorization', `Bearer ${opsStaffOnlyUsers.accessToken}`)
      .expect(403);

    // Attempt to access reports queue -> 403
    await request(app!.getHttpServer())
      .get('/api/v1/staff/reports')
      .set('Authorization', `Bearer ${opsStaffOnlyUsers.accessToken}`)
      .expect(403);

    // Attempt to access appeals queue -> 403
    await request(app!.getHttpServer())
      .get('/api/v1/staff/appeals')
      .set('Authorization', `Bearer ${opsStaffOnlyUsers.accessToken}`)
      .expect(403);

    // Attempt to access reviews queue -> 403
    await request(app!.getHttpServer())
      .get('/api/v1/staff/reviews')
      .set('Authorization', `Bearer ${opsStaffOnlyUsers.accessToken}`)
      .expect(403);
  });
});
