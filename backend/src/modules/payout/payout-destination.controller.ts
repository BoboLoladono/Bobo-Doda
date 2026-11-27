import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PayoutDestinationVerificationStatus, Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload, StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { AuditService } from '@/common/audit/audit.service';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import {
  CreatePayoutDestinationDto,
  PayoutDestinationResponseDto,
  RejectPayoutDestinationDto,
  StaffListPayoutDestinationsQueryDto,
  StaffPayoutDestinationResponseDto,
  VerifyPayoutDestinationDto,
  toPayoutDestinationResponseDto,
  toStaffPayoutDestinationResponseDto,
} from './dto/payout-destination.dto';

function maskAccountOrCard(type: 'BANK_CARD' | 'BANK_ACCOUNT', raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (type === 'BANK_CARD') {
    if (digits.length !== 16) {
      throw new DomainError('INVALID_CARD', 'Karta raqami aniq 16 xonali bo‘lishi kerak');
    }
    return `${digits.slice(0, 4)} •••• •••• ${digits.slice(-4)}`;
  }
  if (digits.length < 10 || digits.length > 26) {
    throw new DomainError('INVALID_BANK_ACCOUNT', 'Bank hisob raqami 10 dan 26 tagacha raqam bo‘lishi kerak');
  }
  return `${digits.slice(0, 5)} •••• ${digits.slice(-4)}`;
}

