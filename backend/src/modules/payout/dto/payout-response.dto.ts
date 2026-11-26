import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus, type Payout, type PayoutCorrection } from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';
import { IsDateString, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class PayoutCorrectionItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() staffId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) previousBankRef!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) newBankRef!: string | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) previousTransferredAt!: Date | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) newTransferredAt!: Date | null;
  @ApiProperty() reason!: string;
  @ApiProperty() createdAt!: Date;
}

export class PayoutResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PayoutStatus }) status!: PayoutStatus;
  @ApiProperty({ description: 'Butun so‘m' }) amount!: number;
  @ApiProperty({ description: 'Exact signed integer tiyin, decimal string; 100 tiyin = 1 UZS', example: '12345' }) amountTiyin!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() destinationReference!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) destinationId?: string | null;
  @ApiPropertyOptional({ type: Object, nullable: true }) destinationSnapshot?: Record<string, unknown> | null;
  @ApiPropertyOptional({ type: String, nullable: true }) bankOperationRef?: string | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) bankTransferredAt?: Date | null;

  @ApiPropertyOptional() failureReason?: string | null;
  @ApiPropertyOptional() processingAt?: Date | null;
  @ApiPropertyOptional() succeededAt?: Date | null;
  @ApiPropertyOptional() failedAt?: Date | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export function toPayoutResponseDto(payout: Payout): PayoutResponseDto {
  return {
    id: payout.id,
    status: payout.status,
    amount: tiyinToSom(payout.amount),
    amountTiyin: payout.amount.toString(),
    currency: payout.currency,
    destinationReference: payout.destinationReference,
    destinationId: payout.destinationId ?? null,
    destinationSnapshot: (payout.destinationSnapshot as Record<string, unknown> | null) ?? null,
    bankOperationRef: payout.bankOperationRef ?? null,
    bankTransferredAt: payout.bankTransferredAt ?? null,
    failureReason: payout.failureReason,
    processingAt: payout.processingAt ?? null,
    succeededAt: payout.succeededAt,
    failedAt: payout.failedAt,
    createdAt: payout.createdAt,
    updatedAt: payout.updatedAt,
  };
}

export class StaffPayoutResponseDto extends PayoutResponseDto {
  @ApiProperty() sellerId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sellerName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sellerPhone?: string | null;
  @ApiPropertyOptional() providerPayoutId?: string | null;
  @ApiProperty() provider!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) transferredAmount?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) processedByStaffId?: string | null;
  @ApiPropertyOptional({ type: [PayoutCorrectionItemDto] }) corrections?: PayoutCorrectionItemDto[];
}

export function toStaffPayoutResponseDto(
  payout: Payout & {
    seller?: { fullName: string | null; phone: string } | null;
    corrections?: PayoutCorrection[];
  },
): StaffPayoutResponseDto {
  return {
    ...toPayoutResponseDto(payout),
    sellerId: payout.sellerId,
    sellerName: payout.seller?.fullName ?? null,
    sellerPhone: payout.seller?.phone ?? null,
    providerPayoutId: payout.providerPayoutId,
    provider: payout.provider,
    transferredAmount: payout.transferredAmount !== null && payout.transferredAmount !== undefined ? tiyinToSom(payout.transferredAmount) : null,
    processedByStaffId: payout.processedByStaffId ?? null,
    corrections: (payout.corrections ?? []).map((c) => ({
      id: c.id,
      staffId: c.staffId,
      previousBankRef: c.previousBankRef ?? null,
      newBankRef: c.newBankRef ?? null,
      previousTransferredAt: c.previousTransferredAt ?? null,
      newTransferredAt: c.newTransferredAt ?? null,
      reason: c.reason,
      createdAt: c.createdAt,
    })),
  };
}

export class MarkPayoutPaidDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  bankOperationRef!: string;

  @ApiProperty({ description: 'O‘tkazilgan summa (butun so‘m)', minimum: 1 })
  @IsInt()
  @IsPositive()
  transferredAmount!: number;

  @ApiPropertyOptional({ description: 'ISO 8601 bank o‘tkazmasi sanasi' })
  @IsOptional()
  @IsDateString()
  bankTransferredAt?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectPayoutDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class CorrectPayoutDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  bankOperationRef?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 bank o‘tkazmasi sanasi' })
  @IsOptional()
  @IsDateString()
  bankTransferredAt?: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
