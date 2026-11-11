import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutStatus, type Payout } from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';

/** Seller-ko'rinish — provider ichki detallari YO'Q (Refund bilan bir xil qoida). */
export class PayoutResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PayoutStatus }) status!: PayoutStatus;
  @ApiProperty({ description: 'Butun so‘m' }) amount!: number;
  @ApiProperty({ description: 'Exact signed integer tiyin, decimal string; 100 tiyin = 1 UZS', example: '12345' }) amountTiyin!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() destinationReference!: string;

  @ApiPropertyOptional() failureReason?: string | null;
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
    failureReason: payout.failureReason,
    succeededAt: payout.succeededAt,
    failedAt: payout.failedAt,
    createdAt: payout.createdAt,
    updatedAt: payout.updatedAt,
  };
}

/** Staff — qo'shimcha traceability maydonlari (Refund bilan bir xil naqsh). */
export class StaffPayoutResponseDto extends PayoutResponseDto {
  @ApiProperty() sellerId!: string;
  @ApiPropertyOptional() providerPayoutId?: string | null;
  @ApiProperty() provider!: string;
}

export function toStaffPayoutResponseDto(payout: Payout): StaffPayoutResponseDto {
  return {
    ...toPayoutResponseDto(payout),
    sellerId: payout.sellerId,
    providerPayoutId: payout.providerPayoutId,
    provider: payout.provider,
  };
}
