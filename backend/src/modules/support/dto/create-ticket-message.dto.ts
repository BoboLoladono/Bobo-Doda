import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTicketMessageDto {
  @ApiProperty({ example: 'Rahmat, muammo bartaraf etildi.' })
  @IsString()
  @MinLength(2, { message: 'Xabar kamida 2 ta belgidan iborat bo‘lishi kerak' })
  @MaxLength(5000, { message: 'Xabar ko‘pi bilan 5000 ta belgidan oshmasligi kerak' })
  text!: string;
}
