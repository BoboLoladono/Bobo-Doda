import { ApiProperty } from '@nestjs/swagger';
import type { Contract, Review, User } from '@prisma/client';

export class ReviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  contractId!: string;

  @ApiProperty()
  contractTitle!: string;

  @ApiProperty()
  authorId!: string;

  @ApiProperty()
  authorName!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  targetName!: string;

  @ApiProperty()
  rating!: number;

  @ApiProperty()
  comment!: string;

  @ApiProperty()
  status!: 'approved' | 'flagged' | 'hidden';

  @ApiProperty()
  reportCount!: number;

  @ApiProperty()
  createdAt!: string;
}

export function toReviewResponseDto(
  review: Review & {
    contract?: Pick<Contract, 'id' | 'serviceTitleSnapshot'> | null;
    author?: Pick<User, 'id' | 'fullName' | 'phone'> | null;
    target?: Pick<User, 'id' | 'fullName' | 'phone'> | null;
  },
): ReviewResponseDto {
  return {
    id: review.id,
    contractId: review.contractId,
    contractTitle: review.contract?.serviceTitleSnapshot || 'Shartnoma',
    authorId: review.authorId,
    authorName: review.author?.fullName || review.author?.phone || 'Buyurtmachi',
    targetId: review.targetId,
    targetName: review.target?.fullName || review.target?.phone || 'Mutaxassis',
    rating: review.rating,
    comment: review.comment,
    status: review.status.toLowerCase() as 'approved' | 'flagged' | 'hidden',
    reportCount: review.reportCount,
    createdAt: review.createdAt.toISOString(),
  };
}
