import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class StaffKycReviewDto {
  @ApiProperty({ enum: ['approve', 'reject', 'request_resubmission'], example: 'approve' })
  @IsString()
  @IsNotEmpty()
  @IsIn(['approve', 'reject', 'request_resubmission'])
  outcome!: 'approve' | 'reject' | 'request_resubmission';

  @ApiPropertyOptional({ example: 'Hujjat rasmi xira, iltimos qaytadan aniqroq surat yuklang' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;

  @ApiPropertyOptional({ example: 'Operator eslatmasi' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
