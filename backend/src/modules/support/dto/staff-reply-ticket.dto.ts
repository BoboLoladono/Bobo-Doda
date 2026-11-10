import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class StaffReplyTicketDto {
  @ApiProperty({ example: 'Sizning murojaatingiz bo‘yicha texnik xizmat ko‘rsatildi.' })
  @IsString()
  @MinLength(2, { message: 'Javob matni kamida 2 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(5000, { message: 'Javob matni ko‘pi bilan 5000 ta belgidan oshmasligi kerak' })
  replyText!: string;

  @ApiPropertyOptional({ example: 'javob_berildi' })
  @IsOptional()
  @IsString()
  @IsIn(['OPEN', 'WAITING_USER', 'ANSWERED', 'CLOSED', 'ochiq', 'javob_berildi', 'yopilgan'])
  newStatus?: string;
}
