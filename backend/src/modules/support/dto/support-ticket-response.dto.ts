import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SupportTicket, TicketMessage, User } from '@prisma/client';

export class TicketMessageResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  ticketId!: string;

  @ApiPropertyOptional()
  senderId?: string | null;

  @ApiProperty()
  senderName!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty()
  isAdmin!: boolean;

  @ApiProperty()
  createdAt!: string;
}

export class SupportTicketResponseDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional()
  userId?: string | null;

  @ApiPropertyOptional()
  userName?: string | null;

  @ApiPropertyOptional()
  contactName?: string | null;

  @ApiPropertyOptional()
  contactInfo?: string | null;

  @ApiProperty()
  topic!: string;

  @ApiProperty()
  subject!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  priority!: string;

  @ApiPropertyOptional()
  closedAt?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiPropertyOptional({ type: () => [TicketMessageResponseDto] })
  messages?: TicketMessageResponseDto[];
}

export function toStatusLabel(status: string): 'ochiq' | 'javob_berildi' | 'yopilgan' {
  if (status === 'ANSWERED' || status === 'javob_berildi') return 'javob_berildi';
  if (status === 'CLOSED' || status === 'yopilgan') return 'yopilgan';
  return 'ochiq';
}

export function toSupportTicketResponseDto(
  ticket: SupportTicket & { user?: Pick<User, 'id' | 'fullName' | 'phone'> | null; messages?: TicketMessage[] },
): SupportTicketResponseDto {
  return {
    id: ticket.id,
    userId: ticket.userId,
    userName: ticket.user?.fullName || ticket.contactName || null,
    contactName: ticket.contactName,
    contactInfo: ticket.contactInfo || ticket.user?.phone || null,
    topic: ticket.topic,
    subject: ticket.subject,
    message: ticket.message,
    status: toStatusLabel(ticket.status),
    priority: ticket.priority,
    closedAt: ticket.closedAt?.toISOString() || null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: ticket.messages?.map((m) => ({
      id: m.id,
      ticketId: m.ticketId,
      senderId: m.senderId,
      senderName: m.senderName,
      text: m.text,
      isAdmin: m.isAdmin,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
