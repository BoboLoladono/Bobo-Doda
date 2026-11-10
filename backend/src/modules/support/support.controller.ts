import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { TokenService } from '@/modules/auth/token.service';
import { PageQueryDto, type Page } from '@/common/pagination/page-query.dto';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { CreateTicketMessageDto } from './dto/create-ticket-message.dto';
import {
  SupportTicketResponseDto,
  TicketMessageResponseDto,
  toSupportTicketResponseDto,
} from './dto/support-ticket-response.dto';

@ApiTags('support')
@Controller('support/tickets')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post()
  @ApiOkResponse({ type: SupportTicketResponseDto })
  async create(
    @Req() req: Request,
    @CurrentUser() user: AccessTokenPayload | null | undefined,
    @Body() dto: CreateSupportTicketDto,
  ): Promise<SupportTicketResponseDto> {
    let resolvedUserId: string | null = user?.sub ?? null;
    if (!resolvedUserId) {
      const header = req.headers?.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      if (token) {
        try {
          const payload = this.tokens.verifyAccessToken(token);
          if (payload?.sub) {
            resolvedUserId = payload.sub;
          }
        } catch {
          // Public endpoint: invalid token ignored
        }
      }
    }
    const ticket = await this.support.createTicket(resolvedUserId, dto);
    return toSupportTicketResponseDto(ticket);
  }

  @ApiBearerAuth()
  @Get('mine')
  async listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query() query: PageQueryDto,
  ): Promise<Page<SupportTicketResponseDto>> {
    const page = await this.support.listMine(user.sub, query.page ?? 1, query.perPage ?? 20);
    return { ...page, items: page.items.map(toSupportTicketResponseDto) };
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOkResponse({ type: SupportTicketResponseDto })
  async get(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<SupportTicketResponseDto> {
    const ticket = await this.support.getByIdOrThrow(id, user.sub);
    return toSupportTicketResponseDto(ticket);
  }

  @ApiBearerAuth()
  @Post(':id/messages')
  @ApiOkResponse({ type: TicketMessageResponseDto })
  async addMessage(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateTicketMessageDto,
  ): Promise<TicketMessageResponseDto> {
    const ticket = await this.support.getByIdOrThrow(id, user.sub);
    const senderName = ticket.user?.fullName || ticket.contactName || 'Foydalanuvchi';
    const message = await this.support.addMessage(id, user.sub, senderName, dto.text, false);
    return {
      id: message.id,
      ticketId: message.ticketId,
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      isAdmin: message.isAdmin,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
