import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RefundStatus, type Refund } from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';

/** Buyer-ko'rinish — provider ichki detallari YO'Q (bo'lim 17 bilan bir xil qoida). */
export class RefundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() contractId!: string;
  @ApiProperty() paymentId!: string;
  @ApiPropertyOptional({ description: 'Bosqich 8 — dispute-driven bo‘lsa tegishli Dispute ID' }) disputeId?: string | null;
  @ApiProperty({ enum: RefundStatus }) status!: RefundStatus;
  @ApiProperty({ description: 'Butun so‘m' }) amount!: number;
  @ApiProperty({ description: 'Exact signed integer tiyin, decimal string; 100 tiyin = 1 UZS', example: '12345' }) amountTiyin!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() reason!: string;

  @ApiPropertyOptional() failureReason?: string | null;
  @ApiPropertyOptional() succeededAt?: Date | null;
  @ApiPropertyOptional() failedAt?: Date | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export function toRefundResponseDto(refund: Refund): RefundResponseDto {
  return {
    id: refund.id,
    contractId: refund.contractId,
    paymentId: refund.paymentId,
    disputeId: refund.disputeId,
    status: refund.status,
    amount: tiyinToSom(refund.amount),
    amountTiyin: refund.amount.toString(),
    currency: refund.currency,
    reason: refund.reason,
    failureReason: refund.failureReason,
    succeededAt: refund.succeededAt,
    failedAt: refund.failedAt,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

/** Staff — qo'shimcha traceability maydonlari (Bosqich 5/6 bilan bir xil naqsh). */
export class StaffRefundResponseDto extends RefundResponseDto {
  @ApiProperty() requestedByStaffId!: string;
  @ApiPropertyOptional() providerRefundId?: string | null;
  @ApiProperty() provider!: string;
}

export function toStaffRefundResponseDto(refund: Refund): StaffRefundResponseDto {
  return {
    ...toRefundResponseDto(refund),
    requestedByStaffId: refund.requestedByStaffId,
    providerRefundId: refund.providerRefundId,
    provider: refund.provider,
  };
}
