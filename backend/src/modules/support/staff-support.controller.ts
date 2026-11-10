import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { SupportService } from './support.service';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { StaffReplyTicketDto } from './dto/staff-reply-ticket.dto';
import { StaffCloseTicketDto } from './dto/staff-close-ticket.dto';
import {
  SupportTicketResponseDto,
  toSupportTicketResponseDto,
} from './dto/support-ticket-response.dto';
import type { Page } from '@/common/pagination/page-query.dto';

@Public()
@ApiBearerAuth()
@ApiTags('staff-support')
@Controller('staff/tickets')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('SUPPORT')
export class StaffSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query() query: ListTicketsQueryDto,
  ): Promise<Page<SupportTicketResponseDto> & { facets: Record<string, number> }> {
    const res = await this.support.listForStaff(query);
    return {
      ...res,
      items: res.items.map(toSupportTicketResponseDto),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: SupportTicketResponseDto })
  async get(@Param('id') id: string): Promise<SupportTicketResponseDto> {
    const ticket = await this.support.getByIdOrThrow(id);
    return toSupportTicketResponseDto(ticket);
  }

  @Post(':id/reply')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportTicketResponseDto })
  async reply(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffReplyTicketDto,
  ): Promise<SupportTicketResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.support.replyAsStaff(id, dto.replyText, dto.newStatus, actor);
    return toSupportTicketResponseDto(updated);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportTicketResponseDto })
  async close(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffCloseTicketDto,
  ): Promise<SupportTicketResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.support.closeAsStaff(id, dto.note, actor);
    return toSupportTicketResponseDto(updated);
  }
}
