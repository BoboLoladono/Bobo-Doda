import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StaffUpdateReportDto {
  @ApiProperty({ example: 'resolved' })
  @IsString()
  @IsIn(['investigating', 'resolved', 'dismissed', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'])
  action!: string;

  @ApiProperty({ example: 'Foydalanuvchiga qoidalarni buzgani uchun ogohlantirish berildi.' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional({ example: 'warned' })
  @IsOptional()
  @IsString()
  @IsIn([
    'none',
    'warned',
    'restricted',
    'suspended',
    'removed',
    'NONE',
    'WARNED',
    'RESTRICTED',
    'SUSPENDED',
    'REMOVED',
  ])
  userAction?: string;
}
