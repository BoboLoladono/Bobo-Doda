import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { BankTransferProofStatus } from '@prisma/client';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import type { Page } from '@/common/pagination/page-query.dto';
import { PaymentService } from './payment.service';
import { ManualBankPaymentService } from './manual-bank-payment.service';
import { StaffPaymentResponseDto, toStaffPaymentResponseDto } from './dto/payment-response.dto';
import { StaffListPaymentsQueryDto } from './dto/list-payments-query.dto';
import {
  BankTransferProofResponseDto,
  RejectBankProofDto,
  toBankTransferProofResponseDto,
  VerifyBankProofDto,
} from './dto/bank-proof.dto';

@Public()
@ApiBearerAuth()
@ApiTags('staff-payments')
@Controller('staff/payments')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('PAYMENTS')
export class StaffPaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly manualBank: ManualBankPaymentService,
    private readonly audit: AuditService,
  ) {}

  @Get('bank-proofs')
  async listBankProofs(
    @Query('status') status?: BankTransferProofStatus,
    @Query('contractId') contractId?: string,
    @Query('page') page?: number,
    @Query('perPage') perPage?: number,
  ): Promise<Page<BankTransferProofResponseDto>> {
    const res = await this.manualBank.listForStaff(
      { status, contractId },
      Number(page) || 1,
      Math.min(100, Number(perPage) || 20),
    );
    return { ...res, items: res.items.map(toBankTransferProofResponseDto) };
  }

  @Post('bank-proofs/:id/verify')
  @HttpCode(200)
  @ApiOkResponse({ type: BankTransferProofResponseDto })
  async verifyBankProof(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: VerifyBankProofDto,
  ): Promise<BankTransferProofResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.manualBank.verifyProof(id, staff.sub, dto, actor);
    return toBankTransferProofResponseDto(updated);
  }

  @Post('bank-proofs/:id/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: BankTransferProofResponseDto })
  async rejectBankProof(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RejectBankProofDto,
  ): Promise<BankTransferProofResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.manualBank.rejectProof(id, staff.sub, dto.reason, actor);
    return toBankTransferProofResponseDto(updated);
  }

  @Get()
  async list(@Query() query: StaffListPaymentsQueryDto): Promise<Page<StaffPaymentResponseDto>> {
    const page = await this.payments.listForStaff(
      { status: query.status, contractId: query.contractId, payerUserId: query.payerUserId, provider: query.provider },
      query.page ?? 1,
      query.perPage ?? 20,
    );
    return { ...page, items: page.items.map(toStaffPaymentResponseDto) };
  }

  @Get(':id')
  @ApiOkResponse({ type: StaffPaymentResponseDto })
  async get(@Param('id') id: string): Promise<StaffPaymentResponseDto> {
    return toStaffPaymentResponseDto(await this.payments.getByIdOrThrow(id));
  }
}
