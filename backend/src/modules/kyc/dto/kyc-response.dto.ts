import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KycDocumentStatus, KycVerificationStatus, type KycDocument, type KycVerification } from '@prisma/client';
import { maskIdentifier } from '../util/kyc-cipher.util';

export class KycDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() originalFilename!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() fileSizeBytes!: number;
  @ApiProperty({ enum: KycDocumentStatus }) status!: KycDocumentStatus;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional() viewUrl?: string;
}

export class KycVerificationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: KycVerificationStatus }) rawStatus!: KycVerificationStatus;
  @ApiProperty({ description: 'Frontendga moslashtirilgan holat: korib_chiqilmoqda, tasdiqlangan, rad_etilgan' })
  status!: string;

  @ApiProperty() country!: string;
  @ApiProperty() documentType!: string;
  @ApiProperty() legalName!: string;
  @ApiPropertyOptional() birthDate?: string | null;

  @ApiPropertyOptional() passportNumber?: string;
  @ApiPropertyOptional() inn?: string;
  @ApiPropertyOptional() companyDetails?: string;

  @ApiProperty({ type: [KycDocumentResponseDto] }) documents!: KycDocumentResponseDto[];

  @ApiPropertyOptional() submittedAt?: Date | null;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiPropertyOptional() rejectionReason?: string | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export function mapKycStatusToFrontend(status: KycVerificationStatus): string {
  switch (status) {
    case KycVerificationStatus.APPROVED:
      return 'tasdiqlangan';
    case KycVerificationStatus.REJECTED:
    case KycVerificationStatus.RESUBMISSION_REQUIRED:
      return 'rad_etilgan';
    case KycVerificationStatus.UNDER_REVIEW:
    case KycVerificationStatus.SCANNING:
    case KycVerificationStatus.PENDING:
      return 'korib_chiqilmoqda';
    case KycVerificationStatus.DRAFT:
    default:
      return 'boshlanmagan';
  }
}

export function toKycResponseDto(
  verification: KycVerification & { documents?: KycDocument[] },
  decryptedPii?: { passportNumber?: string; inn?: string; companyDetails?: string },
  isStaff = false,
): KycVerificationResponseDto {
  const birthDateStr = verification.birthDate ? verification.birthDate.toISOString().slice(0, 10) : null;

  // Mask sensitive identity numbers for non-staff or privacy preservation
  const passportNumber = isStaff
    ? decryptedPii?.passportNumber
    : maskIdentifier(decryptedPii?.passportNumber);

  return {
    id: verification.id,
    userId: verification.userId,
    rawStatus: verification.status,
    status: mapKycStatusToFrontend(verification.status),
    country: verification.country,
    documentType: verification.documentType.toLowerCase(),
    legalName: verification.legalName,
    birthDate: birthDateStr,
    passportNumber: passportNumber || undefined,
    inn: decryptedPii?.inn ? (isStaff ? decryptedPii.inn : maskIdentifier(decryptedPii.inn)) : undefined,
    companyDetails: decryptedPii?.companyDetails || undefined,
    documents: (verification.documents ?? []).map((doc) => ({
      id: doc.id,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      status: doc.status,
      createdAt: doc.createdAt,
    })),
    submittedAt: verification.submittedAt,
    reviewedAt: verification.reviewedAt,
    rejectionReason: verification.rejectionReason,
    createdAt: verification.createdAt,
    updatedAt: verification.updatedAt,
  };
}
