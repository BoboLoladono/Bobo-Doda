import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Payment, type Refund } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { LedgerService } from '@/modules/ledger/ledger.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type VerifiedRefundWebhookEvent,
} from '@/modules/payment/providers/payment-provider.interface';
import { REFUND_NON_TERMINAL_STATUSES } from './refund.constants';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Webhook/provider-triggered audit yozuvlari uchun — inson actor yo'q (Bosqich 5/6 bilan bir xil naqsh). */
const SYSTEM_ACTOR: AuditActor = { id: null, type: 'SYSTEM', name: 'payment-provider' };

type RefundEventOutcome = 'APPLIED' | 'NOOP_ALREADY_TARGET' | 'MISMATCH' | 'UNKNOWN_REFUND' | 'CONFLICT';

/**
 * `Refund` — bo'lim 3: FAQAT pre-settlement (`Contract.status = ACTIVE` +
 * `Payment.status = SUCCEEDED`). Post-settlement refund — Bosqich 8 Dispute
 * scope'i, BU YERDA YO'Q. FAQAT to'liq refund (bo'lim 7) — `amount` har
 * doim `Payment.amount`ga teng. FAQAT staff boshlaydi (bo'lim 3/16) —
 * buyer arbitrary ACTIVE contract'ni o'zi refund qila olmaydi.
 *
 * Orchestration — `PaymentService`/`ContractService` bilan BIR XIL naqsh
 * (Bosqich 5/6): Refund PENDING yaratiladi → provider chaqiruvi TX
 * TASHQARISIDA → webhook CAS orqali SUCCEEDED/FAILED, g'olib bo'lganda
 * ledger + Contract→CANCELLED BIR XIL tranzaksiyada (bo'lim 49).
 */
