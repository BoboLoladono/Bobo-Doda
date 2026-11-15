import { IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  @IsOptional()
  @IsString()
  idToken?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  googleId?: string;
}
