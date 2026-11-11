import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { User, UserAppeal } from '@prisma/client';

export class AppealResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  userName!: string;

  @ApiProperty()
  userRole!: 'mutaxassis' | 'xaridor';

  @ApiProperty()
  restrictionType!: string;

  @ApiProperty()
  originalReason!: string;

  @ApiProperty()
  appealText!: string;

  @ApiProperty({ type: [String] })
  evidenceUrls!: string[];

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  reviewerId?: string | null;

  @ApiPropertyOptional()
  reviewerName?: string | null;

  @ApiPropertyOptional()
  decisionNote?: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional()
  resolvedAt?: string | null;
}

export function toAppealResponseDto(
  appeal: UserAppeal & { user?: Pick<User, 'id' | 'fullName' | 'phone' | 'roles'> | null },
): AppealResponseDto {
  const isSeller = appeal.user?.roles?.includes('SELLER');
  return {
    id: appeal.id,
    userId: appeal.userId,
    userName: appeal.user?.fullName || appeal.user?.phone || 'Foydalanuvchi',
    userRole: isSeller ? 'mutaxassis' : 'xaridor',
    restrictionType: appeal.restrictionType.toLowerCase(),
    originalReason: appeal.originalReason,
    appealText: appeal.appealText,
    evidenceUrls: appeal.evidenceUrls,
    status: appeal.status.toLowerCase(),
    reviewerId: appeal.reviewerId,
    reviewerName: appeal.reviewerName,
    decisionNote: appeal.decisionNote,
    createdAt: appeal.createdAt.toISOString(),
    resolvedAt: appeal.resolvedAt?.toISOString() || null,
  };
}
