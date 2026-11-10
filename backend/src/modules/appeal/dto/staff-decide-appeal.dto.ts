import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class StaffDecideAppealDto {
  @ApiProperty({ example: 'accepted' })
  @IsString()
  @IsIn(['accepted', 'rejected', 'ACCEPTED', 'REJECTED'])
  decision!: string;

  @ApiProperty({ example: 'Foydalanuvchi ma‘lumotlari tasdiqlandi, hisob tiklandi.' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;
}
