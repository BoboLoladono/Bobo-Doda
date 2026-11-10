import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  KycDocumentStatus,
  KycVerificationStatus,
  Prisma,
  type KycVerification,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import { IdFactory } from '@/common/id/id.factory';
import { OutboxService } from '@/common/outbox/outbox.service';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { PrismaService } from '@/infra/prisma/prisma.service';
import type { StaffKycQueueQueryDto } from './dto/staff-kyc-queue-query.dto';
import type { StaffKycReviewDto } from './dto/staff-kyc-review.dto';
import type { SubmitKycDto } from './dto/submit-kyc.dto';
import {
  KycVerificationResponseDto,
  toKycResponseDto,
} from './dto/kyc-response.dto';
import type { MalwareScanner } from './scanner/malware-scanner.interface';
import type { StorageProvider, StoredObject } from './storage/storage-provider.interface';
import { parseBase64Document } from './util/file-magic-bytes.util';
import {
  decryptKycField,
  encryptKycField,
  hashIdentifier,
} from './util/kyc-cipher.util';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';
export const MALWARE_SCANNER = 'MALWARE_SCANNER';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  // ── Seller Operations ───────────────────────────────────────────────────

  async getMine(userId: string): Promise<KycVerificationResponseDto | null> {
    const record = await this.prisma.kycVerification.findUnique({
      where: { userId },
      include: { documents: true },
    });
    if (!record) {
      return null;
    }

    const decrypted = this.decryptFieldsSafely(record);
    return toKycResponseDto(record, decrypted, false);
  }

  async submit(
    userId: string,
    dto: SubmitKycDto,
    actor: AuditActor,
  ): Promise<KycVerificationResponseDto> {
    // 1. Legal Name validation (minimum 2 words)
    const words = dto.legalName.trim().split(/\s+/);
    if (words.length < 2) {
      throw new DomainError(
        'INVALID_LEGAL_NAME',
        'To‘liq ism va familiya (kamida 2 ta so‘z) kiritilishi shart',
      );
    }

    // 2. Age validation (18+ requirement)
    const birthDate = new Date(dto.birthDate);
    if (Number.isNaN(birthDate.getTime())) {
      throw new DomainError('INVALID_BIRTH_DATE', 'Tug‘ilgan sana noto‘g‘ri formatda');
    }
    const adultCutoff = new Date();
    adultCutoff.setFullYear(adultCutoff.getFullYear() - 18);
    if (birthDate > adultCutoff) {
      throw new DomainError(
        'UNDERAGE',
        'Foydalanuvchi kamida 18 yoshda bo‘lishi shart',
      );
    }

    // 3. Document count check
    if (!dto.documents || dto.documents.length < 2) {
      throw new DomainError(
        'DOCUMENTS_REQUIRED',
        'Kamida 2 ta hujjat fayli yuklanishi shart (masalan old va orqa tomoni)',
      );
    }

    // 4. Process and scan each document
    const processedDocs: Array<{
      id: string;
      fileKey: string;
      originalFilename: string;
      mimeType: string;
      fileSizeBytes: number;
      sha256Hash: string;
      buffer: Buffer;
    }> = [];

    for (let i = 0; i < dto.documents.length; i++) {
      const docRaw = dto.documents[i]!;
      const docId = this.ids.next();
      const filename = `doc_${i + 1}_${dto.documentType.toLowerCase()}`;

      // Magic byte verification & size bounds check
      const { buffer, mimeType } = parseBase64Document(docRaw);

      // Malware scan (FAIL CLOSED if scanner fails or virus detected)
      const scanResult = await this.scanner.scan(buffer, filename);
      if (!scanResult.clean) {
        this.logger.warn(`Malware detected in upload for user ${userId}: ${scanResult.threat}`);
        throw new DomainError(
          'INFECTED_DOCUMENT',
          `Yuklangan hujjatda xavfsizlik tekshiruvi shubhali fayl aniqladi: ${scanResult.threat || 'Malware'}`,
        );
      }

      const sha256Hash = createHash('sha256').update(buffer).digest('hex');
      const fileKey = `kyc/${userId}/${docId}`;

      processedDocs.push({
        id: docId,
        fileKey,
        originalFilename: filename,
        mimeType,
        fileSizeBytes: buffer.length,
        sha256Hash,
        buffer,
      });
    }

    // 5. Store documents in private encrypted storage
    for (const doc of processedDocs) {
      await this.storage.putObject(doc.fileKey, doc.buffer, doc.mimeType);
    }

    // 6. Encrypt sensitive identity data (AES-256-GCM)
    const encryptedPassportNumber = dto.passportNumber?.trim()
      ? encryptKycField(dto.passportNumber.trim())
      : null;
    const passportNumberHash = dto.passportNumber?.trim()
      ? hashIdentifier(dto.passportNumber.trim())
      : null;
    const encryptedInn = dto.inn?.trim() ? encryptKycField(dto.inn.trim()) : null;
    const encryptedCompanyDetails = dto.companyDetails?.trim()
      ? encryptKycField(dto.companyDetails.trim())
      : null;

    // 7. Atomic DB transaction
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.kycVerification.findUnique({
        where: { userId },
        include: { documents: true },
      });

      if (existing?.status === KycVerificationStatus.APPROVED) {
        throw new DomainError('ALREADY_APPROVED', 'Shaxsingiz allaqachon tasdiqlangan');
      }
      if (existing?.status === KycVerificationStatus.UNDER_REVIEW) {
        throw new DomainError('ALREADY_UNDER_REVIEW', 'Arizangiz ko‘rib chiqilmoqda');
      }

      const verificationId = existing?.id ?? this.ids.next();
      const now = new Date();

      // Clean up previous documents if resubmitting
      if (existing) {
        await tx.kycDocument.deleteMany({ where: { verificationId } });
      }

      await tx.kycVerification.upsert({
        where: { userId },
        create: {
          id: verificationId,
          userId,
          status: KycVerificationStatus.UNDER_REVIEW,
          country: dto.country.trim().toUpperCase(),
          documentType: dto.documentType,
          legalName: dto.legalName.trim(),
          birthDate,
          passportNumberHash,
          encryptedPassportNumber,
          encryptedInn,
          encryptedCompanyDetails,
          submittedAt: now,
        },
        update: {
          status: KycVerificationStatus.UNDER_REVIEW,
          country: dto.country.trim().toUpperCase(),
          documentType: dto.documentType,
          legalName: dto.legalName.trim(),
          birthDate,
          passportNumberHash,
          encryptedPassportNumber,
          encryptedInn,
          encryptedCompanyDetails,
          rejectionReason: null,
          staffNotes: null,
          submittedAt: now,
          reviewedAt: null,
          reviewedByStaffId: null,
        },
      });

      await tx.kycDocument.createMany({
        data: processedDocs.map((doc) => ({
          id: doc.id,
          verificationId,
          userId,
          fileKey: doc.fileKey,
          originalFilename: doc.originalFilename,
          mimeType: doc.mimeType,
          fileSizeBytes: doc.fileSizeBytes,
          sha256Hash: doc.sha256Hash,
          status: KycDocumentStatus.CLEAN,
          scannedAt: now,
        })),
      });

      // Audit log (NEVER logs plaintext passport/INN)
      await this.audit.record(
        {
          actor,
          action: 'KYC_SUBMITTED',
          resourceType: 'KYC_VERIFICATION',
          resourceId: verificationId,
          contextId: userId,
          newState: {
            country: dto.country,
            documentType: dto.documentType,
            legalName: dto.legalName,
            documentsCount: processedDocs.length,
          },
        },
        tx,
      );

      // Outbox event
      await this.outbox.enqueue(
        {
          aggregateType: 'KYC_VERIFICATION',
          aggregateId: verificationId,
          eventType: 'KYC_SUBMITTED',
          payload: { userId, documentType: dto.documentType },
        },
        tx,
      );

      return tx.kycVerification.findUniqueOrThrow({
        where: { id: verificationId },
        include: { documents: true },
      });
    });

    const decrypted = this.decryptFieldsSafely(saved);
    return toKycResponseDto(saved, decrypted, false);
  }

  // ── Staff Operations (Requires KYC Permission) ──────────────────────────

  async listQueue(
    query: StaffKycQueueQueryDto,
  ): Promise<Page<Record<string, unknown>> & { facets: Record<string, number> }> {
    const page = Math.max(query.page || 1, 1);
    const perPage = Math.min(Math.max(query.perPage || 10, 1), 100);

    const where: Prisma.KycVerificationWhereInput = {};

    if (query.status && query.status !== 'all') {
      if (query.status === 'korib_chiqilmoqda') {
        where.status = {
          in: [
            KycVerificationStatus.UNDER_REVIEW,
            KycVerificationStatus.PENDING,
            KycVerificationStatus.SCANNING,
          ],
        };
      } else if (query.status === 'tasdiqlangan') {
        where.status = KycVerificationStatus.APPROVED;
      } else if (query.status === 'rad_etilgan') {
        where.status = {
          in: [KycVerificationStatus.REJECTED, KycVerificationStatus.RESUBMISSION_REQUIRED],
        };
      }
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { legalName: { contains: term, mode: 'insensitive' } },
        { user: { fullName: { contains: term, mode: 'insensitive' } } },
        { user: { phone: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, items, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      this.prisma.kycVerification.count({ where }),
      this.prisma.kycVerification.findMany({
        where,
        include: {
          user: { select: { fullName: true, phone: true } },
          documents: true,
        },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.kycVerification.count({
        where: {
          status: {
            in: [
              KycVerificationStatus.UNDER_REVIEW,
              KycVerificationStatus.PENDING,
              KycVerificationStatus.SCANNING,
            ],
          },
        },
      }),
      this.prisma.kycVerification.count({
        where: { status: KycVerificationStatus.APPROVED },
      }),
      this.prisma.kycVerification.count({
        where: {
          status: {
            in: [KycVerificationStatus.REJECTED, KycVerificationStatus.RESUBMISSION_REQUIRED],
          },
        },
      }),
    ]);

    const formattedItems = items.map((item) => {
      const decrypted = this.decryptFieldsSafely(item);
      const dto = toKycResponseDto(item, decrypted, true);
      return {
        ...dto,
        userName: item.user.fullName ?? item.user.phone,
        userPhone: item.user.phone,
      };
    });

    const pageResult = buildPage(formattedItems, total, page, perPage);
    return {
      ...pageResult,
      facets: {
        _all: pendingCount + approvedCount + rejectedCount,
        korib_chiqilmoqda: pendingCount,
        tasdiqlangan: approvedCount,
        rad_etilgan: rejectedCount,
      },
    };
  }

  async getVerificationDetails(idOrUserId: string): Promise<Record<string, unknown>> {
    const record = await this.prisma.kycVerification.findFirst({
      where: {
        OR: [{ id: idOrUserId }, { userId: idOrUserId }],
      },
      include: {
        user: { select: { fullName: true, phone: true } },
        documents: true,
      },
    });

    if (!record) {
      throw new NotFoundError('Verifikatsiya arizasi topilmadi');
    }

    const decrypted = this.decryptFieldsSafely(record);
    const dto = toKycResponseDto(record, decrypted, true);

    // Attach signed view URLs for staff document inspection (5 min duration)
    const docsWithUrls = dto.documents.map((doc) => {
      const fullDoc = record.documents.find((d) => d.id === doc.id);
      const viewUrl = fullDoc ? this.createDocumentStreamUrl(fullDoc.fileKey) : undefined;
      return { ...doc, viewUrl };
    });

    return {
      ...dto,
      documents: docsWithUrls,
      userName: record.user.fullName ?? record.user.phone,
      userPhone: record.user.phone,
    };
  }

  async getStaffDocumentSignedUrl(
    staffId: string,
    verificationId: string,
    documentId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const doc = await this.prisma.kycDocument.findFirst({
      where: { id: documentId, verificationId },
    });
    if (!doc) {
      throw new NotFoundError('Hujjat topilmadi');
    }

    await this.audit.record({
      actor: { id: staffId, type: 'STAFF', name: 'KYC Reviewer' },
      action: 'KYC_DOCUMENT_ACCESSED',
      resourceType: 'KYC_DOCUMENT',
      resourceId: documentId,
      contextId: verificationId,
    });

    const expiresInSeconds = 300; // 5 minutes short-lived URL
    const url = this.createDocumentStreamUrl(doc.fileKey, expiresInSeconds);
    return { url, expiresInSeconds };
  }

  createDocumentStreamUrl(fileKey: string, expiresInSeconds = 300): string {
    const token = this.storage.createSignedDownloadToken(fileKey, expiresInSeconds);
    return `/api/v1/kyc/documents/stream?token=${encodeURIComponent(token)}`;
  }

  async streamDocumentWithToken(token: string): Promise<StoredObject> {
    const { key, valid } = this.storage.verifySignedDownloadToken(token);
    if (!valid || !key) {
      throw new DomainError('INVALID_TOKEN', 'Hujjatni ko‘rish uchun havola yaroqsiz yoki muddati o‘tgan');
    }
    return this.storage.getObject(key);
  }

  async review(
    staffId: string,
    verificationIdOrUserId: string,
    dto: StaffKycReviewDto,
    actor: AuditActor,
  ): Promise<KycVerificationResponseDto> {
    const record = await this.prisma.kycVerification.findFirst({
      where: {
        OR: [{ id: verificationIdOrUserId }, { userId: verificationIdOrUserId }],
      },
    });

    if (!record) {
      throw new NotFoundError('Verifikatsiya arizasi topilmadi');
    }

    const verificationId = record.id;
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      let nextStatus: KycVerificationStatus;
      let actionName: string;

      if (dto.outcome === 'approve') {
        nextStatus = KycVerificationStatus.APPROVED;
        actionName = 'KYC_APPROVED';
      } else if (dto.outcome === 'reject') {
        nextStatus = KycVerificationStatus.REJECTED;
        actionName = 'KYC_REJECTED';
      } else {
        nextStatus = KycVerificationStatus.RESUBMISSION_REQUIRED;
        actionName = 'KYC_RESUBMISSION_REQUIRED';
      }

      const updated = await tx.kycVerification.update({
        where: { id: verificationId },
        data: {
          status: nextStatus,
          reviewedAt: now,
          reviewedByStaffId: staffId,
          rejectionReason: dto.rejectionReason || null,
          staffNotes: dto.note || null,
        },
        include: { documents: true },
      });

      if (dto.outcome === 'approve') {
        // 1. Mark User verified
        await tx.user.update({
          where: { id: record.userId },
          data: { verified: true },
        });

        // 2. If seller application exists, approve it and activate seller status
        await tx.sellerApplication.updateMany({
          where: { userId: record.userId, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            reviewedAt: now,
            reviewedByStaffId: staffId,
          },
        });
        await tx.user.update({
          where: { id: record.userId },
          data: { sellerStatus: 'APPROVED' },
        });
      }

      // Audit Log
      await this.audit.record(
        {
          actor,
          action: actionName,
          resourceType: 'KYC_VERIFICATION',
          resourceId: verificationId,
          contextId: record.userId,
          previousState: { status: record.status },
          newState: {
            status: nextStatus,
            rejectionReason: dto.rejectionReason,
            note: dto.note,
          },
        },
        tx,
      );

      // Outbox Event
      await this.outbox.enqueue(
        {
          aggregateType: 'KYC_VERIFICATION',
          aggregateId: verificationId,
          eventType: actionName,
          payload: {
            userId: record.userId,
            outcome: dto.outcome,
            rejectionReason: dto.rejectionReason,
          },
        },
        tx,
      );

      return updated;
    });

    const decrypted = this.decryptFieldsSafely(result);
    return toKycResponseDto(result, decrypted, true);
  }

  // ── Helper: Safe Field Decryption ─────────────────────────────────────────

  private decryptFieldsSafely(
    verification: KycVerification,
  ): { passportNumber?: string; inn?: string; companyDetails?: string } {
    let passportNumber: string | undefined;
    let inn: string | undefined;
    let companyDetails: string | undefined;

    if (verification.encryptedPassportNumber) {
      try {
        passportNumber = decryptKycField(verification.encryptedPassportNumber);
      } catch (e) {
        this.logger.warn(`Failed to decrypt passport number for verification ${verification.id}: ${String(e)}`);
      }
    }

    if (verification.encryptedInn) {
      try {
        inn = decryptKycField(verification.encryptedInn);
      } catch (e) {
        this.logger.warn(`Failed to decrypt INN for verification ${verification.id}: ${String(e)}`);
      }
    }

    if (verification.encryptedCompanyDetails) {
      try {
        companyDetails = decryptKycField(verification.encryptedCompanyDetails);
      } catch (e) {
        this.logger.warn(`Failed to decrypt company details for verification ${verification.id}: ${String(e)}`);
      }
    }

    return { passportNumber, inn, companyDetails };
  }
}
