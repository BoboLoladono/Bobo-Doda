import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class StaffCloseTicketDto {
  @ApiProperty({ example: 'Murojaat muvaffaqiyatli hal qilindi' })
  @IsString()
  @MinLength(3, { message: 'Yopish sababi kamida 3 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(500, { message: 'Yopish sababi ko‘pi bilan 500 ta belgidan oshmasligi kerak' })
  note!: string;
}
