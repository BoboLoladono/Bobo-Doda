import { tiyinToSom } from '@/common/money/money.util';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface SellerBalanceBreakdownTotals {
  currency: string;
  availableTiyin: bigint;
  pendingTiyin: bigint;
  reservedTiyin: bigint;
  disputedHeldTiyin: bigint;
  paidTiyin: bigint;
  grossEarnedTiyin: bigint;
  commissionWithheldTiyin: bigint;
  netEarnedTiyin: bigint;
}

export class SellerBalanceResponseDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'Yechish mumkin bo‘lgan qoldiq (butun so‘m)' })
  available!: number;
  @ApiProperty() availableTiyin!: string;

  @ApiProperty({ description: 'Escrowda kutilayotgan summa (funded, hali qabul qilinmagan, nizosiz)' })
  pending!: number;
  @ApiProperty() pendingTiyin!: string;

  @ApiProperty({ description: 'Pul yechishga so‘ralgan va band qilingan summa (PAYOUT_CLEARING)' })
  reserved!: number;
  @ApiProperty() reservedTiyin!: string;

  @ApiProperty({ description: 'Nizo sababli muzlatilgan summa' })
  disputedHeld!: number;
  @ApiProperty() disputedHeldTiyin!: string;

  @ApiProperty({ description: 'Bank orqali to‘langan jami summa (SUCCEEDED payouts)' })
  paid!: number;
  @ApiProperty() paidTiyin!: string;

  @ApiProperty({ description: 'Qabul qilingan ishlar umumiy qiymati (brutto)' })
  grossEarned!: number;
  @ApiProperty() grossEarnedTiyin!: string;

  @ApiProperty({ description: 'Ushlangan platforma komissiyasi' })
  commissionWithheld!: number;
  @ApiProperty() commissionWithheldTiyin!: string;

  @ApiProperty({ description: 'Mutaxassisning jami sof daromadi' })
  netEarned!: number;
  @ApiProperty() netEarnedTiyin!: string;
}

export class SellerContractBreakdownItemDto {
  @ApiProperty() contractId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() contractStatus!: string;
  @ApiProperty() stage!: 'pending' | 'disputed' | 'settled';
  @ApiProperty() grossAmount!: number;
  @ApiProperty() platformFeeRateBps!: number;
  @ApiProperty() commissionAmount!: number;
  @ApiProperty() netAmount!: number;
  @ApiProperty() funded!: boolean;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) fundedAt!: Date | null;
  @ApiProperty() updatedAt!: Date;
}

export class SellerPayoutBreakdownItemDto {
  @ApiProperty() payoutId!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() status!: string;
  @ApiProperty() destinationReference!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) bankOperationRef!: string | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) bankTransferredAt!: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) failureReason!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) succeededAt!: Date | null;
}

export class SellerBalanceBreakdownResponseDto {
  @ApiProperty({ type: SellerBalanceResponseDto })
  summary!: SellerBalanceResponseDto;

  @ApiProperty({ type: [SellerContractBreakdownItemDto] })
  contracts!: SellerContractBreakdownItemDto[];

  @ApiProperty({ type: [SellerPayoutBreakdownItemDto] })
  payouts!: SellerPayoutBreakdownItemDto[];
}

export function toSellerBalanceResponseDto(
  totalsOrCurrency: SellerBalanceBreakdownTotals | string,
  balanceTiyin?: bigint,
): SellerBalanceResponseDto {
  if (typeof totalsOrCurrency === 'string') {
    const avail = balanceTiyin ?? 0n;
    return {
      currency: totalsOrCurrency,
      available: tiyinToSom(avail),
      availableTiyin: avail.toString(),
      pending: 0,
      pendingTiyin: '0',
      reserved: 0,
      reservedTiyin: '0',
      disputedHeld: 0,
      disputedHeldTiyin: '0',
      paid: 0,
      paidTiyin: '0',
      grossEarned: 0,
      grossEarnedTiyin: '0',
      commissionWithheld: 0,
      commissionWithheldTiyin: '0',
      netEarned: 0,
      netEarnedTiyin: '0',
    };
  }

  return {
    currency: totalsOrCurrency.currency,
    available: tiyinToSom(totalsOrCurrency.availableTiyin),
    availableTiyin: totalsOrCurrency.availableTiyin.toString(),
    pending: tiyinToSom(totalsOrCurrency.pendingTiyin),
    pendingTiyin: totalsOrCurrency.pendingTiyin.toString(),
    reserved: tiyinToSom(totalsOrCurrency.reservedTiyin),
    reservedTiyin: totalsOrCurrency.reservedTiyin.toString(),
    disputedHeld: tiyinToSom(totalsOrCurrency.disputedHeldTiyin),
    disputedHeldTiyin: totalsOrCurrency.disputedHeldTiyin.toString(),
    paid: tiyinToSom(totalsOrCurrency.paidTiyin),
    paidTiyin: totalsOrCurrency.paidTiyin.toString(),
    grossEarned: tiyinToSom(totalsOrCurrency.grossEarnedTiyin),
    grossEarnedTiyin: totalsOrCurrency.grossEarnedTiyin.toString(),
    commissionWithheld: tiyinToSom(totalsOrCurrency.commissionWithheldTiyin),
    commissionWithheldTiyin: totalsOrCurrency.commissionWithheldTiyin.toString(),
    netEarned: tiyinToSom(totalsOrCurrency.netEarnedTiyin),
    netEarnedTiyin: totalsOrCurrency.netEarnedTiyin.toString(),
  };
}
