import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAppealDto {
  @ApiProperty({ example: 'blocked' })
  @IsString()
  @IsIn(['suspended', 'blocked', 'restricted', 'SUSPENDED', 'BLOCKED', 'RESTRICTED'])
  restrictionType!: string;

  @ApiProperty({ example: 'Shubhali faoliyat tufayli' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  originalReason!: string;

  @ApiProperty({ example: 'Mening hisobim noto‘g‘ri bloklangan, barcha qoidalar bo‘yicha ishlaganman.' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  appealText!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];
}