@ApiBearerAuth()
@ApiTags('seller-payout-destinations')
@Controller('seller/payout-destinations')
@UseGuards(RolesGuard, AccountStatusGuard)
@Roles(Role.SELLER)
export class SellerPayoutDestinationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AccessTokenPayload): Promise<PayoutDestinationResponseDto[]> {
    const rows = await this.prisma.sellerPayoutDestination.findMany({
      where: { sellerId: user.sub, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toPayoutDestinationResponseDto);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: PayoutDestinationResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreatePayoutDestinationDto,
  ): Promise<PayoutDestinationResponseDto> {
    const maskedValue = maskAccountOrCard(dto.type, dto.rawAccountOrCard);
    const holderName = dto.holderName.trim();
    if (holderName.length < 3) {
      throw new DomainError('INVALID_HOLDER', 'Egasining to‘liq ism-familiyasini kiriting');
    }
    const actor = await this.audit.resolveUserActor(user.sub);
    const id = this.ids.next();

    const created = await this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.sellerPayoutDestination.count({
        where: { sellerId: user.sub, deletedAt: null },
      });
      if (existingCount >= 5) {
        throw new DomainError('CARD_LIMIT', 'Ko‘pi bilan 5 ta rekvizit saqlash mumkin');
      }
      const makeDefault = dto.isDefault ?? existingCount === 0;
      if (makeDefault) {
        await tx.sellerPayoutDestination.updateMany({
          where: { sellerId: user.sub, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }
      // Yangi qo'shilgan rekvizit DARHOL tasdiqlangan bo'lmaydi: moliya xodimi bank kabinetida
      // oluvchini tekshirib, bankRecipientId yoki tasdiq hujjatini bog'lagach VERIFIED bo'ladi.
      const row = await tx.sellerPayoutDestination.create({
        data: {
          id,
          sellerId: user.sub,
          type: dto.type,
          providerLabel: dto.providerLabel.trim(),
          maskedValue,
          holderName,
          bankName: dto.bankName?.trim() || null,
          mfo: dto.mfo?.trim() || null,
          isDefault: makeDefault,
          isVerified: false,
          verificationStatus: PayoutDestinationVerificationStatus.PENDING_REVIEW,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_DESTINATION_ADDED',
          resourceType: 'SELLER_PAYOUT_DESTINATION',
          resourceId: id,
          contextId: user.sub,
          newState: {
            type: dto.type,
            providerLabel: dto.providerLabel.trim(),
            maskedValue,
            verificationStatus: 'PENDING_REVIEW',
          },
        },
        tx,
      );
      return row;
    });

    return toPayoutDestinationResponseDto(created);
  }

  /**
   * Rekvizit almashtirilganda qayta tasdiqlash majburiy bo'ladi.
   * Oldingi payout so'rovlariga bog'langan manzil o'zgarib qolmasligi uchun
   * agar eski rekvizitga bog'langan Payout mavjud bo'lsa, u saqlanib qoladi (soft-delete)
   * va yangi tekshiruv yozuvi yaratiladi.
   */
  @Patch(':id')
  @HttpCode(200)
  @ApiOkResponse({ type: PayoutDestinationResponseDto })
  async replace(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreatePayoutDestinationDto,
  ): Promise<PayoutDestinationResponseDto> {
    const maskedValue = maskAccountOrCard(dto.type, dto.rawAccountOrCard);
    const holderName = dto.holderName.trim();
    if (holderName.length < 3) {
      throw new DomainError('INVALID_HOLDER', 'Egasining to‘liq ism-familiyasini kiriting');
    }
    const actor = await this.audit.resolveUserActor(user.sub);

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sellerPayoutDestination.findFirst({
        where: { id, sellerId: user.sub, deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Rekvizit topilmadi', 'PAYOUT_DESTINATION_NOT_FOUND');

      const linkedPayoutCount = await tx.payout.count({ where: { destinationId: id } });
      if (linkedPayoutCount > 0) {
        const newId = this.ids.next();
        await tx.sellerPayoutDestination.update({
          where: { id },
          data: { deletedAt: new Date(), isDefault: false },
        });
        const replacement = await tx.sellerPayoutDestination.create({
          data: {
            id: newId,
            sellerId: user.sub,
            type: dto.type,
            providerLabel: dto.providerLabel.trim(),
            maskedValue,
            holderName,
            bankName: dto.bankName?.trim() || null,
            mfo: dto.mfo?.trim() || null,
            isDefault: dto.isDefault ?? existing.isDefault,
            isVerified: false,
            verificationStatus: PayoutDestinationVerificationStatus.PENDING_REVIEW,
          },
        });
        await this.audit.record(
          {
            actor,
            action: 'PAYOUT_DESTINATION_REPLACED',
            resourceType: 'SELLER_PAYOUT_DESTINATION',
            resourceId: newId,
            contextId: user.sub,
            previousState: { previousDestinationId: id, maskedValue: existing.maskedValue },
            newState: { maskedValue, verificationStatus: 'PENDING_REVIEW' },
          },
          tx,
        );
        return replacement;
      }

      const reset = await tx.sellerPayoutDestination.update({
        where: { id },
        data: {
          type: dto.type,
          providerLabel: dto.providerLabel.trim(),
          maskedValue,
          holderName,
          bankName: dto.bankName?.trim() || null,
          mfo: dto.mfo?.trim() || null,
          isDefault: dto.isDefault ?? existing.isDefault,
          isVerified: false,
          verificationStatus: PayoutDestinationVerificationStatus.PENDING_REVIEW,
          bankRecipientId: null,
          verificationMethod: null,
          verificationEvidenceRef: null,
          verificationNote: null,
          rejectionReason: null,
          verifiedByStaffId: null,
          verifiedAt: null,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_DESTINATION_REPLACED',
          resourceType: 'SELLER_PAYOUT_DESTINATION',
          resourceId: id,
          contextId: user.sub,
          previousState: { maskedValue: existing.maskedValue, verificationStatus: existing.verificationStatus },
          newState: { maskedValue, verificationStatus: 'PENDING_REVIEW' },
        },
        tx,
      );
      return reset;
    });

    return toPayoutDestinationResponseDto(updated);
  }

  @Patch(':id/default')
  @HttpCode(200)
  @ApiOkResponse({ type: PayoutDestinationResponseDto })
  async setDefault(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<PayoutDestinationResponseDto> {
    const existing = await this.prisma.sellerPayoutDestination.findFirst({
      where: { id, sellerId: user.sub, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Rekvizit topilmadi', 'PAYOUT_DESTINATION_NOT_FOUND');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.sellerPayoutDestination.updateMany({
        where: { sellerId: user.sub, deletedAt: null },
        data: { isDefault: false },
      });
      return tx.sellerPayoutDestination.update({
        where: { id },
        data: { isDefault: true },
      });
    });
    return toPayoutDestinationResponseDto(updated);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    const existing = await this.prisma.sellerPayoutDestination.findFirst({
      where: { id, sellerId: user.sub, deletedAt: null },
    });
    if (!existing) throw new NotFoundError('Rekvizit topilmadi', 'PAYOUT_DESTINATION_NOT_FOUND');
    await this.prisma.sellerPayoutDestination.update({
      where: { id },
      data: { deletedAt: new Date(), isDefault: false },
    });
    return { deleted: true };
  }
}

@Public()
@ApiBearerAuth()
@ApiTags('staff-payout-destinations')
@Controller('staff/payout-destinations')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('PAYMENTS')
export class StaffPayoutDestinationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query() query: StaffListPayoutDestinationsQueryDto,
  ): Promise<Page<StaffPayoutDestinationResponseDto>> {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 20));
    const where = {
      deletedAt: null,
      ...(query.status ? { verificationStatus: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.sellerPayoutDestination.count({ where }),
      this.prisma.sellerPayoutDestination.findMany({
        where,
        include: { seller: { select: { fullName: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    return buildPage(rows.map(toStaffPayoutDestinationResponseDto), total, page, perPage);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffPayoutDestinationResponseDto })
  async verify(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: VerifyPayoutDestinationDto,
  ): Promise<StaffPayoutDestinationResponseDto> {
    const recipientId = dto.bankRecipientId?.trim() || null;
    const evidenceRef = dto.verificationEvidenceRef?.trim() || null;
    const note = dto.verificationNote.trim();

    if (dto.verificationMethod === 'BANK_PORTAL_BENEFICIARY' && !recipientId) {
      throw new DomainError(
        'INVALID_INPUT',
        'Tashkilot bank kabinetidagi oluvchi identifikatori (bankRecipientId) majburiy',
      );
    }
    if (dto.verificationMethod === 'BANK_DOCUMENT_AND_MICRO_TRANSFER' && !evidenceRef) {
      throw new DomainError(
        'INVALID_INPUT',
        'Bank ko‘chirmasi yoki mikro-o‘tkazma tasdiq hujjati raqami majburiy',
      );
    }

    const actor = await this.audit.resolveStaffActor(staff.sub);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM seller_payout_destinations WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.sellerPayoutDestination.findFirst({
        where: { id, deletedAt: null },
        include: { seller: { select: { fullName: true, phone: true } } },
      });
      if (!existing) {
        throw new NotFoundError('Rekvizit topilmadi', 'PAYOUT_DESTINATION_NOT_FOUND');
      }

      const row = await tx.sellerPayoutDestination.update({
        where: { id },
        data: {
          isVerified: true,
          verificationStatus: PayoutDestinationVerificationStatus.VERIFIED,
          verificationMethod: dto.verificationMethod,
          bankRecipientId: recipientId,
          verificationEvidenceRef: evidenceRef,
          verificationNote: note,
          rejectionReason: null,
          verifiedByStaffId: staff.sub,
          verifiedAt: now,
        },
        include: { seller: { select: { fullName: true, phone: true } } },
      });

      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_DESTINATION_VERIFIED',
          resourceType: 'SELLER_PAYOUT_DESTINATION',
          resourceId: id,
          contextId: row.sellerId,
          previousState: { verificationStatus: existing.verificationStatus, isVerified: existing.isVerified },
          newState: {
            verificationStatus: 'VERIFIED',
            isVerified: true,
            verificationMethod: dto.verificationMethod,
            bankRecipientId: recipientId,
            verificationEvidenceRef: evidenceRef,
            verificationNote: note,
            verifiedByStaffId: staff.sub,
            verifiedAt: now.toISOString(),
            maskedValue: row.maskedValue,
          },
        },
        tx,
      );
      return row;
    });

    return toStaffPayoutDestinationResponseDto(updated);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffPayoutDestinationResponseDto })
  async reject(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RejectPayoutDestinationDto,
  ): Promise<StaffPayoutDestinationResponseDto> {
    const reason = dto.reason.trim();
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM seller_payout_destinations WHERE id = ${id}::uuid FOR UPDATE`;
      const existing = await tx.sellerPayoutDestination.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) {
        throw new NotFoundError('Rekvizit topilmadi', 'PAYOUT_DESTINATION_NOT_FOUND');
      }

      const row = await tx.sellerPayoutDestination.update({
        where: { id },
        data: {
          isVerified: false,
          verificationStatus: PayoutDestinationVerificationStatus.REJECTED,
          rejectionReason: reason,
          verifiedByStaffId: staff.sub,
          verifiedAt: now,
        },
        include: { seller: { select: { fullName: true, phone: true } } },
      });

      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_DESTINATION_REJECTED',
          resourceType: 'SELLER_PAYOUT_DESTINATION',
          resourceId: id,
          contextId: row.sellerId,
          previousState: { verificationStatus: existing.verificationStatus },
          newState: {
            verificationStatus: 'REJECTED',
            rejectionReason: reason,
            verifiedByStaffId: staff.sub,
            verifiedAt: now.toISOString(),
          },
        },
        tx,
      );
      return row;
    });

    return toStaffPayoutDestinationResponseDto(updated);
  }
}
