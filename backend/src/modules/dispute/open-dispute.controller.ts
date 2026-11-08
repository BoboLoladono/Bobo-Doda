import { Body, Controller, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { IdempotencyService } from '@/common/idempotency/idempotency.service';
import { DomainError } from '@/common/errors/domain-error';
import { DisputeService } from './dispute.service';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { DisputeResponseDto, toDisputeResponseDto } from './dto/dispute-response.dto';
import { OPEN_DISPUTE_ENDPOINT, OPEN_DISPUTE_STALE_AFTER_MS } from './dispute.constants';

/**
 * Bo'lim 5/44 — `POST /me/contracts/:contractId/disputes`: HAR IKKALA
 * ishtirokchi (buyer YOKI seller) ocha oladi (`@Roles(BUYER, SELLER)` —
 * `RolesGuard`da OR semantikasi). Egalik — `DisputeService.open()` ichida
 * query-scoped (bo'lim 5: existence leak yo'q).
 */
@ApiBearerAuth()
@ApiTags('me-disputes')
@Controller('me/contracts/:contractId/disputes')
@UseGuards(RolesGuard, AccountStatusGuard)
@Roles(Role.BUYER, Role.SELLER)
export class OpenDisputeController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: DisputeResponseDto })
  async open(
    @CurrentUser() user: AccessTokenPayload,
    @Param('contractId') contractId: string,
    @Body() dto: OpenDisputeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<DisputeResponseDto> {
    if (!idempotencyKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header majburiy');
    }
    const actor = await this.audit.resolveUserActor(user.sub);
    const { body } = await this.idempotency.run(
      {
        key: idempotencyKey,
        userId: user.sub,
        endpoint: OPEN_DISPUTE_ENDPOINT,
        requestPayload: { contractId, ...dto },
        staleAfterMs: OPEN_DISPUTE_STALE_AFTER_MS,
      },
      async () => {
        const dispute = await this.disputes.open(contractId, user.sub, dto.reason, dto.description, actor);
        return { statusCode: 200, body: toDisputeResponseDto(dispute) };
      },
    );
    return body;
  }
}
