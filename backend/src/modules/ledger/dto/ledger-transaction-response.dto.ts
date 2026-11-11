import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LedgerAccountOwnerType, LedgerAccountType, LedgerTransactionType, Prisma } from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';

/**
 * Staff-only ko'rinish (bo'lim 60): faqat accounting maydonlari — hech
 * qanday sir/provider ma'lumot/foydalanuvchi shaxsiy ma'lumoti YO'Q
 * (`ownerId` — UUID, mustaqil holda PII emas, boshqa staff endpoint'lar
 * bilan bir xil daraja).
 */
export class LedgerEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() accountId!: string;
  @ApiProperty({ enum: LedgerAccountType }) accountType!: LedgerAccountType;
  @ApiProperty({ enum: LedgerAccountOwnerType }) accountOwnerType!: LedgerAccountOwnerType;
  @ApiPropertyOptional() accountOwnerId?: string | null;
  @ApiProperty({ description: 'Ishorali butun so‘m — musbat=kredit, manfiy=debit' }) amount!: number;
  @ApiProperty({ description: 'Exact signed integer tiyin, decimal string; 100 tiyin = 1 UZS', example: '12345' }) amountTiyin!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() createdAt!: Date;
}

export class LedgerTransactionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LedgerTransactionType }) type!: LedgerTransactionType;
  @ApiProperty() currency!: string;
  @ApiProperty({ description: 'Payment.id yoki Contract.id — `type`ga qarab' }) sourceId!: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: [LedgerEntryResponseDto] }) entries!: LedgerEntryResponseDto[];
  @ApiProperty() createdAt!: Date;
}

type TransactionWithEntries = Prisma.LedgerTransactionGetPayload<{
  include: { entries: { include: { account: true } } };
}>;

export function toLedgerTransactionResponseDto(transaction: TransactionWithEntries): LedgerTransactionResponseDto {
  return {
    id: transaction.id,
    type: transaction.type,
    currency: transaction.currency,
    sourceId: transaction.sourceId,
    description: transaction.description,
    entries: transaction.entries.map((entry) => ({
      id: entry.id,
      accountId: entry.accountId,
      accountType: entry.account.type,
      accountOwnerType: entry.account.ownerType,
      accountOwnerId: entry.account.ownerId,
      amount: tiyinToSom(entry.amount),
      amountTiyin: entry.amount.toString(),
      currency: entry.currency,
      createdAt: entry.createdAt,
    })),
    createdAt: transaction.createdAt,
  };
}
