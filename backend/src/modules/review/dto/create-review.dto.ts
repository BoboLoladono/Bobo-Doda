import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt({ message: 'Reyting 1 dan 5 gacha butun son bo‘lishi kerak' })
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ example: 'Ajoyib mutaxassis, ishni muddatidan oldin bajardi!' })
  @IsString()
  @MinLength(5, { message: 'Sharh kamida 5 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(1000, { message: 'Sharh ko‘pi bilan 1000 ta belgidan oshmasligi kerak' })
  comment!: string;
}
