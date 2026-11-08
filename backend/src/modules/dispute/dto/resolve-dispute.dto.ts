import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, MaxLength, Min, MinLength, Validate, ValidateIf, ValidatorConstraint, type ValidationArguments, type ValidatorConstraintInterface } from 'class-validator';
import { MAX_SOM } from '@/common/money/money.util';
import { parseDisputeAwards } from '../dispute-award.util';

@ValidatorConstraint({ name: 'completeExclusiveAwardPair', async: false })
class CompleteExclusiveAwardPair implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    try {
      parseDisputeAwards(args.object);
      return true;
    } catch {
      return false;
    }
  }
  defaultMessage(): string {
    return 'Provide both whole-so‘m awards or both exact tiyin awards, never mixed units';
  }
}

/** Staff selects a partition only; the service enforces its sum against the locked held amount. */
export class ResolveDisputeDto {
  @ApiPropertyOptional({ description: 'Legacy whole so‘m; provide both fields, without tiyin fields', minimum: 0, maximum: MAX_SOM })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_SOM)
  buyerAwardAmount?: number;

  @ApiPropertyOptional({ description: 'Legacy whole so‘m; provide both fields, without tiyin fields', minimum: 0, maximum: MAX_SOM })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_SOM)
  sellerAwardAmount?: number;

  @ApiPropertyOptional({ description: 'Exact nonnegative integer tiyin string; provide both tiyin fields without legacy fields', pattern: '^(0|[1-9][0-9]{0,12})$', example: '95' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,12})$/)
  buyerAwardAmountTiyin?: string;

  @ApiPropertyOptional({ description: 'Exact nonnegative integer tiyin string; provide both tiyin fields without legacy fields', pattern: '^(0|[1-9][0-9]{0,12})$', example: '0' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^(0|[1-9][0-9]{0,12})$/)
  sellerAwardAmountTiyin?: string;

  @ApiProperty({ minLength: 10, maxLength: 1000 })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  @Validate(CompleteExclusiveAwardPair)
  resolutionReason!: string;
}
