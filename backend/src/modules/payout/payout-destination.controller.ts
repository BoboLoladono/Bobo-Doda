import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { AuditService } from '@/common/audit/audit.service';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import {
  CreatePayoutDestinationDto,
  PayoutDestinationResponseDto,
  toPayoutDestinationResponseDto,
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
          isVerified: true,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_DESTINATION_ADDED',
          resourceType: 'SELLER_PAYOUT_DESTINATION',
          resourceId: id,
          newState: { type: dto.type, providerLabel: dto.providerLabel.trim(), maskedValue },
        },
        tx,
      );
      return row;
    });

    return toPayoutDestinationResponseDto(created);
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
