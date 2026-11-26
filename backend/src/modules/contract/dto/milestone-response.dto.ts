import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MilestoneStatus,
  type Milestone,
  type MilestoneRevisionRequest,
  type MilestoneSubmission,
} from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';

export class MilestoneSubmissionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() submittedById!: string;
  @ApiPropertyOptional({ nullable: true }) message!: string | null;
  @ApiProperty({ type: [String] }) deliverableUrls!: string[];
  @ApiProperty() createdAt!: Date;
}

export class MilestoneRevisionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() requestedById!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() createdAt!: Date;
}

export class MilestoneResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() contractId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty({ description: 'Butun so‘m' }) amount!: number;
  @ApiProperty() position!: number;
  @ApiProperty({ enum: MilestoneStatus }) status!: MilestoneStatus;
  @ApiPropertyOptional({ nullable: true }) dueAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) submittedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true }) approvedAt!: Date | null;
  @ApiProperty({ type: [MilestoneSubmissionItemDto] }) submissions!: MilestoneSubmissionItemDto[];
  @ApiProperty({ type: [MilestoneRevisionItemDto] }) revisionRequests!: MilestoneRevisionItemDto[];
  @ApiProperty() revisionCount!: number;
  @ApiProperty() autoAcceptPaused!: boolean;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) reviewDeadline!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

type MilestoneWithHistory = Milestone & {
  submissions?: MilestoneSubmission[];
  revisionRequests?: MilestoneRevisionRequest[];
};

export function toMilestoneResponseDto(
  m: MilestoneWithHistory,
  opts?: { autoAcceptPaused?: boolean },
): MilestoneResponseDto {
  const submissions = (m.submissions ?? [])
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((s) => ({
      id: s.id,
      submittedById: s.submittedById,
      message: s.message ?? null,
      deliverableUrls: s.deliverableUrls ?? [],
      createdAt: s.createdAt,
    }));

  const revisionRequests = (m.revisionRequests ?? [])
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      requestedById: r.requestedById,
      reason: r.reason,
      createdAt: r.createdAt,
    }));

  const autoAcceptPaused = Boolean(opts?.autoAcceptPaused);
  const reviewDeadline =
    m.status === 'SUBMITTED' && m.submittedAt && !autoAcceptPaused
      ? new Date(m.submittedAt.getTime() + 72 * 3600_000)
      : null;

  return {
    id: m.id,
    contractId: m.contractId,
    title: m.title,
    description: m.description,
    amount: tiyinToSom(m.amount),
    position: m.position,
    status: m.status,
    dueAt: m.dueAt,
    submittedAt: m.submittedAt,
    approvedAt: m.approvedAt,
    submissions,
    revisionRequests,
    revisionCount: revisionRequests.length,
    autoAcceptPaused,
    reviewDeadline,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
