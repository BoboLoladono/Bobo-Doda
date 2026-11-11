import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
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
  @ApiPropertyOptional({ type: [HireMilestoneDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => HireMilestoneDto)
  milestones?: HireMilestoneDto[];
}
