import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class HireMilestoneDto {
  @ApiProperty({ example: '1-bosqich: Boshlang‘ich ishlar' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ example: 'Bajariladigan ishlar tavsifi' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Butun so‘mda', example: 500000 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ example: '2026-12-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class HireProposalDto {
  @ApiPropertyOptional({ description: 'Topshiriladigan natija tavsifi', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliverableSummary?: string;

  @ApiPropertyOptional({ description: 'Qabul mezoni', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  acceptanceCriteria?: string;

  @ApiPropertyOptional({ description: 'Kelishilgan tuzatishlar soni', minimum: 0, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  revisionsIncluded?: number;

  @ApiPropertyOptional({ type: [HireMilestoneDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => HireMilestoneDto)
  milestones?: HireMilestoneDto[];
}
