import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Payout, type PayoutCorrection } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, InvariantViolationError, NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { somToTiyin, tiyinToSom } from '@/common/money/money.util';
import { SUPPORTED_PAYMENT_CURRENCIES } from '@/common/money/currency.constant';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { LedgerService } from '@/modules/ledger/ledger.service';
import {
  PAYOUT_PROVIDER,
  type PayoutProvider,
  type VerifiedPayoutWebhookEvent,
} from './providers/payout-provider.interface';
import { PAYOUT_NON_TERMINAL_STATUSES } from './payout.constants';

const PRISMA_UNIQUE_VIOLATION = 'P2002';
const CURRENCY = SUPPORTED_PAYMENT_CURRENCIES[0];

const SYSTEM_ACTOR: AuditActor = { id: null, type: 'SYSTEM', name: 'payout-provider' };

type PayoutEventOutcome = 'APPLIED' | 'NOOP_ALREADY_TARGET' | 'MISMATCH' | 'UNKNOWN_PAYOUT' | 'CONFLICT';

/**
 * `Payout` — bo'lim 19-35: seller `SELLER_PAYABLE` balansidan RESERV
 * qilingan mablag'ni tashqi providerga chiqaradi. **Reservation DARHOL**
 * (Payout yaratilgan zahoti, tashqi chaqiruvdan OLDIN — bo'lim 23/25/50):
 * ikkinchi parallel so'rov shu pulni QAYTA ISHLATA OLMAYDI, chunki
 * `LedgerService.lockSellerPayableBalance()` `FOR UPDATE` orqali serializatsiya
 * qiladi (bo'lim 22/26/62 — eng muhim payout testi).
 */
