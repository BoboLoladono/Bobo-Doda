import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadFileDto {
  @ApiProperty({ example: 'receipt.pdf' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fileName!: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mimeType?: string;

  @ApiProperty({ description: 'Base64 string or data: URL' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8_000_000)
  dataBase64!: string;
}

export class UploadFileResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() storedName!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() size!: number;
  @ApiProperty() url!: string;
}
