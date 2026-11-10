import { Injectable } from '@nestjs/common';
import { Prisma, SupportTicketStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { buildPage } from '@/common/pagination/page-query.dto';
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
  ) {}

  async createTicket(userId: string | null, dto: CreateSupportTicketDto) {
    const ticketId = this.ids.next();
    const messageId = this.ids.next();
    const now = new Date();

    let senderName = dto.contactName || 'Foydalanuvchi';
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, phone: true },
      });
      if (user?.fullName) senderName = user.fullName;
    }

    const ticket = await this.prisma.supportTicket.create({
      data: {
        id: ticketId,
        userId: userId || null,
        contactName: dto.contactName || senderName,
        contactInfo: dto.contactInfo || null,
        topic: dto.topic,
        subject: dto.subject,
        message: dto.message,
        status: SupportTicketStatus.OPEN,
        priority: 'MEDIUM',
        createdAt: now,
        updatedAt: now,
        messages: {
          create: {
            id: messageId,
            senderId: userId || null,
            senderName,
            text: dto.message,
            isAdmin: false,
            createdAt: now,
          },
        },
      },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    return ticket;
  }

  async listMine(userId: string, page = 1, perPage = 20) {
    const where: Prisma.SupportTicketWhereInput = { userId };
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return buildPage(items, total, page, perPage);
  }

  async getByIdOrThrow(id: string, userId?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) throw new NotFoundError('Yordam chiptasi topilmadi', 'TICKET_NOT_FOUND');
    if (userId && ticket.userId !== userId) {
      throw new NotFoundError('Yordam chiptasi topilmadi', 'TICKET_NOT_FOUND');
    }

    return ticket;
  }

  async addMessage(ticketId: string, senderId: string | null, senderName: string, text: string, isAdmin = false) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError('Yordam chiptasi topilmadi', 'TICKET_NOT_FOUND');

    const nextStatus = isAdmin ? SupportTicketStatus.ANSWERED : SupportTicketStatus.OPEN;
    const messageId = this.ids.next();
    const now = new Date();

    const [message] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: {
          id: messageId,
          ticketId,
          senderId: senderId || null,
          senderName,
          text,
          isAdmin,
          createdAt: now,
        },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: nextStatus,
          updatedAt: now,
        },
      }),
    ]);

    return message;
  }

  async listForStaff(query: ListTicketsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where: Prisma.SupportTicketWhereInput = {};

    if (query.status && query.status !== 'all') {
      if (query.status === 'ochiq' || query.status === 'OPEN') {
        where.status = SupportTicketStatus.OPEN;
      } else if (query.status === 'javob_berildi' || query.status === 'ANSWERED') {
        where.status = SupportTicketStatus.ANSWERED;
      } else if (query.status === 'yopilgan' || query.status === 'CLOSED') {
        where.status = SupportTicketStatus.CLOSED;
      }
    }

    if (query.topic && query.topic !== 'all') {
      where.topic = query.topic;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { message: { contains: q, mode: 'insensitive' } },
        { contactName: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total, openCount, answeredCount, closedCount, allCount] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.OPEN } }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.ANSWERED } }),
      this.prisma.supportTicket.count({ where: { status: SupportTicketStatus.CLOSED } }),
      this.prisma.supportTicket.count(),
    ]);

    const facets: Record<string, number> = {
      _all: allCount,
      ochiq: openCount,
      javob_berildi: answeredCount,
      yopilgan: closedCount,
    };

    const paged = buildPage(items, total, page, perPage);
    return { ...paged, facets };
  }

  async replyAsStaff(
    ticketId: string,
    replyText: string,
    newStatus: string | undefined,
    actor: AuditActor,
  ) {
    const ticket = await this.getByIdOrThrow(ticketId);
    let mappedStatus: SupportTicketStatus = SupportTicketStatus.ANSWERED;
    if (newStatus === 'yopilgan' || newStatus === 'CLOSED') {
      mappedStatus = SupportTicketStatus.CLOSED;
    } else if (newStatus === 'ochiq' || newStatus === 'OPEN') {
      mappedStatus = SupportTicketStatus.OPEN;
    }

    const messageId = this.ids.next();
    const now = new Date();

    const [updatedTicket] = await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({
        data: {
          id: messageId,
          ticketId,
          senderId: actor.id,
          senderName: actor.name || 'Qo‘llab-quvvatlash xizmati',
          text: replyText.trim(),
          isAdmin: true,
          createdAt: now,
        },
      });

      const updated = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: mappedStatus,
          updatedAt: now,
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      await this.audit.record(
        {
          actor,
          action: 'TICKET_REPLIED',
          resourceType: 'SUPPORT_TICKET',
          resourceId: ticketId,
          contextId: ticket.userId || undefined,
          previousState: { status: ticket.status },
          newState: { status: mappedStatus, replySnippet: replyText.slice(0, 100) },
        },
        tx,
      );

      return [updated];
    });

    return updatedTicket;
  }

  async closeAsStaff(ticketId: string, note: string, actor: AuditActor) {
    const ticket = await this.getByIdOrThrow(ticketId);
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: SupportTicketStatus.CLOSED,
          closedAt: now,
          closedByStaffId: actor.id,
          updatedAt: now,
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      await this.audit.record(
        {
          actor,
          action: 'TICKET_CLOSED',
          resourceType: 'SUPPORT_TICKET',
          resourceId: ticketId,
          contextId: ticket.userId || undefined,
          previousState: { status: ticket.status },
          newState: { status: 'CLOSED', note },
        },
        tx,
      );

      return res;
    });

    return updated;
  }
}
