import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { SellerEligibilityGuard } from '@/common/guards/seller-eligibility.guard';
import { AuditService } from '@/common/audit/audit.service';
import { IdempotencyService } from '@/common/idempotency/idempotency.service';
import { DomainError } from '@/common/errors/domain-error';
import { AppConfigService } from '@/config/app-config.service';
import type { Page } from '@/common/pagination/page-query.dto';
import { PayoutService } from './payout.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { PayoutResponseDto, toPayoutResponseDto } from './dto/payout-response.dto';
import { ListPayoutsQueryDto } from './dto/list-payouts-query.dto';
import { CREATE_PAYOUT_ENDPOINT, PAYOUT_CREATE_STALE_AFTER_MS } from './payout.constants';

/**
 * Sotuvchi o'z pulini chiqaradi. `AccountStatusGuard` (BLOCKED/SUSPENDED) —
 * kontrollerda; `SellerEligibilityGuard` (APPROVED) — FAQAT `create()`da
 * (`seller-service.controller.ts` bilan bir xil naqsh, bo'lim 27).
 */
@ApiBearerAuth()
@ApiTags('seller-payouts')
@Controller('seller/payouts')
@UseGuards(RolesGuard, AccountStatusGuard)
@Roles(Role.SELLER)
export class SellerPayoutController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  @UseGuards(SellerEligibilityGuard)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PayoutResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreatePayoutDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PayoutResponseDto> {
    // Bo'lim 48 — real payout rail hali tanlanmagan bo'lsa, feature
    // to'liq o'chirilgan: hech qanday DB yozuv/rezervatsiya URINILMAYDI
    // (mavjud hisob-kitob TEGILMAYDI), aniq xato darhol qaytadi.
    if (!this.config.payoutsEnabled) {
      throw new DomainError('FEATURE_DISABLED', 'Pul yechish (payout) hozircha o‘chirilgan');
    }
    if (!idempotencyKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header majburiy');
    }
    const actor = await this.audit.resolveUserActor(user.sub);
    const { body } = await this.idempotency.run(
      {
        key: idempotencyKey,
        userId: user.sub,
        endpoint: CREATE_PAYOUT_ENDPOINT,
        requestPayload: dto,
        staleAfterMs: PAYOUT_CREATE_STALE_AFTER_MS,
      },
      async () => {
        const payout = await this.payouts.create(
          user.sub,
          dto.amount,
          dto.destinationReference,
          actor,
          dto.destinationId,
        );
        return { statusCode: 200, body: toPayoutResponseDto(payout) };
      },
    );
    return body;
  }

  @Get()
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: ListPayoutsQueryDto,
  ): Promise<Page<PayoutResponseDto>> {
    const page = await this.payouts.listForSeller(user.sub, query.page ?? 1, query.perPage ?? 20, query.status);
    return { ...page, items: page.items.map(toPayoutResponseDto) };
  }

  @Get(':id')
  @ApiOkResponse({ type: PayoutResponseDto })
  async get(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string): Promise<PayoutResponseDto> {
    return toPayoutResponseDto(await this.payouts.getSellerOwnedOrThrow(id, user.sub));
  }
}
