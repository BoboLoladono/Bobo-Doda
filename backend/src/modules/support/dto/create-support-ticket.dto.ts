import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'texnik' })
  @IsString()
  @IsIn(['tolov', 'shartnoma', 'nizo', 'hisob', 'texnik', 'boshqa'], {
    message: 'Mavzu turi noto‘g‘ri',
  })
  topic!: string;

  @ApiProperty({ example: 'Tizimga kirishda xatolik' })
  @IsString()
  @MinLength(3, { message: 'Mavzu kamida 3 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(200, { message: 'Mavzu ko‘pi bilan 200 ta belgidan oshmasligi kerak' })
  subject!: string;

  @ApiProperty({ example: 'Telefon raqamimga SMS kod kelmayapti, iltimos tekshiring.' })
  @IsString()
  @MinLength(10, { message: 'Xabar kamida 10 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(5000, { message: 'Xabar ko‘pi bilan 5000 ta belgidan oshmasligi kerak' })
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactInfo?: string;
}
