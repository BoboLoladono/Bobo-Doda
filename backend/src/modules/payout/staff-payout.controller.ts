import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import type { Page } from '@/common/pagination/page-query.dto';
import { PayoutService } from './payout.service';
import {
  CorrectPayoutDto,
  MarkPayoutPaidDto,
  RejectPayoutDto,
  StaffPayoutResponseDto,
  toStaffPayoutResponseDto,
} from './dto/payout-response.dto';
import { StaffListPayoutsQueryDto } from './dto/list-payouts-query.dto';

@Public()
@ApiBearerAuth()
@ApiTags('staff-payouts')
@Controller('staff/payouts')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('PAYMENTS')
export class StaffPayoutController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() query: StaffListPayoutsQueryDto): Promise<Page<StaffPayoutResponseDto>> {
    const page = await this.payouts.listForStaff(
      { status: query.status, sellerId: query.sellerId },
      query.page ?? 1,
      query.perPage ?? 20,
    );
    return { ...page, items: page.items.map(toStaffPayoutResponseDto) };
  }

  @Get('specialists')
  async listSpecialistsSummary() {
    return this.payouts.listSpecialistsSummaryForStaff();
  }

  @Get(':id')
  @ApiOkResponse({ type: StaffPayoutResponseDto })
  async get(@Param('id') id: string): Promise<StaffPayoutResponseDto> {
    return toStaffPayoutResponseDto(await this.payouts.getByIdOrThrow(id));
  }

  @Post(':id/start-processing')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffPayoutResponseDto })
  async startProcessing(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<StaffPayoutResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffPayoutResponseDto(await this.payouts.startProcessing(id, staff.sub, actor));
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffPayoutResponseDto })
  async markPaid(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: MarkPayoutPaidDto,
  ): Promise<StaffPayoutResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffPayoutResponseDto(await this.payouts.markManualPaid(id, staff.sub, dto, actor));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffPayoutResponseDto })
  async reject(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: RejectPayoutDto,
  ): Promise<StaffPayoutResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffPayoutResponseDto(await this.payouts.rejectManual(id, staff.sub, dto.reason, actor));
  }

  @Post(':id/correct')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffPayoutResponseDto })
  async correct(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CorrectPayoutDto,
  ): Promise<StaffPayoutResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffPayoutResponseDto(await this.payouts.correctManualPaid(id, staff.sub, dto, actor));
  }
}
