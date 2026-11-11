import { KycDocumentStatus, KycDocumentType, KycVerificationStatus } from '@prisma/client';
import type { AuditService } from '@/common/audit/audit.service';
import type { OutboxService } from '@/common/outbox/outbox.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { KycService } from './kyc.service';
import { MockMalwareScanner } from './scanner/mock-malware.scanner';
import type { StorageProvider } from './storage/storage-provider.interface';

describe('KycService (Identity Verification & Document Processing)', () => {
  const validPngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(150).fill(0x01),
  ]);
  const docBase64_1 = `data:image/png;base64,${validPngHeader.toString('base64')}`;
  const docBase64_2 = `data:image/png;base64,${validPngHeader.toString('base64')}`;

  const mockStorage: StorageProvider = {
    putObject: jest.fn().mockResolvedValue(undefined),
    getObject: jest.fn().mockResolvedValue({
      buffer: validPngHeader,
      contentType: 'image/png',
      contentLength: validPngHeader.length,
    }),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    createSignedDownloadToken: jest.fn().mockReturnValue('mock-download-token'),
    verifySignedDownloadToken: jest.fn().mockReturnValue({ key: 'kyc/user-1/doc-1', valid: true }),
  };

  const mockScanner = new MockMalwareScanner();
  const mockAudit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const mockOutbox = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;

  const setup = () => {
    const tx = {
      kycVerification: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      kycDocument: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findFirst: jest.fn(),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
      sellerApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const db = {
      ...tx,
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };

    const mockConfig = { kycSubmissionEnabled: true } as unknown as AppConfigService;
    const service = new KycService(
      db as unknown as PrismaService,
      { next: () => 'generated-id' },
      mockAudit,
      mockOutbox,
      mockConfig,
      mockStorage,
      mockScanner,
    );

    return { service, tx };
  };

  it('throws FEATURE_DISABLED when kycSubmissionEnabled is false', async () => {
    const disabledConfig = { kycSubmissionEnabled: false } as unknown as AppConfigService;
    const { tx } = setup();
    const service = new KycService(
      tx as unknown as PrismaService,
      { next: () => 'id' },
      mockAudit,
      mockOutbox,
      disabledConfig,
      mockStorage,
      mockScanner,
    );

    await expect(
      service.submit(
        'user-1',
        { legalName: 'Ali Valiyev', birthDate: '1990-01-01', documentType: 'PASSPORT', documents: ['a', 'b'] } as unknown as SubmitKycDto,
        { role: 'USER', userId: 'user-1' } as unknown as AuditActor,
      ),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('rejects applicant younger than 18 years old', async () => {
    const { service } = setup();
    const today = new Date();
    const sixteenYearsAgo = new Date(today.getFullYear() - 16, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);

    await expect(
      service.submit(
        'user-1',
        {
          country: 'UZ',
          documentType: KycDocumentType.PASSPORT,
          legalName: 'Alisher Navoiy',
          birthDate: sixteenYearsAgo,
          documents: [docBase64_1, docBase64_2],
        },
        { id: 'user-1', type: 'USER', name: 'User' },
      ),
    ).rejects.toMatchObject({ code: 'UNDERAGE' });
  });

  it('rejects submission with fewer than 2 documents', async () => {
    const { service } = setup();
    await expect(
      service.submit(
        'user-1',
        {
          country: 'UZ',
          documentType: KycDocumentType.PASSPORT,
          legalName: 'Alisher Navoiy',
          birthDate: '1995-05-15',
          documents: [docBase64_1], // Only 1 doc
        },
        { id: 'user-1', type: 'USER', name: 'User' },
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENTS_REQUIRED' });
  });

  it('rejects submission with single-word legal name', async () => {
    const { service } = setup();
    await expect(
      service.submit(
        'user-1',
        {
          country: 'UZ',
          documentType: KycDocumentType.PASSPORT,
          legalName: 'Alisher', // Only 1 word
          birthDate: '1995-05-15',
          documents: [docBase64_1, docBase64_2],
        },
        { id: 'user-1', type: 'USER', name: 'User' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_LEGAL_NAME' });
  });

  it('fails closed and blocks submission if malware is detected in uploaded documents', async () => {
    const { service } = setup();
    const eicarDataUrl = `data:image/png;base64,${Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*').toString('base64')}`;

    await expect(
      service.submit(
        'user-1',
        {
          country: 'UZ',
          documentType: KycDocumentType.PASSPORT,
          legalName: 'Alisher Navoiy',
          birthDate: '1995-05-15',
          documents: [docBase64_1, eicarDataUrl],
        },
        { id: 'user-1', type: 'USER', name: 'User' },
      ),
    ).rejects.toThrow();

    // Storage putObject must NOT have been called for infected documents
    expect(mockStorage.putObject).not.toHaveBeenCalled();
  });

  it('successfully submits clean documents, encrypts sensitive data and enters UNDER_REVIEW state', async () => {
    const { service, tx } = setup();
    const mockCreated = {
      id: 'verif-1',
      userId: 'user-1',
      status: KycVerificationStatus.UNDER_REVIEW,
      country: 'UZ',
      documentType: 'PASSPORT',
      legalName: 'Alisher Navoiy',
      birthDate: new Date('1995-05-15'),
      encryptedPassportNumber: 'v1:mock:tag:cipher',
      encryptedInn: null,
      encryptedCompanyDetails: null,
      submittedAt: new Date(),
      reviewedAt: null,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      documents: [
        {
          id: 'doc-1',
          originalFilename: 'doc_1_passport',
          mimeType: 'image/png',
          fileSizeBytes: validPngHeader.length,
          status: KycDocumentStatus.CLEAN,
          createdAt: new Date(),
        },
        {
          id: 'doc-2',
          originalFilename: 'doc_2_passport',
          mimeType: 'image/png',
          fileSizeBytes: validPngHeader.length,
          status: KycDocumentStatus.CLEAN,
          createdAt: new Date(),
        },
      ],
    };

    tx.kycVerification.findUniqueOrThrow.mockResolvedValue(mockCreated);
    tx.kycVerification.upsert.mockResolvedValue(mockCreated);

    const result = await service.submit(
      'user-1',
      {
        country: 'UZ',
        documentType: KycDocumentType.PASSPORT,
        legalName: 'Alisher Navoiy',
        birthDate: '1995-05-15',
        passportNumber: 'AA1234567',
        documents: [docBase64_1, docBase64_2],
      },
      { id: 'user-1', type: 'USER', name: 'User' },
    );

    expect(result.status).toBe('korib_chiqilmoqda');
    expect(result.documents).toHaveLength(2);
    expect(tx.kycVerification.upsert).toHaveBeenCalled();
    expect(tx.kycDocument.createMany).toHaveBeenCalled();
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KYC_SUBMITTED' }),
      expect.anything(),
    );
  });

  it('staff approval marks user verified and approves seller application', async () => {
    const { service, tx } = setup();
    const record = {
      id: 'verif-1',
      userId: 'user-1',
      status: KycVerificationStatus.UNDER_REVIEW,
      country: 'UZ',
      documentType: 'PASSPORT',
      legalName: 'Alisher Navoiy',
      birthDate: new Date('1995-05-15'),
      documents: [],
    };
    tx.kycVerification.findFirst.mockResolvedValue(record);
    tx.kycVerification.update.mockResolvedValue({
      ...record,
      status: KycVerificationStatus.APPROVED,
    });

    const result = await service.review(
      'staff-1',
      'verif-1',
      { outcome: 'approve' },
      { id: 'staff-1', type: 'STAFF', name: 'Admin' },
    );

    expect(result.status).toBe('tasdiqlangan');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { verified: true },
    });
    expect(tx.sellerApplication.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: 'PENDING' } }),
    );
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KYC_APPROVED' }),
      expect.anything(),
    );
  });

  it('staff rejection records rejection reason and transitions status', async () => {
    const { service, tx } = setup();
    const record = {
      id: 'verif-1',
      userId: 'user-1',
      status: KycVerificationStatus.UNDER_REVIEW,
      country: 'UZ',
      documentType: 'PASSPORT',
      legalName: 'Alisher Navoiy',
      birthDate: new Date('1995-05-15'),
      documents: [],
    };
    tx.kycVerification.findFirst.mockResolvedValue(record);
    tx.kycVerification.update.mockResolvedValue({
      ...record,
      status: KycVerificationStatus.REJECTED,
      rejectionReason: 'Surat sifatsiz',
    });

    const result = await service.review(
      'staff-1',
      'verif-1',
      { outcome: 'reject', rejectionReason: 'Surat sifatsiz' },
      { id: 'staff-1', type: 'STAFF', name: 'Admin' },
    );

    expect(result.status).toBe('rad_etilgan');
    expect(result.rejectionReason).toBe('Surat sifatsiz');
    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'KYC_REJECTED' }),
      expect.anything(),
    );
  });
});
