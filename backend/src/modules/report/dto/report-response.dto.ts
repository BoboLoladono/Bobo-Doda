import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TrustReport, User } from '@prisma/client';

export class ReportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  reporterId!: string;

  @ApiProperty()
  reporterName!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  targetTitle!: string;

  @ApiProperty()
  reasonType!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional()
  evidenceUrl?: string | null;

  @ApiProperty()
  severity!: string;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  assignedAdminId?: string | null;

  @ApiPropertyOptional()
  assignedAdminName?: string | null;

  @ApiPropertyOptional()
  resolutionNote?: string | null;

  @ApiProperty()
  actionTaken!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional()
  resolvedAt?: string | null;
}

export function toReportResponseDto(
  report: TrustReport & { reporter?: Pick<User, 'id' | 'fullName' | 'phone'> | null },
): ReportResponseDto {
  return {
    id: report.id,
    reporterId: report.reporterId,
    reporterName: report.reporter?.fullName || report.reporter?.phone || 'Foydalanuvchi',
    targetType: report.targetType.toLowerCase(),
    targetId: report.targetId,
    targetTitle: report.targetTitle,
    reasonType: report.reasonType.toLowerCase(),
    description: report.description,
    evidenceUrl: report.evidenceUrl,
    severity: report.severity.toLowerCase(),
    status: report.status.toLowerCase(),
    assignedAdminId: report.assignedAdminId,
    assignedAdminName: report.assignedAdminName,
    resolutionNote: report.resolutionNote,
    actionTaken: report.actionTaken.toLowerCase(),
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() || null,
  };
}
