import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ContractStatus,
  type BankTransferProof,
  type Contract,
  type Milestone,
  type MilestoneRevisionRequest,
  type MilestoneSubmission,
} from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';
import { MilestoneResponseDto, toMilestoneResponseDto } from './milestone-response.dto';

export class ContractBankProofSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() paymentPurposeCode!: string;
  @ApiProperty() declaredAmount!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) receivedAmount!: number | null;
  @ApiProperty() mismatchAmount!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) receiptFileUrl!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) receiptNote!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) bankOperationRef!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) rejectionReason!: string | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) reviewedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

/**
 * Buyer/seller/staff — UCHALASI HAM bir xil DTO (Phase 3'dagi public/owner
 * ikki xillikdan farqli — bu yerda "public" ko'rinish umuman yo'q, faqat
 * ikki tomon + read-only staff, sezgir maydon yo'q).
 */
export class ContractResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() buyerId!: string;
  @ApiProperty() sellerId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) serviceId!: string | null;
  @ApiProperty({ enum: ['SERVICE', 'JOB'] }) sourceType!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) jobId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) proposalId!: string | null;

  @ApiProperty() serviceTitleSnapshot!: string;
  @ApiProperty() serviceDescriptionSnapshot!: string;
  @ApiProperty() categoryNameSnapshot!: string;
  @ApiProperty() sellerDisplayNameSnapshot!: string;

  @ApiProperty({ description: 'Butun so‘m' }) agreedAmount!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() platformFeeRateBps!: number;
  @ApiProperty({ description: 'Butun so‘m — informatsion, hali undirilmagan' })
  platformFeeAmount!: number;

  @ApiProperty() deadline!: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) deliverableSummary!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) acceptanceCriteria!: string | null;
  @ApiProperty() revisionsIncluded!: number;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) buyerConfirmedAt!: Date | null;
  @ApiPropertyOptional({ type: () => Date, nullable: true }) sellerConfirmedAt!: Date | null;
  @ApiProperty({ enum: ContractStatus }) status!: ContractStatus;

  @ApiProperty({ description: 'To‘lov (escrow) muvaffaqiyatli moliyalashtirilganmi' })
  isFunded!: boolean;

  @ApiPropertyOptional({ type: () => Date, nullable: true })
  fundedAt?: Date | null;

  @ApiProperty()
  paymentPurposeCode!: string;

  @ApiProperty()
  autoAcceptPaused!: boolean;

  @ApiPropertyOptional({ type: ContractBankProofSummaryDto, nullable: true })
  latestBankProof?: ContractBankProofSummaryDto | null;

  @ApiProperty({ type: [MilestoneResponseDto] }) milestones!: MilestoneResponseDto[];

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export function toContractResponseDto(
  contract: Contract & {
    milestones?: Array<
      Milestone & {
        submissions?: MilestoneSubmission[];
        revisionRequests?: MilestoneRevisionRequest[];
      }
    >;
    payments?: Array<{ id: string; status: string; succeededAt?: Date | null; createdAt: Date }>;
    bankTransferProofs?: BankTransferProof[];
    disputes?: Array<{ id: string; status: string }>;
  },
): ContractResponseDto {
  const succeededPayment = contract.payments?.find((p) => p.status === 'SUCCEEDED');
  const isFunded = Boolean(succeededPayment);
  const fundedAt = succeededPayment ? (succeededPayment.succeededAt ?? succeededPayment.createdAt) : null;
  const autoAcceptPaused = Boolean(
    contract.disputes?.some((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW'),
  );
  const latestProofRaw = contract.bankTransferProofs?.[0] ?? null;
  const latestBankProof: ContractBankProofSummaryDto | null = latestProofRaw
    ? {
        id: latestProofRaw.id,
        status: latestProofRaw.status,
        paymentPurposeCode: latestProofRaw.paymentPurposeCode,
        declaredAmount: tiyinToSom(latestProofRaw.declaredAmount),
        receivedAmount: latestProofRaw.receivedAmount !== null ? tiyinToSom(latestProofRaw.receivedAmount) : null,
        mismatchAmount: tiyinToSom(latestProofRaw.mismatchAmount),
        receiptFileUrl: latestProofRaw.receiptFileUrl ?? null,
        receiptNote: latestProofRaw.receiptNote ?? null,
        bankOperationRef: latestProofRaw.bankOperationRef ?? null,
        rejectionReason: latestProofRaw.rejectionReason ?? null,
        reviewedAt: latestProofRaw.reviewedAt ?? null,
        createdAt: latestProofRaw.createdAt,
      }
    : null;
  const paymentPurposeCode = `BD-${contract.id.slice(0, 8).toUpperCase()}`;

  return {
    id: contract.id,
    buyerId: contract.buyerId,
    sellerId: contract.sellerId,
    serviceId: contract.serviceId,
    sourceType: contract.sourceType,
    jobId: contract.jobId,
    proposalId: contract.proposalId,
    serviceTitleSnapshot: contract.serviceTitleSnapshot,
    serviceDescriptionSnapshot: contract.serviceDescriptionSnapshot,
    categoryNameSnapshot: contract.categoryNameSnapshot,
    sellerDisplayNameSnapshot: contract.sellerDisplayNameSnapshot,
    agreedAmount: tiyinToSom(contract.agreedAmount),
    currency: contract.currency,
    platformFeeRateBps: contract.platformFeeRateBpsSnapshot,
    platformFeeAmount: tiyinToSom(contract.platformFeeAmountSnapshot),
    deadline: contract.deadline,
    deliverableSummary: contract.deliverableSummary ?? null,
    acceptanceCriteria: contract.acceptanceCriteria ?? null,
    revisionsIncluded: contract.revisionsIncluded ?? 2,
    buyerConfirmedAt: contract.buyerConfirmedAt ?? contract.createdAt,
    sellerConfirmedAt: contract.sellerConfirmedAt ?? null,
    status: contract.status,
    isFunded,
    fundedAt,
    paymentPurposeCode,
    autoAcceptPaused,
    latestBankProof,
    milestones: (contract.milestones ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((m) => toMilestoneResponseDto(m, { autoAcceptPaused })),
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt,
  };
}
