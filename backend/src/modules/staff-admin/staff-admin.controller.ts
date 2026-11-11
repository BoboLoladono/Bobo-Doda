import { Body, Controller, Get, HttpCode, Param, Patch, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission, RequireRole } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { StaffAuthService } from '@/modules/staff-auth/staff-auth.service';
import type { Page } from '@/common/pagination/page-query.dto';
import { StaffAdminService } from './staff-admin.service';
import { CreateStaffMemberDto } from './dto/create-staff-member.dto';
import { CreateStaffMemberResponseDto, AdminPasswordResetResponseDto } from './dto/create-staff-member-response.dto';
import { UpdateStaffPermissionsDto } from './dto/update-staff-permissions.dto';
import { StaffStatusActionDto } from './dto/staff-status-action.dto';
import { ListStaffMembersQueryDto } from './dto/list-staff-members-query.dto';
import { StaffMemberResponseDto, toStaffMemberResponseDto } from './dto/staff-member-response.dto';

/**
 * Bo'lim 3/17/18 — `STAFF` huquqi (mavjud, ilgari ishlatilmagan
 * `StaffPermission`). Yaratish/ruxsat-o'zgartirish QO'SHIMCHA
 * `@RequireRole('SUPER_ADMIN')` talab qiladi (ADR-05'dagi "SETTINGS +
 * SUPER_ADMIN" naqshi bilan bir xil — yangi imkoniyat berish oddiy
 * moderatsiyadan yuqori ishonch talab qiladi).
 */
@Public()
@ApiBearerAuth()
@ApiTags('staff-admin')
@Controller('staff/admin/staff-members')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('STAFF')
export class StaffAdminController {
  constructor(
    private readonly staffAdmin: StaffAdminService,
    private readonly staffAuth: StaffAuthService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() query: ListStaffMembersQueryDto): Promise<Page<StaffMemberResponseDto>> {
    const page = await this.staffAdmin.listForStaff(
      {
        status: query.status,
        email: query.email,
        permission: query.permission,
        createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
        createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
      },
      query.page ?? 1,
      query.perPage ?? 20,
    );
    return { ...page, items: page.items.map(toStaffMemberResponseDto) };
  }

  @Get(':id')
  @ApiOkResponse({ type: StaffMemberResponseDto })
  async get(@Param('id') id: string): Promise<StaffMemberResponseDto> {
    return toStaffMemberResponseDto(await this.staffAdmin.getByIdOrThrow(id));
  }

  @Post()
  @HttpCode(200)
  @RequireRole('SUPER_ADMIN')
  @ApiOkResponse({ type: CreateStaffMemberResponseDto })
  async create(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Body() dto: CreateStaffMemberDto,
  ): Promise<CreateStaffMemberResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const { staff: created, tempPassword } = await this.staffAdmin.create(dto, actor);
    return { ...toStaffMemberResponseDto(created), tempPassword };
  }

  @Patch(':id/permissions')
  @RequireRole('SUPER_ADMIN')
  @ApiOkResponse({ type: StaffMemberResponseDto })
  async updatePermissions(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStaffPermissionsDto,
  ): Promise<StaffMemberResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffMemberResponseDto(await this.staffAdmin.updatePermissions(id, dto.permissions, actor));
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffMemberResponseDto })
  async suspend(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffStatusActionDto,
  ): Promise<StaffMemberResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffMemberResponseDto(await this.staffAdmin.suspend(id, dto.reason, actor));
  }

  @Post(':id/disable')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffMemberResponseDto })
  async disable(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffStatusActionDto,
  ): Promise<StaffMemberResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffMemberResponseDto(await this.staffAdmin.disable(id, dto.reason, actor));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ type: StaffMemberResponseDto })
  async reactivate(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<StaffMemberResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return toStaffMemberResponseDto(await this.staffAdmin.reactivate(id, actor));
  }

  @Delete(':id/sessions')
  @HttpCode(200)
  async revokeSessions(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    await this.staffAuth.adminRevokeSessions(id, actor);
    return { ok: true };
  }

  @Post(':id/totp/reset')
  @RequireRole('SUPER_ADMIN')
  @HttpCode(200)
  async resetTotp(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    await this.staffAuth.adminResetTotp(id, actor);
    return { ok: true };
  }

  @Post(':id/password-reset')
  @RequireRole('SUPER_ADMIN')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminPasswordResetResponseDto })
  async resetPassword(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<AdminPasswordResetResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const tempPassword = await this.staffAuth.adminResetPassword(id, actor);
    return { tempPassword };
  }
}
