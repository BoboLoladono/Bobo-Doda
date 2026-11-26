import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PayoutDestinationType, type SellerPayoutDestination } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
    description: '16 xonali karta raqami yoki 20 xonali bank hisob raqami — saqlashdan oldin maskalanadi (CVV/PIN qabul qilinmaydi)',
    example: '8600123456789012',
  })
  @IsString()
  @Matches(/^[\d\s*•]{4,32}$/, { message: 'Faqat karta yoki hisob raqamini kiriting (CVV/PIN kiritmang)' })
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
  @ApiProperty() createdAt!: Date;
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
    createdAt: row.createdAt,
  };
}
