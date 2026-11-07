import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Profil tahriri — `fullName` va `avatarKey` (rasm / data-URL).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  // Trim VALIDATSIYADAN OLDIN — aks holda "  a  " (bo'sh joylar bilan 5
  // belgi) MinLength(2)'dan o'tib, keyin 1 belgili ismga aylanardi.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  avatarKey?: string | null;
}
