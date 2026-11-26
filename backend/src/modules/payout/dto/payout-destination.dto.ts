import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PayoutDestinationType,
  PayoutDestinationVerificationStatus,
  type SellerPayoutDestination,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '@/common/pagination/page-query.dto';

export const PAYOUT_VERIFICATION_METHODS = [
  'BANK_PORTAL_BENEFICIARY',
  'BANK_DOCUMENT_AND_MICRO_TRANSFER',
] as const;
export type PayoutVerificationMethod = (typeof PAYOUT_VERIFICATION_METHODS)[number];

export class CreatePayoutDestinationDto {
  @ApiProperty({ enum: PayoutDestinationType })
  @IsEnum(PayoutDestinationType)
  type!: PayoutDestinationType;

  @ApiProperty({ example: 'Uzcard', minLength: 2, maxLength: 60 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  providerLabel!: string;

  @ApiProperty({
    description:
      '16 xonali karta raqami yoki 20 xonali bank hisob raqami — saqlashdan oldin maskalanadi (CVV/PIN qabul qilinmaydi)',
    example: '8600123456789012',
  })
  @IsString()
  @Matches(/^[\d\s*•]{4,32}$/, {
    message: 'Faqat karta yoki hisob raqamini kiriting (CVV/PIN kiritmang)',
  })
  rawAccountOrCard!: string;

  @ApiProperty({ minLength: 3, maxLength: 120 })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  holderName!: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  mfo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class VerifyPayoutDestinationDto {
  @ApiProperty({ enum: PAYOUT_VERIFICATION_METHODS })
  @IsEnum(PAYOUT_VERIFICATION_METHODS)
  verificationMethod!: PayoutVerificationMethod;

  @ApiPropertyOptional({
    description: 'Tashkilot bank kabinetida saqlangan oluvchi/shablon identifikatori',
    minLength: 3,
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  bankRecipientId?: string;

  @ApiPropertyOptional({
    description: 'Mikro-o‘tkazma yoki bank ko‘chirmasi/shartnoma tasdiq hujjati raqami',
    minLength: 3,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  verificationEvidenceRef?: string;

  @ApiProperty({ description: 'Egalik qanday tekshirilgani haqida izoh', minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  verificationNote!: string;
}

export class RejectPayoutDestinationDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class StaffListPayoutDestinationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PayoutDestinationVerificationStatus })
  @IsOptional()
  @IsEnum(PayoutDestinationVerificationStatus)
  status?: PayoutDestinationVerificationStatus;
}

export class PayoutDestinationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PayoutDestinationType }) type!: PayoutDestinationType;
  @ApiProperty() providerLabel!: string;
  @ApiProperty() maskedValue!: string;
  @ApiProperty() holderName!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) bankName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) mfo!: string | null;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty({ enum: PayoutDestinationVerificationStatus })
  verificationStatus!: PayoutDestinationVerificationStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) bankRecipientId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) verificationMethod!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) verificationEvidenceRef!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) verificationNote!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) verifiedByStaffId!: string | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) verifiedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class StaffPayoutDestinationResponseDto extends PayoutDestinationResponseDto {
  @ApiProperty() sellerId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sellerName?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sellerPhone?: string | null;
}

export function toPayoutDestinationResponseDto(row: SellerPayoutDestination): PayoutDestinationResponseDto {
  return {
    id: row.id,
    type: row.type,
    providerLabel: row.providerLabel,
    maskedValue: row.maskedValue,
    holderName: row.holderName,
    bankName: row.bankName ?? null,
    mfo: row.mfo ?? null,
    isDefault: row.isDefault,
    isVerified: row.isVerified,
    verificationStatus: row.verificationStatus,
    bankRecipientId: row.bankRecipientId ?? null,
    verificationMethod: row.verificationMethod ?? null,
    verificationEvidenceRef: row.verificationEvidenceRef ?? null,
    verificationNote: row.verificationNote ?? null,
    rejectionReason: row.rejectionReason ?? null,
    verifiedByStaffId: row.verifiedByStaffId ?? null,
    verifiedAt: row.verifiedAt ?? null,
    createdAt: row.createdAt,
  };
}

export function toStaffPayoutDestinationResponseDto(
  row: SellerPayoutDestination & { seller?: { fullName: string | null; phone: string } | null },
): StaffPayoutDestinationResponseDto {
  return {
    ...toPayoutDestinationResponseDto(row),
    sellerId: row.sellerId,
    sellerName: row.seller?.fullName ?? null,
    sellerPhone: row.seller?.phone ?? null,
  };
}
