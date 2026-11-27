import { Injectable, Logger } from '@nestjs/common';
import {
  UploadedFilePurpose,
  type Prisma,
  type StaffPermission,
  type StaffRole,
} from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from '@/config/app-config.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, NotFoundError, UnauthenticatedError } from '@/common/errors/domain-error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { TokenService } from '@/modules/auth/token.service';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES: Record<string, { ext: string; magic?: (buf: Buffer) => boolean }> = {
  'image/png': {
    ext: 'png',
    magic: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  'image/jpeg': {
    ext: 'jpg',
    magic: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/webp': {
    ext: 'webp',
    magic: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  'application/pdf': {
    ext: 'pdf',
    magic: (b) => b.length >= 4 && b.toString('ascii', 0, 4) === '%PDF',
  },
  'application/zip': {
    ext: 'zip',
    magic: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05),
  },
  'text/plain': {
    ext: 'txt',
    magic: (b) => !b.subarray(0, 512).includes(0x00),
  },
};

const SAFE_FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|pdf|zip|txt)$/;
const UPLOAD_PATH_EXTRACT_RE = /\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|webp|pdf|zip|txt))$/i;

export type DownloadCaller =
  | { kind: 'USER'; userId: string }
  | { kind: 'STAFF'; staffId: string; role: StaffRole; permissions: StaffPermission[] };

