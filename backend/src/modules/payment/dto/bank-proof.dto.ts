import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankTransferProofStatus, type BankTransferProof } from '@prisma/client';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { tiyinToSom, MAX_SOM } from '@/common/money/money.util';
import { IsSafeDeliverableUrl } from '@/modules/contract/dto/submit-milestone.dto';

export class CompanyBankDetailsDto {
  @ApiProperty() companyName!: string;
  @ApiProperty() bankName!: string;
  @ApiProperty() accountNumber!: string;
  @ApiProperty() mfo!: string;
  @ApiProperty() inn!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) bankAddress!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) supportPhone!: string | null;
}

export class CompanyBankDetailsResponseDto {
  @ApiProperty() configured!: boolean;
  @ApiPropertyOptional({ type: CompanyBankDetailsDto, nullable: true })
  details!: CompanyBankDetailsDto | null;
}

export class SubmitBankProofDto {
  @ApiPropertyOptional({ description: 'Yuborilgan summa (butun so‘mda)', minimum: 1000, maximum: MAX_SOM })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(MAX_SOM)
  declaredAmount?: number;

  @ApiPropertyOptional({ description: 'Yuklangan chek/kvitansiya fayl manzili' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeDeliverableUrl()
  receiptFileUrl?: string;

  @ApiPropertyOptional({ description: 'Chek raqami yoki izoh', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  receiptNote?: string;
}

export class VerifyBankProofDto {
  @ApiProperty({ description: 'Bank hisobiga haqiqatda tushgan summa (butun so‘m)', minimum: 1, maximum: MAX_SOM })
  @IsInt()
  @Min(1)
  @Max(MAX_SOM)
  receivedAmount!: number;

  @ApiProperty({ description: 'Bank operatsiya / to‘lov hujjati raqami (unikal)', minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  bankOperationRef!: string;

  @ApiPropertyOptional({ description: 'Ortiqcha to‘lovni ortig‘ini qaytarish sharti bilan qabul qilish' })
  @IsOptional()
  @IsBoolean()
  allowOverpaymentSurplus?: boolean;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectBankProofDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class ConfirmManualBankRefundDto {
  @ApiProperty({ minLength: 3, maxLength: 100 })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  bankOperationRef!: string;

  @ApiPropertyOptional({ description: 'ISO 8601 bank qaytarish sanasi' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bankReturnedAt?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class BankTransferProofResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() contractId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) paymentId!: string | null;
  @ApiProperty() buyerId!: string;
  @ApiProperty() paymentPurposeCode!: string;
  @ApiProperty() declaredAmount!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) receivedAmount!: number | null;
  @ApiProperty() mismatchAmount!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) bankOperationRef!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) receiptFileUrl!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) receiptNote!: string | null;
  @ApiProperty({ enum: BankTransferProofStatus }) status!: BankTransferProofStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reviewedByStaffId!: string | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) reviewedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) contractTitle?: string | null;
  @ApiPropertyOptional() contractAgreedAmount?: number;
  @ApiPropertyOptional({ type: String, nullable: true }) buyerName?: string | null;
}

export function toBankTransferProofResponseDto(
  row: BankTransferProof & {
    contract?: { serviceTitleSnapshot: string; agreedAmount: bigint } | null;
    buyer?: { fullName: string | null; phone: string } | null;
  },
): BankTransferProofResponseDto {
  return {
    id: row.id,
    contractId: row.contractId,
    paymentId: row.paymentId ?? null,
    buyerId: row.buyerId,
    paymentPurposeCode: row.paymentPurposeCode,
    declaredAmount: tiyinToSom(row.declaredAmount),
    receivedAmount: row.receivedAmount !== null ? tiyinToSom(row.receivedAmount) : null,
    mismatchAmount: tiyinToSom(row.mismatchAmount),
    bankOperationRef: row.bankOperationRef ?? null,
    receiptFileUrl: row.receiptFileUrl ?? null,
    receiptNote: row.receiptNote ?? null,
    status: row.status,
    rejectionReason: row.rejectionReason ?? null,
    reviewedByStaffId: row.reviewedByStaffId ?? null,
    reviewedAt: row.reviewedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contractTitle: row.contract?.serviceTitleSnapshot ?? null,
    contractAgreedAmount: row.contract ? tiyinToSom(row.contract.agreedAmount) : undefined,
    buyerName: row.buyer ? row.buyer.fullName || row.buyer.phone : null,
  };
}