@Injectable()
export class PayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {}

  // ── Yaratish (reservation, atomik) ───────────────────────────────────

  async create(
    sellerId: string,
    amountSom: number,
    destinationReferenceInput: string | undefined,
    actor: AuditActor,
    destinationId?: string,
  ): Promise<Payout> {
    const amountTiyin = somToTiyin(amountSom);
    const payoutId = this.ids.next();

    let resolvedRef = destinationReferenceInput?.trim() ?? '';
    let snapshot: Prisma.InputJsonValue | undefined;

    if (destinationId) {
      const dest = await this.prisma.sellerPayoutDestination.findFirst({
        where: { id: destinationId, sellerId, deletedAt: null },
      });
      if (!dest) {
        throw new NotFoundError('Saqlangan to‘lov rekviziti topilmadi', 'PAYOUT_DESTINATION_NOT_FOUND');
      }
      resolvedRef = `${dest.providerLabel} ${dest.maskedValue} (${dest.holderName})`;
      snapshot = {
        id: dest.id,
        type: dest.type,
        providerLabel: dest.providerLabel,
        maskedValue: dest.maskedValue,
        holderName: dest.holderName,
        bankName: dest.bankName ?? null,
        mfo: dest.mfo ?? null,
      };
    } else if (resolvedRef.length < 3) {
      throw new DomainError('INVALID_INPUT', 'To‘lov rekvizitini tanlang yoki kiriting');
    }

    let payout: Payout;
    try {
      payout = await this.prisma.$transaction(async (tx) => {
        const { balance } = await this.ledger.lockSellerPayableBalance(tx, sellerId, CURRENCY);
        if (amountTiyin > balance) {
          throw new DomainError('INSUFFICIENT_BALANCE', 'Yechish mumkin bo‘lgan balans yetarli emas');
        }

        const created = await tx.payout.create({
          data: {
            id: payoutId,
            sellerId,
            amount: amountTiyin,
            currency: CURRENCY,
            destinationReference: resolvedRef,
            destinationId: destinationId ?? null,
            destinationSnapshot: snapshot,
            provider: this.provider.name,
            status: 'PENDING',
          },
        });
        await this.audit.record(
          {
            actor,
            action: 'PAYOUT_CREATED',
            resourceType: 'PAYOUT',
            resourceId: payoutId,
            contextId: sellerId,
            newState: { status: 'PENDING', amount: amountTiyin.toString(), currency: CURRENCY },
          },
          tx,
        );

        const reservation = await this.ledger.reservePayout(tx, created);
        if (reservation) {
          await this.audit.record(
            {
              actor: SYSTEM_ACTOR,
              action: 'LEDGER_PAYOUT_RESERVED',
              resourceType: 'LEDGER_TRANSACTION',
              resourceId: reservation.id,
              contextId: payoutId,
              newState: { sellerId, amount: amountTiyin.toString(), currency: CURRENCY },
            },
            tx,
          );
        }
        await this.outbox.enqueue(
          { aggregateType: 'PAYOUT', aggregateId: payoutId, eventType: 'PAYOUT_RESERVED', payload: { sellerId } },
          tx,
        );

        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        // Amalda bo'lmasligi kerak (`payout.id` — yangi UUIDv7) — himoya sifatida.
        throw new InvariantViolationError('Payout yaratishda kutilmagan konflikt', { payoutId });
      }
      throw err;
    }

    // Bo'lim 29 — provider HTTP chaqiruvi DB tranzaksiyasi TASHQARISIDA.
    return this.callProviderAndAdvance(payout);
  }

  private async callProviderAndAdvance(payout: Payout): Promise<Payout> {
    if (this.provider.name === 'MANUAL') {
      // Qo'lda bank o'tkazmasi rejimi: tashqi adapter chaqirilmaydi,
      // admin "Ishlovga olish" / "O'tkazilganini qayd etish" amalini kutadi.
      return payout;
    }

    let result;
    try {
      result = await this.provider.createPayout({
        payoutId: payout.id,
        sellerId: payout.sellerId,
        destinationReference: payout.destinationReference,
        amountTiyin: payout.amount,
        currency: payout.currency,
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === 'PAYOUT_PROVIDER_ERROR') {
        // Deterministik rad — provider ANIQ hech narsa yaratmadi, xavfsiz
        // FAILED + rezervatsiya release (bo'lim 31).
        await this.markFailed(payout.id, err.message);
      }
      // `PAYOUT_PROVIDER_UNAVAILABLE` (ambiguous) — Payout ATAYLAB PENDING'da
      // qoladi, mablag' PAYOUT_CLEARING'da rezerv holicha qoladi (bo'lim 48:
      // ko'r-ko'rona qayta chaqirilmaydi/release qilinmaydi).
      throw err;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.payout.updateMany({
        where: { id: payout.id, status: 'PENDING' },
        data: { status: 'PROCESSING', providerPayoutId: result.providerPayoutId, processingAt: new Date() },
      });
      if (cas.count === 0) return null;
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYOUT_PROCESSING',
          resourceType: 'PAYOUT',
          resourceId: payout.id,
          contextId: payout.sellerId,
          previousState: { status: 'PENDING' },
          newState: { status: 'PROCESSING' },
        },
        tx,
      );
      return tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
    });
    return updated ?? (await this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } }));
  }

  private async markFailed(payoutId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.payout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      if (cas.count === 0) return;
      const failed = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });

      const release = await this.ledger.releasePayout(tx, failed);
      if (release) {
        await this.audit.record(
          {
            actor: SYSTEM_ACTOR,
            action: 'LEDGER_PAYOUT_RELEASED',
            resourceType: 'LEDGER_TRANSACTION',
            resourceId: release.id,
            contextId: payoutId,
            newState: { sellerId: failed.sellerId, amount: failed.amount.toString() },
          },
          tx,
        );
      }
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYOUT_FAILED',
          resourceType: 'PAYOUT',
          resourceId: payoutId,
          contextId: failed.sellerId,
          previousState: { status: 'PENDING' },
          newState: { status: 'FAILED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        { aggregateType: 'PAYOUT', aggregateId: payoutId, eventType: 'PAYOUT_FAILED', payload: { sellerId: failed.sellerId } },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'PAYOUT',
          aggregateId: payoutId,
          eventType: 'SELLER_FUNDS_RELEASED',
          payload: { sellerId: failed.sellerId, amount: failed.amount.toString() },
        },
        tx,
      );
    });
  }

  // ── O'qish (egalik query-scope'da) ───────────────────────────────────

  async getSellerOwnedOrThrow(id: string, sellerId: string): Promise<Payout> {
    const payout = await this.prisma.payout.findFirst({ where: { id, sellerId } });
    if (!payout) throw new NotFoundError('Payout topilmadi', 'PAYOUT_NOT_FOUND');
    return payout;
  }

  async getByIdOrThrow(
    id: string,
  ): Promise<Payout & { seller?: { fullName: string | null; phone: string }; corrections?: PayoutCorrection[] }> {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
      include: {
        seller: { select: { fullName: true, phone: true } },
        corrections: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!payout) throw new NotFoundError('Payout topilmadi', 'PAYOUT_NOT_FOUND');
    return payout;
  }

  async listForSeller(sellerId: string, page: number, perPage: number, status?: Payout['status']): Promise<Page<Payout>> {
    const where: Prisma.PayoutWhereInput = { sellerId, status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.payout.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  async listForStaff(
    filters: { status?: Payout['status']; sellerId?: string },
    page: number,
    perPage: number,
  ): Promise<Page<Payout & { seller?: { fullName: string | null; phone: string }; corrections?: PayoutCorrection[] }>> {
    const where: Prisma.PayoutWhereInput = { status: filters.status, sellerId: filters.sellerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payout.findMany({
        where,
        include: {
          seller: { select: { fullName: true, phone: true } },
          corrections: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.payout.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  // ── Staff qo'lda bank o'tkazmasi workflow (First Release) ───────────────

  async startProcessing(payoutId: string, staffId: string, actor: AuditActor): Promise<Payout> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.payout.updateMany({
        where: { id: payoutId, status: 'PENDING' },
        data: { status: 'PROCESSING', processingAt: new Date(), processedByStaffId: staffId },
      });
      if (cas.count === 0) return null;

      const fresh = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_PROCESSING_CLAIMED',
          resourceType: 'PAYOUT',
          resourceId: payoutId,
          contextId: fresh.sellerId,
          previousState: { status: 'PENDING' },
          newState: { status: 'PROCESSING', processedByStaffId: staffId },
        },
        tx,
      );
      return fresh;
    });
    if (!updated) {
      const exists = await this.prisma.payout.findUnique({ where: { id: payoutId }, select: { id: true } });
      if (!exists) throw new NotFoundError('Payout topilmadi', 'PAYOUT_NOT_FOUND');
      throw new DomainError(
        'PAYOUT_ALREADY_CLAIMED',
        'Bu so‘rov allaqachon boshqa admin tomonidan ishlovga olingan yoki yakunlangan',
      );
    }
    return updated;
  }

  async markManualPaid(
    payoutId: string,
    staffId: string,
    input: { bankOperationRef: string; transferredAmount: number; bankTransferredAt?: string; note?: string },
    actor: AuditActor,
  ): Promise<Payout> {
    const ref = input.bankOperationRef.trim();
    const transferredTiyin = somToTiyin(input.transferredAmount);
    const transferredAt = input.bankTransferredAt ? new Date(input.bankTransferredAt) : new Date();
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
        const payout = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!payout) throw new NotFoundError('Payout topilmadi', 'PAYOUT_NOT_FOUND');
        if (!PAYOUT_NON_TERMINAL_STATUSES.includes(payout.status)) {
          throw new DomainError('INVALID_TRANSITION', 'Bu payout so‘rovi allaqachon yakunlangan');
        }
        if (transferredTiyin !== payout.amount) {
          throw new DomainError(
            'PAYOUT_AMOUNT_MISMATCH',
            `O‘tkazilgan summa (${input.transferredAmount} so‘m) so‘ralgan summaga (${tiyinToSom(payout.amount)} so‘m) teng bo‘lishi shart`,
          );
        }

        const dup = await tx.payout.findFirst({
          where: { bankOperationRef: ref, id: { not: payoutId } },
          select: { id: true },
        });
        if (dup) {
          throw new DomainError('DUPLICATE_BANK_REF', `Bank hujjat raqami (${ref}) boshqa to‘lovda allaqachon ishlatilgan`);
        }

        const cas = await tx.payout.updateMany({
          where: { id: payoutId, status: { in: ['PENDING', 'PROCESSING'] } },
          data: {
            status: 'SUCCEEDED',
            bankOperationRef: ref,
            bankTransferredAt: transferredAt,
            transferredAmount: transferredTiyin,
            processedByStaffId: staffId,
            succeededAt: now,
          },
        });
        if (cas.count === 0) {
          throw new DomainError('INVALID_TRANSITION', 'Payout holati o‘zgargan, sahifani yangilang');
        }

        const updated = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
        await this.audit.record(
          {
            actor,
            action: 'PAYOUT_MANUALLY_PAID',
            resourceType: 'PAYOUT',
            resourceId: payoutId,
            contextId: payout.sellerId,
            previousState: { status: payout.status },
            newState: {
              status: 'SUCCEEDED',
              bankOperationRef: ref,
              transferredAmount: transferredTiyin.toString(),
              bankTransferredAt: transferredAt.toISOString(),
              note: input.note?.trim() ?? null,
            },
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            aggregateType: 'PAYOUT',
            aggregateId: payoutId,
            eventType: 'PAYOUT_SUCCEEDED',
            payload: { sellerId: payout.sellerId, bankOperationRef: ref },
          },
          tx,
        );
        return updated;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        throw new DomainError('DUPLICATE_BANK_REF', `Bank hujjat raqami (${ref}) boshqa to‘lovda allaqachon ishlatilgan`);
      }
      throw err;
    }
  }

  async rejectManual(
    payoutId: string,
    staffId: string,
    reason: string,
    actor: AuditActor,
  ): Promise<Payout> {
    const cleanReason = reason.trim();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new NotFoundError('Payout topilmadi', 'PAYOUT_NOT_FOUND');
      if (!PAYOUT_NON_TERMINAL_STATUSES.includes(payout.status)) {
        throw new DomainError('INVALID_TRANSITION', 'Bu payout so‘rovi allaqachon yakunlangan');
      }

      const cas = await tx.payout.updateMany({
        where: { id: payoutId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          failureReason: cleanReason,
          processedByStaffId: staffId,
        },
      });
      if (cas.count === 0) {
        throw new DomainError('INVALID_TRANSITION', 'Payout holati o‘zgargan, sahifani yangilang');
      }

      const failed = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      const release = await this.ledger.releasePayout(tx, failed);
      if (release) {
        await this.audit.record(
          {
            actor,
            action: 'LEDGER_PAYOUT_RELEASED',
            resourceType: 'LEDGER_TRANSACTION',
            resourceId: release.id,
            contextId: payoutId,
            newState: { sellerId: failed.sellerId, amount: failed.amount.toString() },
          },
          tx,
        );
      }
      await this.audit.record(
        {
          actor,
          action: 'PAYOUT_MANUALLY_REJECTED',
          resourceType: 'PAYOUT',
          resourceId: payoutId,
          contextId: failed.sellerId,
          previousState: { status: payout.status },
          newState: { status: 'FAILED', failureReason: cleanReason },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'PAYOUT',
          aggregateId: payoutId,
          eventType: 'PAYOUT_FAILED',
          payload: { sellerId: failed.sellerId, reason: cleanReason },
        },
        tx,
      );
      return failed;
    });
  }

  async correctManualPaid(
    payoutId: string,
    staffId: string,
    input: { bankOperationRef?: string; bankTransferredAt?: string; reason: string },
    actor: AuditActor,
  ): Promise<Payout> {
    const newRef = input.bankOperationRef?.trim();
    const newDate = input.bankTransferredAt ? new Date(input.bankTransferredAt) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
        const payout = await tx.payout.findUnique({ where: { id: payoutId } });
        if (!payout) throw new NotFoundError('Payout topilmadi', 'PAYOUT_NOT_FOUND');
        if (payout.status !== 'SUCCEEDED') {
          throw new DomainError('INVALID_TRANSITION', 'Faqat tasdiqlangan (SUCCEEDED) payoutga tuzatish yoziladi');
        }
        if (newRef) {
          const dup = await tx.payout.findFirst({
            where: { bankOperationRef: newRef, id: { not: payoutId } },
            select: { id: true },
          });
          if (dup) {
            throw new DomainError('DUPLICATE_BANK_REF', `Bank hujjat raqami (${newRef}) boshqa to‘lovda mavjud`);
          }
        }

        await tx.payoutCorrection.create({
          data: {
            id: this.ids.next(),
            payoutId,
            staffId,
            previousBankRef: payout.bankOperationRef ?? null,
            newBankRef: newRef ?? payout.bankOperationRef ?? null,
            previousTransferredAt: payout.bankTransferredAt ?? null,
            newTransferredAt: newDate ?? payout.bankTransferredAt ?? null,
            reason: input.reason.trim(),
          },
        });

        const updated = await tx.payout.update({
          where: { id: payoutId },
          data: {
            bankOperationRef: newRef ?? payout.bankOperationRef,
            bankTransferredAt: newDate ?? payout.bankTransferredAt,
          },
          include: {
            seller: { select: { fullName: true, phone: true } },
            corrections: { orderBy: { createdAt: 'desc' } },
          },
        });

        await this.audit.record(
          {
            actor,
            action: 'PAYOUT_AUDIT_CORRECTED',
            resourceType: 'PAYOUT',
            resourceId: payoutId,
            contextId: payout.sellerId,
            previousState: {
              bankOperationRef: payout.bankOperationRef,
              bankTransferredAt: payout.bankTransferredAt?.toISOString() ?? null,
            },
            newState: {
              bankOperationRef: updated.bankOperationRef,
              bankTransferredAt: updated.bankTransferredAt?.toISOString() ?? null,
              reason: input.reason.trim(),
            },
          },
          tx,
        );
        return updated;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        throw new DomainError('DUPLICATE_BANK_REF', 'Bank hujjat raqami boshqa to‘lovda mavjud');
      }
      throw err;
    }
  }

  async listSpecialistsSummaryForStaff(): Promise<
    Array<{
      sellerId: string;
      sellerName: string;
      sellerPhone: string;
      grossTotal: number;
      commissionTotal: number;
      netTotal: number;
      reservedBalance: number;
      paidTotal: number;
      availableBalance: number;
      contracts: Array<{
        contractId: string;
        title: string;
        status: string;
        grossAmount: number;
        commissionRateBps: number;
        commissionAmount: number;
        netAmount: number;
      }>;
    }>
  > {
    const sellers = await this.prisma.user.findMany({
      where: {
        OR: [
          { contractsAsSeller: { some: { status: { in: ['ACTIVE', 'COMPLETED'] } } } },
          { payouts: { some: {} } },
        ],
      },
      select: { id: true, fullName: true, phone: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const rows = [];
    for (const seller of sellers) {
      const breakdown = await this.ledger.getSellerBalanceBreakdown(seller.id, CURRENCY);
      const settledContracts = breakdown.contracts.filter((c) => c.stage === 'settled');
      rows.push({
        sellerId: seller.id,
        sellerName: seller.fullName || seller.phone,
        sellerPhone: seller.phone,
        grossTotal: breakdown.summary.grossEarned,
        commissionTotal: breakdown.summary.commissionWithheld,
        netTotal: breakdown.summary.netEarned,
        reservedBalance: breakdown.summary.reserved,
        paidTotal: breakdown.summary.paid,
        availableBalance: breakdown.summary.available,
        contracts: settledContracts.map((c) => ({
          contractId: c.contractId,
          title: c.title,
          status: c.contractStatus,
          grossAmount: c.grossAmount,
          commissionRateBps: c.platformFeeRateBps,
          commissionAmount: c.commissionAmount,
          netAmount: c.netAmount,
        })),
      });
    }
    return rows;
  }

  // ── Webhook ───────────────────────────────────────────────────────────

  /**
   * Bo'lim 28 — imzo/provider-kalit tekshiruvi `PayoutWebhookController`da
   * (`PaymentWebhookController` bilan BIR XIL naqsh, lekin ALOHIDA route/provider).
   */
  async handleWebhookEvent(event: VerifiedPayoutWebhookEvent): Promise<{ outcome: PayoutEventOutcome }> {
    const payout = await this.prisma.payout.findFirst({
      where: { provider: this.provider.name, providerPayoutId: event.providerPayoutId },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const outcome = await this.applyEvent(tx, payout, event);
        await tx.payoutProviderEvent.create({
          data: {
            id: this.ids.next(),
            payoutId: payout?.id ?? null,
            provider: this.provider.name,
            providerEventId: event.providerEventId,
            eventType: event.eventType,
            outcome,
            processedAt: new Date(),
          },
        });
        return { outcome };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        return { outcome: 'NOOP_ALREADY_TARGET' };
      }
      throw err;
    }
  }

  private async applyEvent(
    tx: Prisma.TransactionClient,
    payout: Payout | null,
    event: VerifiedPayoutWebhookEvent,
  ): Promise<PayoutEventOutcome> {
    if (!payout) return 'UNKNOWN_PAYOUT';

    if (payout.currency !== event.currency || payout.amount !== event.amountTiyin) {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYOUT_WEBHOOK_MISMATCH',
          resourceType: 'PAYOUT',
          resourceId: payout.id,
          contextId: payout.sellerId,
          previousState: { amount: payout.amount.toString(), currency: payout.currency },
          newState: { amount: event.amountTiyin.toString(), currency: event.currency },
        },
        tx,
      );
      return 'MISMATCH';
    }

    return this.applyTerminalStatus(tx, payout, event.status, 'WEBHOOK');
  }

  /**
   * Bosqich 9, bo'lim 13/76 — CAS + (FAILED bo'lsa) `PAYOUT_RELEASE` +
   * audit + outbox: webhook VA reconciliation IKKALASI ham shu BITTA
   * metodni chaqiradi. Mustaqil "reconcile ledger" matematikasi YOZILMAYDI.
   */
  private async applyTerminalStatus(
    tx: Prisma.TransactionClient,
    payout: Payout,
    status: 'SUCCEEDED' | 'FAILED',
    source: 'WEBHOOK' | 'RECONCILIATION',
  ): Promise<PayoutEventOutcome> {
    if (!PAYOUT_NON_TERMINAL_STATUSES.includes(payout.status)) {
      if (payout.status === status) return 'NOOP_ALREADY_TARGET';
      return this.recordContradiction(tx, payout, status, source);
    }

    const cas = await tx.payout.updateMany({
      where: { id: payout.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data:
        status === 'SUCCEEDED'
          ? { status: 'SUCCEEDED', succeededAt: new Date() }
          : { status: 'FAILED', failedAt: new Date(), failureReason: `Provider ${source === 'WEBHOOK' ? 'webhook' : 'reconciliation'}: FAILED` },
    });
    if (cas.count === 0) {
      const fresh = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
      if (fresh.status === status) return 'NOOP_ALREADY_TARGET';
      return this.recordContradiction(tx, { ...payout, status: fresh.status }, status, source);
    }

    if (status === 'SUCCEEDED') {
      // Bo'lim 30/41 — HECH QANDAY qo'shimcha ledger yozuvi YO'Q: mablag'
      // reservation vaqtida ALLAQACHON SELLER_PAYABLE'dan PAYOUT_CLEARING'ga
      // o'tgan (PAYMENT_CLEARING bilan bir xil simmetriya — schema izohiga qarang).
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYOUT_SUCCEEDED',
          resourceType: 'PAYOUT',
          resourceId: payout.id,
          contextId: payout.sellerId,
          previousState: { status: payout.status },
          newState: { status: 'SUCCEEDED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        { aggregateType: 'PAYOUT', aggregateId: payout.id, eventType: 'PAYOUT_SUCCEEDED', payload: { sellerId: payout.sellerId } },
        tx,
      );
    } else {
      // Bo'lim 31/32 — FAILED: rezervatsiya RELEASE qilinadi (birinchi
      // haqiqiy reversal — original PAYOUT_RESERVATION o'zgartirilmaydi).
      const release = await this.ledger.releasePayout(tx, payout);
      if (release) {
        await this.audit.record(
          {
            actor: SYSTEM_ACTOR,
            action: 'LEDGER_PAYOUT_RELEASED',
            resourceType: 'LEDGER_TRANSACTION',
            resourceId: release.id,
            contextId: payout.id,
            newState: { sellerId: payout.sellerId, amount: payout.amount.toString() },
          },
          tx,
        );
      }
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYOUT_FAILED',
          resourceType: 'PAYOUT',
          resourceId: payout.id,
          contextId: payout.sellerId,
          previousState: { status: payout.status },
          newState: { status: 'FAILED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        { aggregateType: 'PAYOUT', aggregateId: payout.id, eventType: 'PAYOUT_FAILED', payload: { sellerId: payout.sellerId } },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'PAYOUT',
          aggregateId: payout.id,
          eventType: 'SELLER_FUNDS_RELEASED',
          payload: { sellerId: payout.sellerId, amount: payout.amount.toString() },
        },
        tx,
      );
    }
    return 'APPLIED';
  }

  /**
   * Bosqich 9, bo'lim 13/76 — reconciliation query natijasi asosida SHU
   * BITTA (webhook bilan bir xil) yo'l orqali qo'llaydi.
   */
  async applyReconciledStatus(
    tx: Prisma.TransactionClient,
    payout: Payout,
    status: 'SUCCEEDED' | 'FAILED',
  ): Promise<PayoutEventOutcome> {
    return this.applyTerminalStatus(tx, payout, status, 'RECONCILIATION');
  }

  private async recordContradiction(
    tx: Prisma.TransactionClient,
    payout: Payout,
    attemptedStatus: string,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ): Promise<PayoutEventOutcome> {
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: 'PAYOUT_WEBHOOK_CONFLICT',
        resourceType: 'PAYOUT',
        resourceId: payout.id,
        contextId: payout.sellerId,
        previousState: { status: payout.status },
        newState: { attemptedStatus, source },
      },
      tx,
    );
    return 'CONFLICT';
  }
}
