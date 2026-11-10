import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ example: 'user' })
  @IsString()
  @IsIn(['user', 'service', 'job', 'message', 'USER', 'SERVICE', 'JOB', 'MESSAGE'])
  targetType!: string;

  @ApiProperty({ example: 'f87a8b32-...' })
  @IsString()
  @MinLength(1)
  targetId!: string;

  @ApiProperty({ example: 'Elnur Xatamov (Sotuvchi)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  targetTitle!: string;

  @ApiProperty({ example: 'off_platform' })
  @IsString()
  @IsIn([
    'scam',
    'spam',
    'plagiarism',
    'off_platform',
    'inappropriate',
    'fake_profile',
    'copyright',
    'SCAM',
    'SPAM',
    'PLAGIARISM',
    'OFF_PLATFORM',
    'INAPPROPRIATE',
    'FAKE_PROFILE',
    'COPYRIGHT',
  ])
  reasonType!: string;

  @ApiProperty({ example: 'Foydalanuvchi Telegram orqali to‘lov qilishni so‘radi.' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  evidenceUrl?: string;

  @ApiPropertyOptional({ example: 'medium' })
  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high', 'critical', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity?: string;
}
