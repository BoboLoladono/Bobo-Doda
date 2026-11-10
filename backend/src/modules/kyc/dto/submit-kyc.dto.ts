import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycDocumentType } from '@prisma/client';
import { ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SubmitKycDto {
  @ApiProperty({ example: 'UZ' })
  @IsString()
  @IsNotEmpty()
  country!: string;

  @ApiProperty({ enum: KycDocumentType, example: KycDocumentType.PASSPORT })
  @IsEnum(KycDocumentType)
  documentType!: KycDocumentType;

  @ApiProperty({ example: 'Alisher Navoiy' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(120)
  legalName!: string;

  @ApiProperty({ example: '1995-05-15' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Tug‘ilgan sana YYYY-MM-DD formatida bo‘lishi kerak' })
  birthDate!: string;

  @ApiProperty({
    description: 'Kamida 2 ta hujjatning base64 ma’lumotlari yoki data-URL',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(2, { message: 'Kamida 2 ta hujjat yuklanishi shart (masalan old va orqa tomoni)' })
  documents!: string[];

  @ApiPropertyOptional({ example: 'AA1234567' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  passportNumber?: string;

  @ApiPropertyOptional({ example: '123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  inn?: string;

  @ApiPropertyOptional({ example: 'MChJ "Bobo-Doda xizmatlari"' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyDetails?: string;
}
