import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { CapturingSmsProvider, createStaffSession, freshDb, loginNewUser } from './support/fixtures';

const DB = 'health_e2e';

describe('Admin Panel & User-Admin Integration Workflows (e2e)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('admin-workflow.e2e');
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

  // ── Scenario 1: User KYC Submission -> Admin Review & Approval -> User Status Updated ────

  t('User submits KYC -> Staff views in queue -> Approves -> User status becomes APPROVED', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    const admin = await createStaffSession(app!, db!, ['KYC', 'USERS'], 'OPERATIONS');

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(150).fill(0x01)]);
    const docDataUri1 = `data:image/png;base64,${pngHeader.toString('base64')}`;
    const docDataUri2 = `data:image/png;base64,${pngHeader.toString('base64')}`;

    // 1. User submits KYC
    const kycRes = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Alisher Navoiy',
        birthDate: '1990-01-01',
        passportNumber: 'AA9988776',
        inn: '123456789',
        documents: [docDataUri1, docDataUri2],
      })
      .expect(200);

    const verificationId = kycRes.body.id;
    expect(verificationId).toBeDefined();

    // 2. Staff views queue and inspects details
    const queueRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/kyc')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(queueRes.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: verificationId, userId: user.userId })]),
    );

    const detailRes = await request(app!.getHttpServer())
      .get(`/api/v1/staff/kyc/${verificationId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(detailRes.body.passportNumber).toBe('AA9988776');
    expect(detailRes.body.inn).toBe('123456789');

    // 3. Staff approves KYC
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/kyc/${verificationId}/review`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ outcome: 'approve', note: 'Hujjatlar toliq va tasdiqlandi' })
      .expect(200);

    // 4. User inspects their profile and sees APPROVED status
    const meRes = await request(app!.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);

    expect(meRes.body.sellerStatus).toBe('APPROVED');

    // Verify AuditLog was recorded
    const audit = await db!.auditLog.findFirst({
      where: { resourceId: verificationId, action: 'KYC_APPROVED' },
    });
    expect(audit).not.toBeNull();
  });

  // ── Scenario 2: Admin Blocks User -> Live Session Invalidation -> Reactivation ─────────────

  t('Admin blocks user -> existing user session fails writes with 403 ACCOUNT_BLOCKED -> Reactivated -> writes work', async () => {
    const user = await loginNewUser(app!, sms, 'BUYER');
    const admin = await createStaffSession(app!, db!, ['USERS'], 'OPERATIONS');

    // User can update profile initially
    await request(app!.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ fullName: 'Hurmatli Xaridor' })
      .expect(200);

    // Admin blocks user
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/users/${user.userId}/block`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Qoidalarni buzganlik uchun bloklandi' })
      .expect(200);

    // User attempts mutating write with their existing valid JWT
    const blockedRes = await request(app!.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ fullName: 'Buzgunchi' })
      .expect(403);

    expect(blockedRes.body.code).toBe('ACCOUNT_BLOCKED');

    // User can still read their own profile (per specification)
    const readRes = await request(app!.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(readRes.body.id).toBe(user.userId);

    // Admin reactivates user
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/users/${user.userId}/reactivate`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // User can write again immediately
    await request(app!.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ fullName: 'Qayta Faollashgan Xaridor' })
      .expect(200);
  });

  // ── Scenario 3: Service Moderation Lifecycle ───────────────────────────────────────────────

  t('Seller creates service -> Admin lists & approves -> Admin force-pauses service', async () => {
    const seller = await loginNewUser(app!, sms, 'SELLER');
    const admin = await createStaffSession(app!, db!, ['SERVICES', 'KYC', 'USERS'], 'OPERATIONS');

    // Directly set seller status in DB to APPROVED so they can create active services
    await db!.user.update({
      where: { id: seller.userId },
      data: { sellerStatus: 'APPROVED' },
    });

    const category = await db!.category.findFirst();
    expect(category).not.toBeNull();

    // Seller creates service
    const createServiceRes = await request(app!.getHttpServer())
      .post('/api/v1/seller/services')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        title: 'Professional Veb-sayt yaratish',
        description: 'Next.js va Tailwind CSS yordamida zamonaviy platforma tayyorlash.',
        categoryId: category!.id,
        price: 1_000_000,
        deliveryDays: 5,
      })
      .expect(200);

    const serviceId = createServiceRes.body.id;

    // Seller submits service for review
    await request(app!.getHttpServer())
      .post(`/api/v1/seller/services/${serviceId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);

    // Admin lists services queue
    const listRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/services')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(listRes.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: serviceId })]),
    );

    // Admin approves service
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/services/${serviceId}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    let svcInDb = await db!.service.findUnique({ where: { id: serviceId } });
    expect(svcInDb!.status).toBe('ACTIVE');

    // Admin force-pauses service
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/services/${serviceId}/force-pause`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ reason: 'Xizmat tavsifida noaniqlik bor' })
      .expect(200);

    svcInDb = await db!.service.findUnique({ where: { id: serviceId } });
    expect(svcInDb!.status).toBe('PAUSED');
  });

  // ── Scenario 4: SuperAdmin Staff Creation, RBAC Isolation, & Deactivation ─────────────────

  t('SuperAdmin creates staff -> Non-superadmin cannot create staff -> Deactivated staff token rejected', async () => {
    const superAdmin = await createStaffSession(app!, db!, ['STAFF'], 'SUPER_ADMIN');
    const opsStaff = await createStaffSession(app!, db!, ['USERS'], 'OPERATIONS');

    const email = `operator-${Date.now()}@bobololadono.uz`;

    // 1. Non-superadmin attempts to create staff -> 403 Forbidden
    await request(app!.getHttpServer())
      .post('/api/v1/staff/admin/staff-members')
      .set('Authorization', `Bearer ${opsStaff.accessToken}`)
      .send({
        email,
        fullName: 'Kichik Admin',
        title: 'Moderator',
        role: 'OPERATIONS',
        permissions: ['USERS'],
      })
      .expect(403);

    // 2. SuperAdmin creates staff member
    const createRes = await request(app!.getHttpServer())
      .post('/api/v1/staff/admin/staff-members')
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({
        email,
        fullName: 'Kichik Admin',
        title: 'Moderator',
        role: 'OPERATIONS',
        permissions: ['USERS', 'KYC'],
      })
      .expect(200);

    const newStaffId = createRes.body.id;
    const tempPassword = createRes.body.tempPassword;
    expect(tempPassword).toBeDefined();

    // 3. Newly created staff logs in with temporary password
    const loginRes = await request(app!.getHttpServer())
      .post('/api/v1/staff/auth/login')
      .send({ email, password: tempPassword })
      .expect(200);

    const newStaffToken = loginRes.body.accessToken;

    // 4. SuperAdmin disables the newly created staff member
    await request(app!.getHttpServer())
      .post(`/api/v1/staff/admin/staff-members/${newStaffId}/disable`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ reason: 'Vaqtincha toxtatildi' })
      .expect(200);

    // 5. Deactivated staff attempts to call an API with their active JWT
    const rejectedRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/me')
      .set('Authorization', `Bearer ${newStaffToken}`)
      .expect(403);

    expect(rejectedRes.body.code).toBe('ACCOUNT_BLOCKED');
  });

  // ── Scenario 5: Category Management Lifecycle ──────────────────────────────────────────────

  t('Staff creates new category -> Archives it -> Activates it', async () => {
    const admin = await createStaffSession(app!, db!, ['CATEGORIES'], 'OPERATIONS');
    const uniqueSlug = `cat-${Date.now()}`;

    // 1. Create category
    const createRes = await request(app!.getHttpServer())
      .post('/api/v1/staff/categories')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        slug: uniqueSlug,
        nameUz: 'Kiberxavfsizlik xizmatlari',
        nameRu: 'Услуги кибербезопасности',
        nameEn: 'Cybersecurity Services',
        sortOrder: 10,
      })
      .expect(200);

    const categoryId = createRes.body.id;
    expect(createRes.body.slug).toBe(uniqueSlug);

    // 2. Archive category
    const archiveRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/categories/${categoryId}/archive`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(archiveRes.body.status).toBe('ARCHIVED');

    // 3. Reactivate category
    const activateRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/categories/${categoryId}/activate`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(activateRes.body.status).toBe('ACTIVE');
  });
});
