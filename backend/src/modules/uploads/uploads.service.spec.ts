import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { UploadedFilePurpose } from '@prisma/client';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import type { AppConfigService } from '@/config/app-config.service';
import type { IdFactory } from '@/common/id/id.factory';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { TokenService } from '@/modules/auth/token.service';
import { UploadsService } from './uploads.service';

describe('UploadsService (access control & path containment)', () => {
  const validPngName = '01930000-0000-7000-8000-000000000001.png';
  const validPdfName = '01930000-0000-7000-8000-000000000002.pdf';
  const orphanName = '01930000-0000-7000-8000-000000000003.png';

  let uploadDir: string;
  let prisma: {
    uploadedFile: { findUnique: jest.Mock };
    bankTransferProof: { findUnique: jest.Mock; findFirst: jest.Mock };
    milestoneSubmission: { findFirst: jest.Mock };
    contract: { findUnique: jest.Mock };
  };
  let service: UploadsService;

  beforeEach(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uploads-sec-'));
    await fs.writeFile(path.join(uploadDir, validPngName), Buffer.from('png-bytes'));
    await fs.writeFile(path.join(uploadDir, validPdfName), Buffer.from('%PDF-1.4\nwork'));
    await fs.writeFile(path.join(uploadDir, orphanName), Buffer.from('legacy-orphan'));

    prisma = {
      uploadedFile: { findUnique: jest.fn() },
      bankTransferProof: { findUnique: jest.fn(), findFirst: jest.fn() },
      milestoneSubmission: { findFirst: jest.fn() },
      contract: { findUnique: jest.fn() },
    };

    const config = { uploadDir } as unknown as AppConfigService;
    const tokens = {} as unknown as TokenService;
    const ids: IdFactory = { next: () => '01930000-0000-7000-8000-000000000099' };

    service = new UploadsService(
      prisma as unknown as PrismaService,
      tokens,
      config,
      ids,
    );
  });

  afterEach(async () => {
    await fs.rm(uploadDir, { recursive: true, force: true });
  });

  it('allows genuine buyer and PAYMENTS admin to read BANK_PROOF, denies stranger and seller', async () => {
    prisma.uploadedFile.findUnique.mockResolvedValue({
      storedName: validPngName,
      purpose: UploadedFilePurpose.BANK_PROOF,
      contractId: 'contract-1',
      bankProofId: 'proof-1',
      milestoneId: null,
      uploaderUserId: 'buyer-1',
    });
    prisma.contract.findUnique.mockResolvedValue({
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
    });

    const buyerFile = await service.readAuthorizedFile(validPngName, {
      kind: 'USER',
      userId: 'buyer-1',
    });
    expect(buyerFile.buffer.toString()).toBe('png-bytes');
    expect(buyerFile.mimeType).toBe('image/png');

    const paymentsAdminFile = await service.readAuthorizedFile(validPngName, {
      kind: 'STAFF',
      staffId: 'staff-pay',
      role: 'ADMIN',
      permissions: ['PAYMENTS'],
    });
    expect(paymentsAdminFile.buffer.toString()).toBe('png-bytes');

    await expect(
      service.readAuthorizedFile(validPngName, { kind: 'USER', userId: 'stranger-9' }),
    ).rejects.toThrow(DomainError);

    await expect(
      service.readAuthorizedFile(validPngName, { kind: 'USER', userId: 'seller-1' }),
    ).rejects.toThrow(DomainError);

    await expect(
      service.readAuthorizedFile(validPngName, {
        kind: 'STAFF',
        staffId: 'staff-orders',
        role: 'ADMIN',
        permissions: ['ORDERS'],
      }),
    ).rejects.toThrow(DomainError);
  });

  it('allows contract parties and ORDERS admin to read DELIVERABLE, denies stranger and PAYMENTS-only staff', async () => {
    prisma.uploadedFile.findUnique.mockResolvedValue({
      storedName: validPdfName,
      purpose: UploadedFilePurpose.DELIVERABLE,
      contractId: 'contract-1',
      bankProofId: null,
      milestoneId: 'ms-1',
      uploaderUserId: 'seller-1',
    });
    prisma.contract.findUnique.mockResolvedValue({
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
    });

    const buyerFile = await service.readAuthorizedFile(validPdfName, {
      kind: 'USER',
      userId: 'buyer-1',
    });
    expect(buyerFile.buffer.toString()).toBe('%PDF-1.4\nwork');

    const ordersAdminFile = await service.readAuthorizedFile(validPdfName, {
      kind: 'STAFF',
      staffId: 'staff-orders',
      role: 'ADMIN',
      permissions: ['ORDERS'],
    });
    expect(ordersAdminFile.buffer.toString()).toBe('%PDF-1.4\nwork');

    await expect(
      service.readAuthorizedFile(validPdfName, { kind: 'USER', userId: 'stranger-9' }),
    ).rejects.toThrow(DomainError);

    await expect(
      service.readAuthorizedFile(validPdfName, {
        kind: 'STAFF',
        staffId: 'staff-pay',
        role: 'ADMIN',
        permissions: ['PAYMENTS'],
      }),
    ).rejects.toThrow(DomainError);
  });

  it('rejects path traversal and keeps unowned legacy orphan files fail-closed on disk', async () => {
    await expect(
      service.readAuthorizedFile(`../${validPngName}`, { kind: 'USER', userId: 'buyer-1' }),
    ).rejects.toThrow(NotFoundError);

    await expect(
      service.readAuthorizedFile('not-a-uuid.png', { kind: 'USER', userId: 'buyer-1' }),
    ).rejects.toThrow(NotFoundError);

    prisma.uploadedFile.findUnique.mockResolvedValue(null);
    prisma.bankTransferProof.findFirst.mockResolvedValue(null);
    prisma.milestoneSubmission.findFirst.mockResolvedValue(null);

    await expect(
      service.readAuthorizedFile(orphanName, { kind: 'USER', userId: 'buyer-1' }),
    ).rejects.toThrow(DomainError);

    await expect(
      service.readAuthorizedFile(orphanName, {
        kind: 'STAFF',
        staffId: 'staff-super',
        role: 'SUPER_ADMIN',
        permissions: [],
      }),
    ).rejects.toThrow(DomainError);

    const stillExists = await fs.stat(path.join(uploadDir, orphanName));
    expect(stillExists.isFile()).toBe(true);
  });
});
