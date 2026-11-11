import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { AppealService } from './appeal.service';
import { ListAppealsQueryDto } from './dto/list-appeals-query.dto';
import { StaffDecideAppealDto } from './dto/staff-decide-appeal.dto';
import { AppealResponseDto, toAppealResponseDto } from './dto/appeal-response.dto';
import type { Page } from '@/common/pagination/page-query.dto';

@Public()
@ApiBearerAuth()
@ApiTags('staff-appeals')
@Controller('staff/appeals')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('APPEALS')
export class StaffAppealController {
  constructor(
    private readonly appeal: AppealService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query() query: ListAppealsQueryDto,
  ): Promise<Page<AppealResponseDto> & { facets: Record<string, number> }> {
    const res = await this.appeal.listForStaff(query);
    return {
      ...res,
      items: res.items.map(toAppealResponseDto),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: AppealResponseDto })
  async get(@Param('id') id: string): Promise<AppealResponseDto> {
    const appeal = await this.appeal.getByIdOrThrow(id);
    return toAppealResponseDto(appeal);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @ApiOkResponse({ type: AppealResponseDto })
  async decide(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffDecideAppealDto,
  ): Promise<AppealResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.appeal.decideAsStaff(id, dto, actor);
    return toAppealResponseDto(updated);
  }
}
