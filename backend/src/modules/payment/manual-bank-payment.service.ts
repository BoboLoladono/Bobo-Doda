import { Injectable, Optional } from '@nestjs/common';
import { BankTransferProofStatus, Prisma, type BankTransferProof } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { AppConfigService } from '@/config/app-config.service';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import { somToTiyin } from '@/common/money/money.util';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { UploadsService } from '@/modules/uploads/uploads.service';
import type {
  CompanyBankDetailsResponseDto,
  SubmitBankProofDto,
  VerifyBankProofDto,
} from './dto/bank-proof.dto';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class ManualBankPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    private readonly config: AppConfigService,
    @Optional() private readonly uploads?: UploadsService,
  ) {}

  getCompanyBankDetails(): CompanyBankDetailsResponseDto {
    const bank = this.config.companyBankDetails;
    if (!bank.configured) {
      return { configured: false, details: null };
    }
    return {
      configured: true,
      details: {
        companyName: bank.companyName!,
        bankName: bank.bankName!,
        accountNumber: bank.accountNumber!,
        mfo: bank.mfo!,
        inn: bank.inn!,
        bankAddress: bank.bankAddress ?? null,
        supportPhone: bank.supportPhone ?? null,
      },
    };
  }

  private purposeCodeForContract(contractId: string): string {
    return `BD-${contractId.slice(0, 8).toUpperCase()}`;
  }

  async submitProof(
    contractId: string,
    buyerId: string,
    dto: SubmitBankProofDto,
    actor: AuditActor,
  ): Promise<BankTransferProof> {
    if (!this.config.companyBankDetails.configured) {
      throw new DomainError(
        'FEATURE_DISABLED',
        'Tashkilot bank rekvizitlari hali kiritilmagan — qo‘lda bank o‘tkazmasi yopiq',
      );
    }
    const receiptFileUrl = dto.receiptFileUrl?.trim() || null;
    const receiptNote = dto.receiptNote?.trim() || null;
    if (!receiptFileUrl && !receiptNote) {
      throw new DomainError(
        'INVALID_INPUT',
        'Chek fayli yoki o‘tkazma izohidan kamida bittasini yuboring',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
      const contract = await tx.contract.findFirst({ where: { id: contractId, buyerId } });
      if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
      if (contract.status !== 'ACTIVE') {
        throw new DomainError(
          'PAYMENT_NOT_ALLOWED',
          'Faqat ikki tomon tasdiqlagan (ACTIVE) shartnoma uchun to‘lov cheki yuboriladi',
        );
      }
      const existingPayment = await tx.payment.findFirst({
        where: { contractId, status: 'SUCCEEDED' },
        select: { id: true },
      });
      if (existingPayment) {
        throw new DomainError('PAYMENT_ALREADY_SUCCEEDED', 'Shartnoma allaqachon to‘langan');
      }

      const declaredAmount = dto.declaredAmount ? somToTiyin(dto.declaredAmount) : contract.agreedAmount;
      const proofId = this.ids.next();
      const paymentPurposeCode = this.purposeCodeForContract(contractId);

      const created = await tx.bankTransferProof.create({
        data: {
          id: proofId,
          contractId,
          buyerId,
          paymentPurposeCode,
          declaredAmount,
          receiptFileUrl,
          receiptNote,
          status: 'PENDING_REVIEW',
        },
      });

      if (receiptFileUrl && this.uploads) {
        await this.uploads.attachBankProofUpload(tx, {
          receiptFileUrl,
          contractId,
          buyerId,
          bankProofId: proofId,
        });
      }

      await this.audit.record(
        {
          actor,
          action: 'BANK_PROOF_SUBMITTED',
          resourceType: 'BANK_TRANSFER_PROOF',
          resourceId: proofId,
          contextId: contractId,
          newState: {
            status: 'PENDING_REVIEW',
            paymentPurposeCode,
            declaredAmount: declaredAmount.toString(),
          },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'CONTRACT',
          aggregateId: contractId,
          eventType: 'BANK_PROOF_SUBMITTED',
          payload: { proofId, buyerId },
        },
        tx,
      );

      return created;
    });
  }

  async listForBuyerContract(contractId: string, buyerId: string): Promise<BankTransferProof[]> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, buyerId },
      select: { id: true },
    });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
    return this.prisma.bankTransferProof.findMany({
      where: { contractId, buyerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForStaff(
    filters: { status?: BankTransferProofStatus; contractId?: string },
    page: number,
    perPage: number,
  ): Promise<
    Page<
      BankTransferProof & {
        contract: { serviceTitleSnapshot: string; agreedAmount: bigint };
        buyer: { fullName: string | null; phone: string };
      }
    >
  > {
    const where: Prisma.BankTransferProofWhereInput = {
      status: filters.status,
      contractId: filters.contractId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bankTransferProof.findMany({
        where,
        include: {
          contract: { select: { serviceTitleSnapshot: true, agreedAmount: true } },
          buyer: { select: { fullName: true, phone: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.bankTransferProof.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  async verifyProof(
    proofId: string,
    staffId: string,
    dto: VerifyBankProofDto,
    actor: AuditActor,
  ): Promise<BankTransferProof> {
    const ref = dto.bankOperationRef.trim();
    const receivedTiyin = somToTiyin(dto.receivedAmount);
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM bank_transfer_proofs WHERE id = ${proofId}::uuid FOR UPDATE`;
        const proof = await tx.bankTransferProof.findUnique({ where: { id: proofId } });
        if (!proof) throw new NotFoundError('Kvitansiya topilmadi', 'BANK_PROOF_NOT_FOUND');

        if (!['PENDING_REVIEW', 'UNDERPAID', 'OVERPAID_REVIEW'].includes(proof.status)) {
          throw new DomainError('INVALID_TRANSITION', 'Bu kvitansiya allaqachon yakuniy ko‘rib chiqilgan');
        }

        await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${proof.contractId}::uuid FOR UPDATE`;
        const contract = await tx.contract.findUniqueOrThrow({ where: { id: proof.contractId } });
        if (contract.status !== 'ACTIVE') {
          throw new DomainError('INVALID_TRANSITION', 'Shartnoma ACTIVE holatda emas — mablag‘lash mumkin emas');
        }

        const alreadyFunded = await tx.payment.findFirst({
          where: { contractId: contract.id, status: 'SUCCEEDED' },
          select: { id: true },
        });
        if (alreadyFunded) {
          throw new DomainError('PAYMENT_ALREADY_SUCCEEDED', 'Bu shartnoma allaqachon moliyalashtirilgan');
        }

        const duplicateRef = await tx.bankTransferProof.findFirst({
          where: { bankOperationRef: ref, id: { not: proofId } },
          select: { id: true, contractId: true },
        });
        if (duplicateRef) {
          throw new DomainError(
            'DUPLICATE_BANK_REF',
            `Bu bank operatsiya raqami (${ref}) boshqa buyurtmaga allaqachon biriktirilgan`,
          );
        }

        const mismatch = receivedTiyin - contract.agreedAmount;

        // Underpaid -> record exact shortfall, do NOT mark contract funded
        if (mismatch < 0n) {
          const underpaid = await tx.bankTransferProof.update({
            where: { id: proofId },
            data: {
              status: 'UNDERPAID',
              receivedAmount: receivedTiyin,
              mismatchAmount: mismatch,
              bankOperationRef: ref,
              rejectionReason:
                dto.note?.trim() ||
                `Kam summa tushgan: kutilgan ${contract.agreedAmount / 100n} so‘m, tushdi ${dto.receivedAmount} so‘m`,
              reviewedByStaffId: staffId,
              reviewedAt: now,
            },
          });
          await this.audit.record(
            {
              actor,
              action: 'BANK_PROOF_UNDERPAID',
              resourceType: 'BANK_TRANSFER_PROOF',
              resourceId: proofId,
              contextId: contract.id,
              previousState: { status: proof.status },
              newState: {
                status: 'UNDERPAID',
                receivedAmount: receivedTiyin.toString(),
                mismatchAmount: mismatch.toString(),
                bankOperationRef: ref,
              },
            },
            tx,
          );
          return underpaid;
        }

        // Overpaid without explicit admin confirmation of surplus handling -> hold in OVERPAID_REVIEW
        if (mismatch > 0n && !dto.allowOverpaymentSurplus) {
          const overpaid = await tx.bankTransferProof.update({
            where: { id: proofId },
            data: {
              status: 'OVERPAID_REVIEW',
              receivedAmount: receivedTiyin,
              mismatchAmount: mismatch,
              rejectionReason:
                dto.note?.trim() ||
                `Ortiqcha summa tushgan (+${mismatch / 100n} so‘m). Ortiqcha qismini qaytarish rejasini tasdiqlang.`,
              reviewedByStaffId: staffId,
              reviewedAt: now,
            },
          });
          await this.audit.record(
            {
              actor,
              action: 'BANK_PROOF_OVERPAID_REVIEW',
              resourceType: 'BANK_TRANSFER_PROOF',
              resourceId: proofId,
              contextId: contract.id,
              previousState: { status: proof.status },
              newState: {
                status: 'OVERPAID_REVIEW',
                receivedAmount: receivedTiyin.toString(),
                mismatchAmount: mismatch.toString(),
              },
            },
            tx,
          );
          return overpaid;
        }

        // Exact match (or confirmed surplus handling): create authoritative Payment(SUCCEEDED) + fund ESCROW ledger
        const paymentId = this.ids.next();
        const payment = await tx.payment.create({
          data: {
            id: paymentId,
            contractId: contract.id,
            payerUserId: contract.buyerId,
            provider: 'MANUAL_BANK',
            providerPaymentId: ref,
            amount: contract.agreedAmount,
            currency: contract.currency,
            status: 'SUCCEEDED',
            providerCreatedAt: now,
            succeededAt: now,
          },
        });

        const fundingTx = await this.ledger.fundPayment(tx, payment);

        const approved = await tx.bankTransferProof.update({
          where: { id: proofId },
          data: {
            status: 'APPROVED',
            paymentId: payment.id,
            receivedAmount: receivedTiyin,
            mismatchAmount: mismatch,
            bankOperationRef: ref,
            rejectionReason: mismatch > 0n ? (dto.note?.trim() || `Ortiqcha qism (+${mismatch / 100n} so‘m) qaytarish uchun belgilandi`) : null,
            reviewedByStaffId: staffId,
            reviewedAt: now,
          },
        });

        await this.audit.record(
          {
            actor,
            action: 'PAYMENT_SUCCEEDED',
            resourceType: 'PAYMENT',
            resourceId: payment.id,
            contextId: contract.id,
            newState: {
              status: 'SUCCEEDED',
              provider: 'MANUAL_BANK',
              bankOperationRef: ref,
              amount: contract.agreedAmount.toString(),
              ledgerTxId: fundingTx?.id ?? null,
            },
          },
          tx,
        );
        await this.audit.record(
          {
            actor,
            action: 'BANK_PROOF_APPROVED',
            resourceType: 'BANK_TRANSFER_PROOF',
            resourceId: proofId,
            contextId: contract.id,
            previousState: { status: proof.status },
            newState: {
              status: 'APPROVED',
              paymentId: payment.id,
              bankOperationRef: ref,
              receivedAmount: receivedTiyin.toString(),
              mismatchAmount: mismatch.toString(),
            },
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            aggregateType: 'PAYMENT',
            aggregateId: payment.id,
            eventType: 'PAYMENT_SUCCEEDED',
            payload: { contractId: contract.id, provider: 'MANUAL_BANK' },
          },
          tx,
        );

        return approved;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        const msg = err.message;
        if (msg.includes('bankOperationRef')) {
          throw new DomainError(
            'DUPLICATE_BANK_REF',
            `Bu bank operatsiya raqami (${ref}) boshqa buyurtmaga allaqachon ishlatilgan`,
          );
        }
        throw new DomainError('PAYMENT_ALREADY_SUCCEEDED', 'Bu shartnoma allaqachon moliyalashtirilgan');
      }
      throw err;
    }
  }

  async rejectProof(
    proofId: string,
    staffId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<BankTransferProof> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bank_transfer_proofs WHERE id = ${proofId}::uuid FOR UPDATE`;
      const proof = await tx.bankTransferProof.findUnique({ where: { id: proofId } });
      if (!proof) throw new NotFoundError('Kvitansiya topilmadi', 'BANK_PROOF_NOT_FOUND');
      if (!['PENDING_REVIEW', 'UNDERPAID', 'OVERPAID_REVIEW'].includes(proof.status)) {
        throw new DomainError('INVALID_TRANSITION', 'Bu kvitansiya allaqachon yakunlangan');
      }
      const updated = await tx.bankTransferProof.update({
        where: { id: proofId },
        data: {
          status: 'REJECTED',
          rejectionReason: reason.trim(),
          reviewedByStaffId: staffId,
          reviewedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'BANK_PROOF_REJECTED',
          resourceType: 'BANK_TRANSFER_PROOF',
          resourceId: proofId,
          contextId: proof.contractId,
          previousState: { status: proof.status },
          newState: { status: 'REJECTED', reason: reason.trim() },
        },
        tx,
      );
      return updated;
    });
  }
}
