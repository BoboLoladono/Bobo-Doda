import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_SOM } from '@/common/money/money.util';

export class CreateJobDto {
  @ApiProperty({ description: 'Kategoriya slug yoki UUID' })
  @IsString()
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @MaxLength(100)
  @MinLength(1)
  category!: string;

  @ApiProperty({ minLength: 5, maxLength: 200 })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  title!: string;

  @ApiProperty({ minLength: 20, maxLength: 5000 })
  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  description!: string;

  @ApiProperty({ description: 'Minimal byudjet (butun so‘m, kamida 1 000)', minimum: 1_000, maximum: MAX_SOM })
  @IsInt()
  @Min(1_000)
  @Max(MAX_SOM)
  budgetMin!: number;

  @ApiProperty({ description: 'Maksimal byudjet (butun so‘m, kamida 1 000)', minimum: 1_000, maximum: MAX_SOM })
  @IsInt()
  @Min(1_000)
  @Max(MAX_SOM)
  budgetMax!: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @MaxLength(100, { each: true })
  skillsRequired?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Maksimal 3 ta savol' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  @MaxLength(500, { each: true })
  screeningQuestions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ type: [String], description: 'Ixtiyoriy ilova qilingan rasmlar/fayllar' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @MaxLength(2048, { each: true })
  attachedImages?: string[];
}
