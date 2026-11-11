import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ValidateNested, MaxLength, IsArray, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { MAX_SOM } from '@/common/money/money.util';

class ScreeningAnswerDto {
  @IsString()
  @MaxLength(500)
  question!: string;

  @IsString()
  @MaxLength(5000)
  answer!: string;
}

export class CreateProposalDto {
  @ApiProperty({ description: 'Taklif summasi (kamida 1 000 so‘m)', minimum: 1_000, maximum: MAX_SOM })
  @IsInt()
  @Min(1_000)
  @Max(MAX_SOM)
  bidAmount!: number;

  @ApiProperty({ minLength: 5, maxLength: 5000 })
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  coverLetter!: string;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ScreeningAnswerDto)
  screeningAnswers?: ScreeningAnswerDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @MaxLength(2048, { each: true })
  attachedImages?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  estimatedDeliveryDays?: number;
}
