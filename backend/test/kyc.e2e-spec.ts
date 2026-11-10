import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { dropDatabase, flushRedis, provisionDb, requireInfraOrSkip } from './support/e2e-infra';
import { buildTestApp } from './support/build-app';
import { SMS_PROVIDER } from '@/infra/sms/sms-provider.interface';
import { CapturingSmsProvider, createStaffSession, freshDb, loginNewUser } from './support/fixtures';

const DB = 'health_e2e';

// Valid file buffers with authentic magic bytes
function createDummyJpeg(): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const body = Buffer.alloc(256, 0xaa);
  return Buffer.concat([header, body]);
}

function createDummyPng(): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(256, 0xbb);
  return Buffer.concat([header, body]);
}

function toBase64DataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

describe('Secure KYC Document Verification (e2e, isolated Postgres + Redis)', () => {
  let app: INestApplication | undefined;
  let reachable = false;
  let sms!: CapturingSmsProvider;
  let db: PrismaClient | undefined;

  beforeAll(async () => {
    reachable = await requireInfraOrSkip('kyc.e2e');
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

  const t = (name: string, fn: () => Promise<void>): void =>
    it(name, async () => {
      if (!reachable) return;
      await fn();
    });

  t('POST /kyc/submit — underage validation (<18 years old) rejected', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    const recentBirthDate = new Date();
    recentBirthDate.setFullYear(recentBirthDate.getFullYear() - 15);

    const res = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Alisher Navoiy',
        birthDate: recentBirthDate.toISOString().split('T')[0],
        passportNumber: 'AB1234567',
        documents: [
          toBase64DataUrl(createDummyJpeg(), 'image/jpeg'),
          toBase64DataUrl(createDummyPng(), 'image/png'),
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNDERAGE');
  });

  t('POST /kyc/submit — fewer than 2 documents rejected by ValidationPipe', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    const res = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Alisher Navoiy',
        birthDate: '1990-01-01',
        passportNumber: 'AB1234567',
        documents: [
          toBase64DataUrl(createDummyJpeg(), 'image/jpeg'),
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
  });

  t('POST /kyc/submit — spoofed MIME type / invalid magic bytes rejected', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    // Claim it is a JPEG, but contents are pure text over 200 bytes
    const spoofedContent = Buffer.alloc(256, 0x58);
    const res = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Alisher Navoiy',
        birthDate: '1990-01-01',
        passportNumber: 'AB1234567',
        documents: [
          toBase64DataUrl(spoofedContent, 'image/jpeg'),
          toBase64DataUrl(createDummyPng(), 'image/png'),
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_FILE_TYPE');
  });

  t('POST /kyc/submit — file below minimum size (<100B) rejected', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    const tinyBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x05, 0x00]); // tiny
    const res = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Alisher Navoiy',
        birthDate: '1990-01-01',
        passportNumber: 'AB1234567',
        documents: [
          toBase64DataUrl(tinyBuffer, 'image/jpeg'),
          toBase64DataUrl(createDummyPng(), 'image/png'),
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('FILE_TOO_SMALL');
  });

  t('POST /kyc/submit — malware payload (EICAR) fail-closed quarantine rejected', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    const eicarSignature = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const infectedJpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
      Buffer.from(eicarSignature),
      Buffer.alloc(100, 0x00),
    ]);

    const res = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Alisher Navoiy',
        birthDate: '1990-01-01',
        passportNumber: 'AB1234567',
        documents: [
          toBase64DataUrl(infectedJpeg, 'image/jpeg'),
          toBase64DataUrl(createDummyPng(), 'image/png'),
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INFECTED_DOCUMENT');
  });

  t('POST /kyc/submit — valid submission creates encrypted at-rest record & enters UNDER_REVIEW', async () => {
    const user = await loginNewUser(app!, sms, 'SELLER');
    const passportRaw = 'AA9876543';
    const innRaw = '123456789';

    const res = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Temur Malik',
        birthDate: '1988-04-09',
        passportNumber: passportRaw,
        inn: innRaw,
        documents: [
          toBase64DataUrl(createDummyJpeg(), 'image/jpeg'),
          toBase64DataUrl(createDummyPng(), 'image/png'),
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.rawStatus).toBe('UNDER_REVIEW');
    expect(res.body.status).toBe('korib_chiqilmoqda');
    expect(res.body.legalName).toBe('Temur Malik');
    // Passport must be masked in response
    expect(res.body.passportNumber).toBe('AA*****43');
    expect(res.body.documents).toHaveLength(2);

    // Verify DB encryption: PII must be encrypted at rest (starts with v1:)
    const verificationInDb = await db!.kycVerification.findFirst({
      where: { userId: user.userId },
      include: { documents: true },
    });
    expect(verificationInDb).not.toBeNull();
    expect(verificationInDb!.encryptedPassportNumber?.startsWith('v1:')).toBe(true);
    expect(verificationInDb!.encryptedPassportNumber).not.toContain(passportRaw);
    expect(verificationInDb!.encryptedInn?.startsWith('v1:')).toBe(true);
    expect(verificationInDb!.encryptedInn).not.toContain(innRaw);
    expect(verificationInDb!.passportNumberHash).toHaveLength(64); // SHA-256 hash

    // Verify Document status
    for (const doc of verificationInDb!.documents) {
      expect(doc.status).toBe('CLEAN');
      expect(doc.scannedAt).not.toBeNull();
      expect(doc.fileKey).toBeDefined();
    }

    // GET /kyc/me returns the masked verification
    const meRes = await request(app!.getHttpServer())
      .get('/api/v1/kyc/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(meRes.body.rawStatus).toBe('UNDER_REVIEW');
    expect(meRes.body.status).toBe('korib_chiqilmoqda');
    expect(meRes.body.passportNumber).toBe('AA*****43');
  });

  t('Staff review workflow: list queue, get details with signed token, stream decrypted file, approve KYC', async () => {
    // 1. Create seller and submit KYC
    const seller = await loginNewUser(app!, sms, 'SELLER');
    const jpegBuffer = createDummyJpeg();
    const pngBuffer = createDummyPng();

    const submitRes = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Jaloliddin Manguberdi',
        birthDate: '1992-08-15',
        passportNumber: 'AB7654321',
        documents: [
          toBase64DataUrl(jpegBuffer, 'image/jpeg'),
          toBase64DataUrl(pngBuffer, 'image/png'),
        ],
      })
      .expect(200);

    const verificationId = submitRes.body.id as string;

    // 2. Staff without KYC permission is rejected
    const generalStaff = await createStaffSession(app!, db!, ['SERVICES']);
    await request(app!.getHttpServer())
      .get('/api/v1/staff/kyc')
      .set('Authorization', `Bearer ${generalStaff.accessToken}`)
      .expect(403);

    // 3. Staff with KYC permission lists queue
    const kycStaff = await createStaffSession(app!, db!, ['KYC']);
    const queueRes = await request(app!.getHttpServer())
      .get('/api/v1/staff/kyc?status=UNDER_REVIEW')
      .set('Authorization', `Bearer ${kycStaff.accessToken}`)
      .expect(200);

    expect(queueRes.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: verificationId })]),
    );

    // 4. Staff fetches verification details (includes signed document URLs)
    const detailsRes = await request(app!.getHttpServer())
      .get(`/api/v1/staff/kyc/${verificationId}`)
      .set('Authorization', `Bearer ${kycStaff.accessToken}`)
      .expect(200);

    expect(detailsRes.body.legalName).toBe('Jaloliddin Manguberdi');
    expect(detailsRes.body.passportNumber).toBe('AB7654321'); // Decrypted for staff view
    expect(detailsRes.body.documents).toHaveLength(2);

    const firstDoc = detailsRes.body.documents[0];
    expect(firstDoc.viewUrl).toBeDefined();

    // 5. Stream document using the HMAC-signed URL token
    const tokenMatch = firstDoc.viewUrl.match(/token=([^&]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch[1];

    const streamRes = await request(app!.getHttpServer())
      .get(`/api/v1/kyc/documents/stream?token=${token}`)
      .expect(200);

    expect(streamRes.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(streamRes.body, jpegBuffer)).toBe(0);

    // 6. Tampered token is rejected with 401
    await request(app!.getHttpServer())
      .get(`/api/v1/kyc/documents/stream?token=${token.slice(0, -6)}tamper`)
      .expect(401);

    // 7. Staff approves KYC
    const reviewRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/kyc/${verificationId}/review`)
      .set('Authorization', `Bearer ${kycStaff.accessToken}`)
      .send({ outcome: 'approve', note: 'Documents verified and authentic' })
      .expect(200);

    expect(reviewRes.body.rawStatus).toBe('APPROVED');
    expect(reviewRes.body.status).toBe('tasdiqlangan');

    // 8. Assert user status updated to verified & approved
    const sellerUser = await db!.user.findUniqueOrThrow({ where: { id: seller.userId } });
    expect(sellerUser.verified).toBe(true);
    expect(sellerUser.sellerStatus).toBe('APPROVED');

    // 9. Seller cannot submit again once approved
    const duplicateSubmit = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Jaloliddin Manguberdi',
        birthDate: '1992-08-15',
        passportNumber: 'AB7654321',
        documents: [
          toBase64DataUrl(jpegBuffer, 'image/jpeg'),
          toBase64DataUrl(pngBuffer, 'image/png'),
        ],
      });
    expect(duplicateSubmit.status).toBe(409);
    expect(duplicateSubmit.body.code).toBe('ALREADY_APPROVED');
  });

  t('Staff review workflow: reject KYC with reason', async () => {
    const seller = await loginNewUser(app!, sms, 'SELLER');
    const submitRes = await request(app!.getHttpServer())
      .post('/api/v1/kyc/submit')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        country: 'UZ',
        documentType: 'PASSPORT',
        legalName: 'Noma’lum Shaxs',
        birthDate: '1995-05-20',
        passportNumber: 'AC1122334',
        documents: [
          toBase64DataUrl(createDummyJpeg(), 'image/jpeg'),
          toBase64DataUrl(createDummyPng(), 'image/png'),
        ],
      })
      .expect(200);

    const kycStaff = await createStaffSession(app!, db!, ['KYC']);
    const reviewRes = await request(app!.getHttpServer())
      .post(`/api/v1/staff/kyc/${submitRes.body.id}/review`)
      .set('Authorization', `Bearer ${kycStaff.accessToken}`)
      .send({ outcome: 'reject', rejectionReason: 'Rasm xira, qayta yuklang' })
      .expect(200);

    expect(reviewRes.body.rawStatus).toBe('REJECTED');
    expect(reviewRes.body.status).toBe('rad_etilgan');
    expect(reviewRes.body.rejectionReason).toBe('Rasm xira, qayta yuklang');
  });
});