@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ── Yaratish (staff) ──────────────────────────────────────────────────

  async create(contractId: string, staffId: string, reason: string, actor: AuditActor): Promise<Refund> {
    const contract = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');

    // Bo'lim 3/18 — LIVE tekshiruv: FAQAT pre-settlement.
    if (contract.status !== 'ACTIVE') {
      throw new DomainError(
        'REFUND_NOT_ALLOWED',
        'Faqat hali yakunlanmagan (ACTIVE) shartnoma uchun refund mumkin — post-settlement refund bu bosqichda yo‘q',
      );
    }
    const payment = await this.prisma.payment.findFirst({ where: { contractId, status: 'SUCCEEDED' } });
    if (!payment) {
      throw new DomainError('REFUND_NOT_ALLOWED', 'Ushbu shartnoma uchun muvaffaqiyatli to‘lov topilmadi');
    }

    // Bosqich 8, bo'lim 8/39 simmetriyasi — ochiq nizo bo'lsa, YALANG'OCH
    // refund (bu metod) bloklanadi: bu Contract endi `DisputeService`
    // orqali hal qilinishi kerak (u BIR XIL Refund infratuzilmasini
    // `disputeId` bilan qayta ishlatadi — bo'lim 60).
    const openDispute = await this.prisma.dispute.findFirst({
      where: { contractId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
      select: { id: true },
    });
    if (openDispute) {
      throw new DomainError(
        'DISPUTE_IN_PROGRESS',
        'Bu shartnoma uchun ochiq nizo bor — refund faqat nizo hal qilinishi orqali amalga oshiriladi',
      );
    }

    // Bo'lim 15 — tezkor, aniqroq xato xabari uchun ilova darajasidagi
    // tekshiruv. HAQIQIY himoya — DB partial unique index
    // (`UNIQUE(paymentId) WHERE status IN ('PENDING','PROCESSING','SUCCEEDED')`).
    const existing = await this.prisma.refund.findFirst({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] } },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new DomainError(
        existing.status === 'SUCCEEDED' ? 'REFUND_ALREADY_SUCCEEDED' : 'REFUND_ALREADY_REQUESTED',
        existing.status === 'SUCCEEDED' ? 'Bu to‘lov allaqachon qaytarilgan' : 'Bu to‘lov uchun refund allaqachon so‘ralgan',
      );
    }

    const refundId = this.ids.next();
    let refund: Refund;
    try {
      refund = await this.prisma.$transaction(async (tx) => {
        // Serialize the decision with settlement and dispute opening. Preflight
        // reads above are only for feedback; they cannot authorize a refund.
        await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
        const current = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
        if (current.status !== 'ACTIVE') {
          throw new DomainError('REFUND_NOT_ALLOWED', 'Faqat faol shartnoma uchun refund mumkin');
        }
        const dispute = await tx.dispute.findFirst({
          where: { contractId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
          select: { id: true },
        });
        if (dispute) {
          throw new DomainError('DISPUTE_IN_PROGRESS', 'Ochiq nizo uchun refund faqat nizo orqali amalga oshiriladi');
        }
        const created = await tx.refund.create({
          data: {
            id: refundId,
            contractId,
            paymentId: payment.id,
            requestedByStaffId: staffId,
            amount: payment.amount,
            currency: payment.currency,
            reason,
            provider: this.provider.name,
            status: 'PENDING',
          },
        });
        await this.audit.record(
          {
            actor,
            action: 'REFUND_CREATED',
            resourceType: 'REFUND',
            resourceId: refundId,
            contextId: contractId,
            newState: { status: 'PENDING', amount: payment.amount.toString(), currency: payment.currency, reason },
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        throw new DomainError('REFUND_ALREADY_REQUESTED', 'Bu to‘lov uchun refund allaqachon so‘ralgan');
      }
      throw err;
    }

    // Bo'lim 11/29 — provider HTTP chaqiruvi DB tranzaksiyasi TASHQARISIDA.
    return this.callProviderAndAdvance(refund, payment);
  }

  /**
   * Bosqich 8, bo'lim 25/60 — `DisputeService.resolve()` chaqiradi (o'z
   * tranzaksiyasi ICHIDA): buyer-bound award uchun PENDING `Refund` qatori
   * yaratadi, `disputeId` bilan belgilangan. Validatsiya (Contract holati,
   * summalar) TO'LIQ `DisputeService` tomonidan ALLAQACHON bajarilgan —
   * bu metod faqat qator yaratadi (mas'uliyat ajratilgan, `create()`dagi
   * staff-so'ralgan yalang'och refund validatsiyasi bu yerga TEGISHLI EMAS).
   */
  async createDisputeRefundRow(
    tx: Prisma.TransactionClient,
    params: {
      id: string;
      contractId: string;
      paymentId: string;
      disputeId: string;
      amount: bigint;
      currency: string;
      resolvedByStaffId: string;
      actor: AuditActor;
    },
  ): Promise<Refund> {
    const created = await tx.refund.create({
      data: {
        id: params.id,
        contractId: params.contractId,
        paymentId: params.paymentId,
        disputeId: params.disputeId,
        requestedByStaffId: params.resolvedByStaffId,
        amount: params.amount,
        currency: params.currency,
        reason: `Dispute resolution — dispute ${params.disputeId}`,
        provider: this.provider.name,
        status: 'PENDING',
      },
    });
    await this.audit.record(
      {
        actor: params.actor,
        action: 'REFUND_CREATED',
        resourceType: 'REFUND',
        resourceId: params.id,
        contextId: params.contractId,
        newState: { status: 'PENDING', amount: params.amount.toString(), currency: params.currency, disputeId: params.disputeId },
      },
      tx,
    );
    return created;
  }

  /**
   * Bo'lim 11/29 — provider HTTP chaqiruvi (DB tranzaksiyasi TASHQARISIDA).
   * `create()` ICHKI chaqiradi; `DisputeService.resolve()` HAM (dispute-
   * driven Refund qatori commit bo'lgandan KEYIN, o'z tranzaksiyasi
   * TASHQARISIDA) — shu bitta crash-safe orchestration ikkalasiga xizmat
   * qiladi (bo'lim 25: "mavjud Refund infratuzilmasi qayta ishlatiladi").
   */
  async callProviderAndAdvance(refund: Refund, payment: Payment): Promise<Refund> {
    let result;
    try {
      result = await this.provider.refundPayment({
        refundId: refund.id,
        paymentId: payment.id,
        providerPaymentId: payment.providerPaymentId ?? '',
        amountTiyin: refund.amount,
        currency: refund.currency,
      });
    } catch (err) {
      // Bo'lim 11/48 — "provider javob bermadi" ≠ "refund muvaffaqiyatsiz".
      if (err instanceof DomainError && err.code === 'PAYMENT_PROVIDER_ERROR') {
        await this.markFailed(refund.id, err.message);
      }
      throw err;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.refund.updateMany({
        where: { id: refund.id, status: 'PENDING' },
        data: { status: 'PROCESSING', providerRefundId: result.providerRefundId, processingAt: new Date() },
      });
      if (cas.count === 0) return null;
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'REFUND_PROCESSING',
          resourceType: 'REFUND',
          resourceId: refund.id,
          contextId: refund.contractId,
          previousState: { status: 'PENDING' },
          newState: { status: 'PROCESSING' },
        },
        tx,
      );
      return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    });
    return updated ?? (await this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }));
  }

  private async markFailed(refundId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.refund.updateMany({
        where: { id: refundId, status: 'PENDING' },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      if (cas.count === 0) return;
      const failed = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'REFUND_FAILED',
          resourceType: 'REFUND',
          resourceId: refundId,
          contextId: failed.contractId,
          previousState: { status: 'PENDING' },
          newState: { status: 'FAILED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        { aggregateType: 'REFUND', aggregateId: refundId, eventType: 'REFUND_FAILED', payload: { contractId: failed.contractId } },
        tx,
      );
    });
  }

  // ── O'qish (egalik query-scope'da) ───────────────────────────────────

  async getBuyerOwnedOrThrow(id: string, buyerId: string): Promise<Refund> {
    const refund = await this.prisma.refund.findFirst({ where: { id, contract: { buyerId } } });
    if (!refund) throw new NotFoundError('Refund topilmadi', 'REFUND_NOT_FOUND');
    return refund;
  }

  async getByIdOrThrow(id: string): Promise<Refund> {
    const refund = await this.prisma.refund.findUnique({ where: { id } });
    if (!refund) throw new NotFoundError('Refund topilmadi', 'REFUND_NOT_FOUND');
    return refund;
  }

  async listForBuyer(buyerId: string, page: number, perPage: number, status?: Refund['status']): Promise<Page<Refund>> {
    return this.list({ contract: { buyerId }, status }, page, perPage);
  }

  async listForStaff(
    filters: { status?: Refund['status']; contractId?: string; paymentId?: string },
    page: number,
    perPage: number,
  ): Promise<Page<Refund>> {
    return this.list(filters, page, perPage);
  }

  private async list(where: Prisma.RefundWhereInput, page: number, perPage: number): Promise<Page<Refund>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.refund.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  // ── Webhook ───────────────────────────────────────────────────────────

  async handleWebhookEvent(event: VerifiedRefundWebhookEvent): Promise<{ outcome: RefundEventOutcome }> {
    const refund = await this.prisma.refund.findFirst({
      where: { provider: this.provider.name, providerRefundId: event.providerRefundId },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const outcome = await this.applyEvent(tx, refund, event);
        // Bo'lim 15/45 — dedup gate BIR XIL tranzaksiyada (Bosqich 5 bilan bir xil naqsh).
        await tx.refundProviderEvent.create({
          data: {
            id: this.ids.next(),
            refundId: refund?.id ?? null,
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
    refund: Refund | null,
    event: VerifiedRefundWebhookEvent,
  ): Promise<RefundEventOutcome> {
    if (!refund) return 'UNKNOWN_REFUND';

    if (refund.currency !== event.currency || refund.amount !== event.amountTiyin) {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'REFUND_WEBHOOK_MISMATCH',
          resourceType: 'REFUND',
          resourceId: refund.id,
          contextId: refund.contractId,
          previousState: { amount: refund.amount.toString(), currency: refund.currency },
          newState: { amount: event.amountTiyin.toString(), currency: event.currency },
        },
        tx,
      );
      return 'MISMATCH';
    }

    return this.applyTerminalStatus(tx, refund, event.status, 'WEBHOOK');
  }

  /**
   * Bosqich 9, bo'lim 12/76 — CAS + ledger (ESCROW yoki DISPUTE_HOLD
   * manbali, `dispute.preSettlement`ga qarab) + Contract CAS + audit +
   * outbox: webhook VA reconciliation IKKALASI ham shu BITTA metodni
   * chaqiradi (`applyReconciledStatus()` — pastda). Mustaqil "reconcile
   * ledger" matematikasi YOZILMAYDI.
   */
  private async applyTerminalStatus(
    tx: Prisma.TransactionClient,
    refund: Refund,
    status: 'SUCCEEDED' | 'FAILED',
    source: 'WEBHOOK' | 'RECONCILIATION',
  ): Promise<RefundEventOutcome> {
    if (!REFUND_NON_TERMINAL_STATUSES.includes(refund.status)) {
      if (refund.status === status) return 'NOOP_ALREADY_TARGET';
      return this.recordContradiction(tx, refund, status, source);
    }

    const cas = await tx.refund.updateMany({
      where: { id: refund.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data:
        status === 'SUCCEEDED'
          ? { status: 'SUCCEEDED', succeededAt: new Date() }
          : { status: 'FAILED', failedAt: new Date(), failureReason: `Provider ${source === 'WEBHOOK' ? 'webhook' : 'reconciliation'}: FAILED` },
    });
    if (cas.count === 0) {
      const fresh = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      if (fresh.status === status) return 'NOOP_ALREADY_TARGET';
      return this.recordContradiction(tx, { ...refund, status: fresh.status }, status, source);
    }

    if (status === 'SUCCEEDED') {
      // Bo'lim 18/62 — Contract qatorini `FOR UPDATE` bilan qulflaymiz
      // (ContractService.approveMilestone() bilan BIR XIL naqsh) —
      // settlement bilan poyga bo'lsa, ikkalasidan FAQAT BITTASI g'olib
      // chiqadi (qaysi biri birinchi qulfni olsa).
      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${refund.contractId}::uuid FOR UPDATE`;
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: refund.contractId } });

      // Bosqich 8, bo'lim 25/60 — dispute-driven Refund (post- YOKI
      // pre-settlement) `LedgerService.postDisputeBuyerRefund()` orqali
      // (manba ESCROW yoki DISPUTE_HOLD, `dispute.preSettlement`ga qarab);
      // yalang'och (Bosqich 7) Refund — o'zgarishsiz `refundPayment()`
      // (`contract.status==='ACTIVE'`ni qayta tekshiradi, bo'lim 59).
      const ledgerTx = refund.disputeId
        ? await this.ledger.postDisputeBuyerRefund(
            tx,
            refund,
            await tx.dispute.findUniqueOrThrow({ where: { id: refund.disputeId } }),
            contract,
          )
        : await this.ledger.refundPayment(tx, refund, contract);
      if (ledgerTx) {
        await this.audit.record(
          {
            actor: SYSTEM_ACTOR,
            action: 'LEDGER_REFUND_POSTED',
            resourceType: 'LEDGER_TRANSACTION',
            resourceId: ledgerTx.id,
            contextId: refund.contractId,
            newState: { refundId: refund.id, amount: refund.amount.toString(), currency: refund.currency },
          },
          tx,
        );
      }

      const contractCas = await tx.contract.updateMany({
        where: { id: refund.contractId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      if (contractCas.count === 1) {
        await this.audit.record(
          {
            actor: SYSTEM_ACTOR,
            action: 'CONTRACT_CANCELLED',
            resourceType: 'CONTRACT',
            resourceId: refund.contractId,
            contextId: refund.id,
            previousState: { status: 'ACTIVE' },
            newState: { status: 'CANCELLED' },
          },
          tx,
        );
        await this.outbox.enqueue(
          { aggregateType: 'CONTRACT', aggregateId: refund.contractId, eventType: 'CONTRACT_CANCELLED', payload: { refundId: refund.id } },
          tx,
        );
      }

      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'REFUND_SUCCEEDED',
          resourceType: 'REFUND',
          resourceId: refund.id,
          contextId: refund.contractId,
          previousState: { status: refund.status },
          newState: { status: 'SUCCEEDED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        { aggregateType: 'REFUND', aggregateId: refund.id, eventType: 'REFUND_SUCCEEDED', payload: { contractId: refund.contractId } },
        tx,
      );
    } else {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'REFUND_FAILED',
          resourceType: 'REFUND',
          resourceId: refund.id,
          contextId: refund.contractId,
          previousState: { status: refund.status },
          newState: { status: 'FAILED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        { aggregateType: 'REFUND', aggregateId: refund.id, eventType: 'REFUND_FAILED', payload: { contractId: refund.contractId } },
        tx,
      );
    }
    return 'APPLIED';
  }

  /**
   * Bosqich 9, bo'lim 12/76 — reconciliation query natijasi asosida SHU
   * BITTA (webhook bilan bir xil) yo'l orqali qo'llaydi. Amount/currency
   * mismatch tekshiruvi YO'Q (provider query faqat status qaytaradi).
   */
  async applyReconciledStatus(
    tx: Prisma.TransactionClient,
    refund: Refund,
    status: 'SUCCEEDED' | 'FAILED',
  ): Promise<RefundEventOutcome> {
    return this.applyTerminalStatus(tx, refund, status, 'RECONCILIATION');
  }

  private async recordContradiction(
    tx: Prisma.TransactionClient,
    refund: Refund,
    attemptedStatus: string,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ): Promise<RefundEventOutcome> {
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: 'REFUND_WEBHOOK_CONFLICT',
        resourceType: 'REFUND',
        resourceId: refund.id,
        contextId: refund.contractId,
        previousState: { status: refund.status },
        newState: { attemptedStatus, source },
      },
      tx,
    );
    return 'CONFLICT';
  }
}
