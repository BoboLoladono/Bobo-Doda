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
import { RefundService } from './refund.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { StaffRefundResponseDto, toStaffRefundResponseDto } from './dto/refund-response.dto';
import { StaffListRefundsQueryDto } from './dto/list-refunds-query.dto';
import { ConfirmManualBankRefundDto } from '@/modules/payment/dto/bank-proof.dto';
import { CREATE_REFUND_ENDPOINT, REFUND_CREATE_STALE_AFTER_MS } from './refund.constants';

/**
 * Bo'lim 3/16 — refund FAQAT staff tomonidan boshlanadi (xavfsiz minimal
 * permission modeli — buyer arbitrary ACTIVE contract'ni o'zi refund qila
 * olmaydi). Mavjud `PAYMENTS` huquqi qayta ishlatildi (Bosqich 5/6 bilan
 * bir xil qaror — yangi permission qo'shilmadi).
 */
@Public()
@ApiBearerAuth()
@ApiTags('staff-refunds')
@Controller('staff/refunds')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('PAYMENTS')
export class StaffRefundController {
  constructor(
    private readonly refunds: RefundService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: StaffRefundResponseDto })
  async create(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Body() dto: CreateRefundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<StaffRefundResponseDto> {
    if (!idempotencyKey) {
      throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header majburiy');
    }
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const { body } = await this.idempotency.run(
      {
        key: idempotencyKey,
        userId: staff.sub,
        endpoint: CREATE_REFUND_ENDPOINT,
        requestPayload: dto,
        staleAfterMs: REFUND_CREATE_STALE_AFTER_MS,
      },
      async () => {
        const refund = await this.refunds.create(dto.contractId, staff.sub, dto.reason, actor);
        return { statusCode: 200, body: toStaffRefundResponseDto(refund) };
      },
    );
    return body;
  }

  @Get()
  async list(@Query() query: StaffListRefundsQueryDto): Promise<Page<StaffRefundResponseDto>> {
    const page = await this.refunds.listForStaff(
      { status: query.status, contractId: query.contractId, paymentId: query.paymentId },
      query.page ?? 1,
      query.perPage ?? 20,
    );
    return { ...page, items: page.items.map(toStaffRefundResponseDto) };
  }

  @Get(':id')
  @ApiOkResponse({ type: StaffRefundResponseDto })
  async get(@Param('id') id: string): Promise<StaffRefundResponseDto> {
    return toStaffRefundResponseDto(await this.refunds.getByIdOrThrow(id));
  }

  @Post(':id/confirm-bank-return')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffRefundResponseDto })
  async confirmManualBankReturn(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmManualBankRefundDto,
  ): Promise<StaffRefundResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.refunds.confirmManualBankReturn(id, staff.sub, dto, actor);
    return toStaffRefundResponseDto(updated);
  }
}
