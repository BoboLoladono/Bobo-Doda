import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { ReportService } from './report.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { StaffUpdateReportDto } from './dto/staff-update-report.dto';
import { ReportResponseDto, toReportResponseDto } from './dto/report-response.dto';
import type { Page } from '@/common/pagination/page-query.dto';

@Public()
@ApiBearerAuth()
@ApiTags('staff-reports')
@Controller('staff/reports')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('REPORTS')
export class StaffReportController {
  constructor(
    private readonly report: ReportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query() query: ListReportsQueryDto,
  ): Promise<Page<ReportResponseDto> & { facets: Record<string, number> }> {
    const res = await this.report.listForStaff(query);
    return {
      ...res,
      items: res.items.map(toReportResponseDto),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ReportResponseDto })
  async get(@Param('id') id: string): Promise<ReportResponseDto> {
    const report = await this.report.getByIdOrThrow(id);
    return toReportResponseDto(report);
  }

  @Post(':id/action')
  @HttpCode(200)
  @ApiOkResponse({ type: ReportResponseDto })
  async updateAction(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffUpdateReportDto,
  ): Promise<ReportResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.report.updateReportAsStaff(id, dto, actor);
    return toReportResponseDto(updated);
  }
}
