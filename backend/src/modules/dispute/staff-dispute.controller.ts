import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { IdempotencyService } from '@/common/idempotency/idempotency.service';
import { DomainError } from '@/common/errors/domain-error';
import type { Page } from '@/common/pagination/page-query.dto';
import { DisputeService } from './dispute.service';
import { AddEvidenceDto } from './dto/add-evidence.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { RejectDisputeDto } from './dto/reject-dispute.dto';
import { StaffDisputeResponseDto, toStaffDisputeResponseDto } from './dto/dispute-response.dto';
import { DisputeEvidenceResponseDto, toDisputeEvidenceResponseDto } from './dto/dispute-evidence-response.dto';
import { DisputeEventResponseDto, toDisputeEventResponseDto } from './dto/dispute-event-response.dto';
import { StaffListDisputesQueryDto } from './dto/list-disputes-query.dto';
import { RESOLVE_DISPUTE_ENDPOINT, RESOLVE_DISPUTE_STALE_AFTER_MS } from './dispute.constants';

/**
 * Bo'lim 18/45 — mavjud `DISPUTES` huquqi qayta ishlatiladi (Bosqich 1'dan
 * bor, `01-data-model.md`da e'lon qilingan, hali ishlatilmagan edi) —
 * yangi granular permission qo'shilmadi.
 */
@Public()
@ApiBearerAuth()
@ApiTags('staff-disputes')
@Controller('staff/disputes')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('DISPUTES')
export class StaffDisputeController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() query: StaffListDisputesQueryDto): Promise<Page<StaffDisputeResponseDto>> {
    const page = await this.disputes.listForStaff(
      { status: query.status, contractId: query.contractId, buyerId: query.buyerId, sellerId: query.sellerId },
      query.page ?? 1,
      query.perPage ?? 20,
    );
    return { ...page, items: page.items.map(toStaffDisputeResponseDto) };
  }

  @Get(':id')
  @ApiOkResponse({ type: StaffDisputeResponseDto })
  async get(@Param('id') id: string): Promise<StaffDisputeResponseDto> {
    return toStaffDisputeResponseDto(await this.disputes.getByIdOrThrow(id));
  }

  @Get(':id/evidence')
  async listEvidence(@Param('id') id: string): Promise<DisputeEvidenceResponseDto[]> {
    return (await this.disputes.listEvidence(id)).map(toDisputeEvidenceResponseDto);
  }

  @Post(':id/evidence')
  @HttpCode(200)
  @ApiOkResponse({ type: DisputeEvidenceResponseDto })
  async addEvidence(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: AddEvidenceDto,
  ): Promise<DisputeEvidenceResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const evidence = await this.disputes.addEvidence(id, dto, { staffId: staff.sub }, actor);
    return toDisputeEvidenceResponseDto(evidence);
  }

  @Get(':id/events')
  async listEvents(@Param('id') id: string): Promise<DisputeEventResponseDto[]> {
    return (await this.disputes.listEvents(id)).map(toDisputeEventResponseDto);
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffDisputeResponseDto })
  async startReview(@CurrentStaff() staff: StaffAccessTokenPayload, @Param('id') id: string): Promise<StaffDisputeResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffDisputeResponseDto(await this.disputes.startReview(id, actor));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffDisputeResponseDto })
  async reject(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RejectDisputeDto,
  ): Promise<StaffDisputeResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffDisputeResponseDto(await this.disputes.reject(id, staff.sub, dto.resolutionReason, actor));
  }

  /** Bo'lim 34/35 — moliyaviy operatsiya, `Idempotency-Key` MAJBURIY. */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: StaffDisputeResponseDto })
  async resolve(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<StaffDisputeResponseDto> {
    if (!idempotencyKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header majburiy');
    }
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const { body } = await this.idempotency.run(
      {
        key: idempotencyKey,
        userId: staff.sub,
        endpoint: RESOLVE_DISPUTE_ENDPOINT,
        requestPayload: { id, ...dto },
        staleAfterMs: RESOLVE_DISPUTE_STALE_AFTER_MS,
      },
      async () => {
        const { dispute } = await this.disputes.resolve(
          id,
          staff.sub,
          dto.buyerAwardAmount,
          dto.sellerAwardAmount,
          dto.resolutionReason,
          actor,
          { buyerAwardAmountTiyin: dto.buyerAwardAmountTiyin, sellerAwardAmountTiyin: dto.sellerAwardAmountTiyin },
        );
        return { statusCode: 200, body: toStaffDisputeResponseDto(dispute) };
      },
    );
    return body;
  }
}
