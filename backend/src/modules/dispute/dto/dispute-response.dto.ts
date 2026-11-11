import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeReason, DisputeResolutionType, DisputeStatus, type Dispute } from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';

/** Ishtirokchi (buyer/seller) ko'rinishi — staff ichki maydonlar (kim ochdi/kim hal qildi) YO'Q. */
export class DisputeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() contractId!: string;
  @ApiProperty({ enum: DisputeReason }) reason!: DisputeReason;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: DisputeStatus }) status!: DisputeStatus;
  @ApiProperty() preSettlement!: boolean;
  @ApiProperty({ description: 'Butun so‘m' }) disputedAmount!: number;
  @ApiProperty({ description: 'Butun so‘m' }) heldAmount!: number;
  @ApiProperty({ description: 'Exact integer tiyin as a decimal string; 100 tiyin = 1 UZS' }) disputedAmountTiyin!: string;
  @ApiProperty({ description: 'Exact integer tiyin as a decimal string; 100 tiyin = 1 UZS' }) heldAmountTiyin!: string;
  @ApiProperty() currency!: string;

  @ApiPropertyOptional({ enum: DisputeResolutionType }) resolutionType?: DisputeResolutionType | null;
  @ApiPropertyOptional({ description: 'Butun so‘m' }) buyerAwardAmount?: number | null;
  @ApiPropertyOptional({ description: 'Butun so‘m' }) sellerAwardAmount?: number | null;
  @ApiPropertyOptional({ description: 'Exact integer tiyin as a decimal string; null until allocated', nullable: true }) buyerAwardAmountTiyin?: string | null;
  @ApiPropertyOptional({ description: 'Exact integer tiyin as a decimal string; null until allocated', nullable: true }) sellerAwardAmountTiyin?: string | null;
  @ApiPropertyOptional() resolutionReason?: string | null;

  @ApiProperty() openedAt!: Date;
  @ApiPropertyOptional() reviewStartedAt?: Date | null;
  @ApiPropertyOptional() resolvedAt?: Date | null;
  @ApiPropertyOptional() rejectedAt?: Date | null;
  @ApiPropertyOptional() cancelledAt?: Date | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export function toDisputeResponseDto(dispute: Dispute): DisputeResponseDto {
  return {
    id: dispute.id,
    contractId: dispute.contractId,
    reason: dispute.reason,
    description: dispute.description,
    status: dispute.status,
    preSettlement: dispute.preSettlement,
    disputedAmount: tiyinToSom(dispute.disputedAmount),
    disputedAmountTiyin: dispute.disputedAmount.toString(),
    heldAmount: tiyinToSom(dispute.heldAmount),
    heldAmountTiyin: dispute.heldAmount.toString(),
    currency: dispute.currency,
    resolutionType: dispute.resolutionType,
    buyerAwardAmount: dispute.buyerAwardAmount !== null ? tiyinToSom(dispute.buyerAwardAmount) : null,
    buyerAwardAmountTiyin: dispute.buyerAwardAmount?.toString() ?? null,
    sellerAwardAmount: dispute.sellerAwardAmount !== null ? tiyinToSom(dispute.sellerAwardAmount) : null,
    sellerAwardAmountTiyin: dispute.sellerAwardAmount?.toString() ?? null,
    resolutionReason: dispute.resolutionReason,
    openedAt: dispute.openedAt,
    reviewStartedAt: dispute.reviewStartedAt,
    resolvedAt: dispute.resolvedAt,
    rejectedAt: dispute.rejectedAt,
    cancelledAt: dispute.cancelledAt,
    createdAt: dispute.createdAt,
    updatedAt: dispute.updatedAt,
  };
}

/** Staff — qo'shimcha traceability maydonlari. */
export class StaffDisputeResponseDto extends DisputeResponseDto {
  @ApiProperty() openedByUserId!: string;
  @ApiPropertyOptional() resolvedByStaffId?: string | null;
  @ApiPropertyOptional() rejectedByStaffId?: string | null;
}

export function toStaffDisputeResponseDto(dispute: Dispute): StaffDisputeResponseDto {
  return {
    ...toDisputeResponseDto(dispute),
    openedByUserId: dispute.openedByUserId,
    resolvedByStaffId: dispute.resolvedByStaffId,
    rejectedByStaffId: dispute.rejectedByStaffId,
  };
}
