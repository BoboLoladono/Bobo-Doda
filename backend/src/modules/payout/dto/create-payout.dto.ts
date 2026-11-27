import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { MAX_DESTINATION_REFERENCE_LENGTH } from '../payout.constants';

export class CreatePayoutDto {
  @ApiProperty({ description: 'Butun so‘m', minimum: 1 })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ description: 'Saqlangan to‘lov rekviziti ID (tavsiya etiladi)' })
  @IsOptional()
  @IsUUID()
  destinationId?: string;

  @ApiPropertyOptional({ minLength: 3, maxLength: MAX_DESTINATION_REFERENCE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_DESTINATION_REFERENCE_LENGTH)
  destinationReference?: string;
}
