import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

const SAFE_LOCAL_UPLOAD_RE = /^\/api\/v1\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|pdf|zip|txt)$/i;

export function IsSafeDeliverableUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeDeliverableUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          const trimmed = value.trim();
          if (SAFE_LOCAL_UPLOAD_RE.test(trimmed)) return true;
          try {
            const parsed = new URL(trimmed);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
          } catch {
            return false;
          }
        },
        defaultMessage() {
          return 'Havola faqat https://, http:// yoki platformaga yuklangan fayl manzili bo‘lishi kerak';
        },
      },
    });
  };
}

export class SubmitMilestoneDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsSafeDeliverableUrl({ each: true })
  deliverableUrls?: string[];
}