export function extractStoredUploadName(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const match = trimmed.match(UPLOAD_PATH_EXTRACT_RE);
  return match ? match[1]!.toLowerCase() : null;
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly ids: IdFactory,
  ) {}

  private getBaseDir(): string {
    return this.config.uploadDir?.trim() || path.join(process.cwd(), 'uploads');
  }

  async saveUploadedFile(
    input: {
      fileName: string;
      mimeType?: string;
      dataBase64: string;
      purpose?: UploadedFilePurpose;
      contractId?: string;
      milestoneId?: string;
    },
    uploaderUserId: string,
  ): Promise<{
    id: string;
    storedName: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    purpose: UploadedFilePurpose;
  }> {
    const purpose = input.purpose ?? UploadedFilePurpose.GENERAL;
    let resolvedContractId = input.contractId ?? null;
    const resolvedMilestoneId = input.milestoneId ?? null;

    if (resolvedMilestoneId) {
      const ms = await this.prisma.milestone.findUnique({
        where: { id: resolvedMilestoneId },
        include: { contract: { select: { id: true, buyerId: true, sellerId: true } } },
      });
      if (!ms) {
        throw new NotFoundError('Bosqich topilmadi', 'MILESTONE_NOT_FOUND');
      }
      if (resolvedContractId && ms.contractId !== resolvedContractId) {
        throw new DomainError('FORBIDDEN', 'Bosqich ko‘rsatilgan shartnomaga tegishli emas');
      }
      resolvedContractId = ms.contractId;
      if (ms.contract.sellerId !== uploaderUserId && ms.contract.buyerId !== uploaderUserId) {
        throw new DomainError('FORBIDDEN', 'Ushbu topshiriqqa fayl yuklash huquqingiz yo‘q');
      }
      if (purpose === UploadedFilePurpose.DELIVERABLE && ms.contract.sellerId !== uploaderUserId) {
        throw new DomainError('FORBIDDEN', 'Ish natijasini faqat shartnoma mutaxassisi yuklashi mumkin');
      }
    } else if (resolvedContractId) {
      const contract = await this.prisma.contract.findUnique({
        where: { id: resolvedContractId },
        select: { buyerId: true, sellerId: true },
      });
      if (!contract) {
        throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
      }
      if (purpose === UploadedFilePurpose.BANK_PROOF && contract.buyerId !== uploaderUserId) {
        throw new DomainError('FORBIDDEN', 'Bank chekini faqat buyurtma xaridori yuklashi mumkin');
      }
      if (purpose === UploadedFilePurpose.DELIVERABLE && contract.sellerId !== uploaderUserId) {
        throw new DomainError('FORBIDDEN', 'Ish natijasini faqat shartnoma mutaxassisi yuklashi mumkin');
      }
      if (contract.buyerId !== uploaderUserId && contract.sellerId !== uploaderUserId) {
        throw new DomainError('FORBIDDEN', 'Ushbu shartnomaga fayl yuklash huquqingiz yo‘q');
      }
    }

    let rawMime = input.mimeType?.trim().toLowerCase() ?? '';
    let base64 = input.dataBase64.trim();

    const dataUrlMatch = base64.match(/^data:([a-z0-9/+.-]+);base64,(.+)$/is);
    if (dataUrlMatch) {
      if (!rawMime) rawMime = dataUrlMatch[1]!.toLowerCase();
      base64 = dataUrlMatch[2]!;
    }

    if (rawMime === 'application/x-zip-compressed') {
      rawMime = 'application/zip';
    }
    const spec = ALLOWED_TYPES[rawMime];
    if (!spec) {
      throw new DomainError(
        'FILE_TYPE_NOT_ALLOWED',
        'Ruxsat etilgan fayl turlari: PNG, JPG, WEBP, PDF, ZIP, TXT',
      );
    }

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) {
      throw new DomainError('FILE_TOO_SMALL', "Bo'sh fayl yuklab bo'lmaydi");
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new DomainError('FILE_TOO_LARGE', 'Fayl hajmi 5 MB dan oshmasligi kerak');
    }
    if (spec.magic && !spec.magic(buffer)) {
      throw new DomainError('MIME_TYPE_MISMATCH', 'Fayl tarkibi ko‘rsatilgan formatga mos kelmadi');
    }

    const id = this.ids.next();
    const storedName = `${id}.${spec.ext}`;
    const safeOriginal =
      path.basename(input.fileName).replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || storedName;

    const dir = this.getBaseDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, storedName), buffer);

    try {
      await this.prisma.uploadedFile.create({
        data: {
          id,
          storedName,
          originalName: safeOriginal,
          mimeType: rawMime,
          sizeBytes: buffer.length,
          uploaderUserId,
          purpose,
          contractId: resolvedContractId,
          milestoneId: resolvedMilestoneId,
        },
      });
    } catch (err) {
      await fs.unlink(path.join(dir, storedName)).catch(() => undefined);
      throw err;
    }

    this.logger.debug(`Saved private upload ${storedName} (${buffer.length} bytes, purpose=${purpose})`);

    return {
      id,
      storedName,
      originalName: safeOriginal,
      mimeType: rawMime,
      size: buffer.length,
      url: `/api/v1/uploads/${storedName}`,
      purpose,
    };
  }

  /**
   * Buyurtmaga bank cheki biriktirilganda fayl egasini tekshiradi va faylni
   * `BANK_PROOF` + `contractId` + `bankProofId` ga bog‘laydi.
   */
  async attachBankProofUpload(
    tx: Prisma.TransactionClient,
    params: {
      receiptFileUrl: string | null;
      contractId: string;
      buyerId: string;
      bankProofId: string;
    },
  ): Promise<void> {
    const storedName = extractStoredUploadName(params.receiptFileUrl);
    if (!storedName) return;

    const record = await tx.uploadedFile.findUnique({ where: { storedName } });
    if (!record || (record.uploaderUserId && record.uploaderUserId !== params.buyerId)) {
      throw new DomainError('FORBIDDEN', 'Biriktirilgan chek fayliga ruxsat mavjud emas');
    }
    if (record.contractId && record.contractId !== params.contractId) {
      throw new DomainError('FORBIDDEN', 'Ushbu fayl boshqa buyurtmaga tegishli');
    }

    await tx.uploadedFile.update({
      where: { id: record.id },
      data: {
        purpose: UploadedFilePurpose.BANK_PROOF,
        contractId: params.contractId,
        bankProofId: params.bankProofId,
      },
    });
  }

  /**
   * Bosqich topshirig‘iga biriktirilgan mahalliy fayllarning egasini tekshiradi
   * va ularni `DELIVERABLE` + `contractId` + `milestoneId` ga bog‘laydi.
   */
  async attachDeliverableUploads(
    tx: Prisma.TransactionClient,
    params: {
      deliverableUrls: string[];
      contractId: string;
      milestoneId: string;
      sellerId: string;
    },
  ): Promise<void> {
    for (const url of params.deliverableUrls) {
      const storedName = extractStoredUploadName(url);
      if (!storedName) continue;

      const record = await tx.uploadedFile.findUnique({ where: { storedName } });
      if (!record || (record.uploaderUserId && record.uploaderUserId !== params.sellerId)) {
        throw new DomainError('FORBIDDEN', 'Biriktirilgan natija fayliga ruxsat mavjud emas');
      }
      if (record.contractId && record.contractId !== params.contractId) {
        throw new DomainError('FORBIDDEN', 'Ushbu fayl boshqa shartnomaga tegishli');
      }

      await tx.uploadedFile.update({
        where: { id: record.id },
        data: {
          purpose: UploadedFilePurpose.DELIVERABLE,
          contractId: params.contractId,
          milestoneId: params.milestoneId,
        },
      });
    }
  }

  async authenticateDownloadCaller(authorizationHeader: string | undefined): Promise<DownloadCaller> {
    const token = authorizationHeader?.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length).trim()
      : undefined;
    if (!token) {
      throw new UnauthenticatedError('Faylni yuklab olish uchun tizimga kiring', 'NO_SESSION');
    }

    // 1. Marketplace foydalanuvchi access tokeni
    try {
      const userPayload = this.tokens.verifyAccessToken(token);
      if (userPayload.sub && userPayload.familyId) {
        const session = await this.prisma.refreshToken.findFirst({
          where: {
            userId: userPayload.sub,
            familyId: userPayload.familyId,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
          select: { revokedAt: true },
        });
        if (!session || session.revokedAt) {
          throw new UnauthenticatedError('Sessiya tugagan', 'TOKEN_EXPIRED');
        }
        return { kind: 'USER', userId: userPayload.sub };
      }
    } catch (err) {
      if (err instanceof UnauthenticatedError && err.code === 'TOKEN_EXPIRED') {
        throw err;
      }
      // Staff tokeni sifatida tekshirishga o'tamiz
    }

    // 2. Staff (admin) access tokeni
    try {
      const staffPayload = this.tokens.verifyStaffAccessToken(token);
      if (staffPayload.sub) {
        const staff = await this.prisma.staffMember.findUnique({
          where: { id: staffPayload.sub },
          select: { id: true, status: true, role: true, permissions: true },
        });
        if (!staff || staff.status !== 'ACTIVE') {
          throw new UnauthenticatedError('Xodim sessiyasi faol emas', 'TOKEN_EXPIRED');
        }
        return {
          kind: 'STAFF',
          staffId: staff.id,
          role: staff.role,
          permissions: staff.permissions,
        };
      }
    } catch (err) {
      if (err instanceof UnauthenticatedError) throw err;
    }

    throw new UnauthenticatedError('Token yaroqsiz', 'UNAUTHENTICATED');
  }

  async readAuthorizedFile(
    storedName: string,
    caller: DownloadCaller,
  ): Promise<{ buffer: Buffer; mimeType: string; inline: boolean }> {
    if (!SAFE_FILENAME_RE.test(storedName)) {
      throw new NotFoundError('Fayl topilmadi', 'NOT_FOUND');
    }

    await this.assertCallerCanAccessStoredFile(storedName, caller);

    const rootDir = path.resolve(this.getBaseDir());
    let buffer: Buffer;
    try {
      const entries = await fs.readdir(rootDir);
      const matchedEntry = entries.find((entry) => entry === storedName);
      if (!matchedEntry) {
        throw new NotFoundError('Fayl topilmadi', 'NOT_FOUND');
      }
      const filePath = path.resolve(rootDir, matchedEntry);
      if (!filePath.startsWith(`${rootDir}${path.sep}`)) {
        throw new NotFoundError('Fayl topilmadi', 'NOT_FOUND');
      }
      buffer = await fs.readFile(filePath);
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      throw new NotFoundError('Fayl topilmadi', 'NOT_FOUND');
    }

    const ext = storedName.split('.').pop() ?? '';
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      webp: 'image/webp',
      pdf: 'application/pdf',
      zip: 'application/zip',
      txt: 'text/plain; charset=utf-8',
    };
    const inline = ext === 'png' || ext === 'jpg' || ext === 'webp';
    return { buffer, mimeType: mimeMap[ext] ?? 'application/octet-stream', inline };
  }

  private async assertCallerCanAccessStoredFile(storedName: string, caller: DownloadCaller): Promise<void> {
    const meta = await this.prisma.uploadedFile.findUnique({ where: { storedName } });

    // 1. Metadata yoki eski yozuvlardan kontextni aniqlaymiz (eski fayl o'chirilmaydi)
    let purpose: UploadedFilePurpose | null = meta?.purpose ?? null;
    let contractId: string | null = meta?.contractId ?? null;
    const uploaderUserId = meta?.uploaderUserId ?? null;

    if (!contractId || !purpose || purpose === UploadedFilePurpose.GENERAL) {
      const linkedProof = meta?.bankProofId
        ? await this.prisma.bankTransferProof.findUnique({
            where: { id: meta.bankProofId },
            select: { contractId: true, buyerId: true },
          })
        : await this.prisma.bankTransferProof.findFirst({
            where: { receiptFileUrl: { endsWith: `/uploads/${storedName}` } },
            select: { contractId: true, buyerId: true },
          });
      if (linkedProof) {
        purpose = UploadedFilePurpose.BANK_PROOF;
        contractId = linkedProof.contractId;
      } else if (!contractId) {
        const linkedSub = meta?.milestoneId
          ? await this.prisma.milestoneSubmission.findFirst({
              where: { milestoneId: meta.milestoneId },
              include: { milestone: { select: { contractId: true } } },
            })
          : await this.prisma.milestoneSubmission.findFirst({
              where: {
                OR: [
                  { deliverableUrls: { has: `/api/v1/uploads/${storedName}` } },
                  { deliverableUrls: { has: `/uploads/${storedName}` } },
                ],
              },
              include: { milestone: { select: { contractId: true } } },
            });
        if (linkedSub) {
          purpose = UploadedFilePurpose.DELIVERABLE;
          contractId = linkedSub.milestone.contractId;
        }
      }
    }

    // Egasi ham, bog'langan shartnomasi ham ishonchli aniqlanmagan eski/noma'lum fayl:
    // hech kimga ochilmaydi (fail closed, fayl saqlab qolinadi).
    if (!meta && !contractId) {
      throw new DomainError('FORBIDDEN', 'Fayl egasi aniqlanmagan — kirish rad etildi');
    }

    // 2. Bank cheki (BANK_PROOF): FAQAT buyurtma xaridori YOKI PAYMENTS ruxsatli xodim
    if (purpose === UploadedFilePurpose.BANK_PROOF) {
      if (caller.kind === 'STAFF') {
        if (caller.role === 'SUPER_ADMIN' || caller.permissions.includes('PAYMENTS')) {
          return;
        }
        throw new DomainError('FORBIDDEN', 'Bank cheklarini ko‘rish uchun PAYMENTS ruxsati kerak');
      }

      if (!contractId) {
        if (uploaderUserId && uploaderUserId === caller.userId) return;
        throw new DomainError('FORBIDDEN', 'Ushbu bank chekini ko‘rish huquqingiz yo‘q');
      }
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        select: { buyerId: true },
      });
      if (!contract || contract.buyerId !== caller.userId) {
        throw new DomainError('FORBIDDEN', 'Bank chekini faqat buyurtma xaridori va moliya operatori ko‘rishi mumkin');
      }
      return;
    }

    // 3. Topshirilgan ish natijasi (DELIVERABLE): FAQAT shu shartnoma xaridori/mutaxassisi YOKI ORDERS/DISPUTES ruxsatli xodim
    if (purpose === UploadedFilePurpose.DELIVERABLE) {
      if (caller.kind === 'STAFF') {
        if (
          caller.role === 'SUPER_ADMIN' ||
          caller.permissions.includes('ORDERS') ||
          caller.permissions.includes('DISPUTES')
        ) {
          return;
        }
        throw new DomainError('FORBIDDEN', 'Ish natijalarini ko‘rish uchun ORDERS yoki DISPUTES ruxsati kerak');
      }

      if (!contractId) {
        if (uploaderUserId && uploaderUserId === caller.userId) return;
        throw new DomainError('FORBIDDEN', 'Ushbu ish natijasini ko‘rish huquqingiz yo‘q');
      }
      const contract = await this.prisma.contract.findUnique({
        where: { id: contractId },
        select: { buyerId: true, sellerId: true },
      });
      if (!contract || (contract.buyerId !== caller.userId && contract.sellerId !== caller.userId)) {
        throw new DomainError('FORBIDDEN', 'Ushbu topshirilgan ish natijasini faqat shartnoma ishtirokchilari ko‘ra oladi');
      }
      return;
    }

    // 4. Hali shartnomaga/chekka bog'lanmagan shaxsiy yuklama (GENERAL): faqat yuklagan egasi
    if (caller.kind === 'USER' && uploaderUserId && uploaderUserId === caller.userId) {
      return;
    }

    throw new DomainError('FORBIDDEN', 'Ushbu faylni yuklab olish huquqingiz yo‘q');
  }
}
