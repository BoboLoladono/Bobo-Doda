import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payment, Payout, Prisma, Refund, ReconciliationTrigger } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { AppConfigService } from '@/config/app-config.service';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { DomainError } from '@/common/errors/domain-error';
import { PAYMENT_PROVIDER, type PaymentProvider } from '@/modules/payment/providers/payment-provider.interface';
import { PAYOUT_PROVIDER, type PayoutProvider } from '@/modules/payout/providers/payout-provider.interface';
import { PaymentService } from '@/modules/payment/payment.service';
import { RefundService } from '@/modules/refund/refund.service';
import { PayoutService } from '@/modules/payout/payout.service';
import type { ProviderQueryResult } from '@/common/provider/provider-operation-state';
import { AnomalyService } from './anomaly.service';
import { classifyProviderQueryError } from './provider-error.util';
import { ANOMALY_CODES } from './anomaly-codes.constant';
import {
  PAYMENT_RECONCILE_ELIGIBLE_STATUSES,
  PAYOUT_RECONCILE_ELIGIBLE_STATUSES,
  REFUND_RECONCILE_ELIGIBLE_STATUSES,
} from './reconciliation.constants';

const SYSTEM_ACTOR: AuditActor = { id: null, type: 'SYSTEM', name: 'reconciliation-service' };

export type ReconcileOutcome = 'SKIPPED' | 'NO_CHANGE' | 'RECONCILED' | 'ANOMALY' | 'ERROR';
export interface ReconcileResult {
  outcome: ReconcileOutcome;
  /** Bo'lim 35 — provider config/auth xatosi: SHU provider uchun JORIY batch to'xtatilishi kerak. */
  abortBatch: boolean;
}

interface PersistRunInput {
  operationType: 'PAYMENT' | 'REFUND' | 'PAYOUT';
  operationId: string;
  provider: string;
  trigger: ReconciliationTrigger;
  status: 'NO_CHANGE' | 'RECONCILED' | 'ANOMALY' | 'ERROR';
  observedLocalStatus: string;
  observedProviderStatus?: string | null;
  actionTaken?: string | null;
  errorCode?: string | null;
  startedAt: Date;
}

/**
 * Bo'lim 8-14/76 — Payment/Refund/Payout reconciliation. **Mustaqil
 * "reconcile ledger" matematikasi YOZILMAYDI**: har uchala domen ham
 * `applyReconciledStatus()` orqali WEBHOOK bilan ANIQ BIR XIL yo'ldan
 * o'tadi (CAS, ledger posting, audit, outbox) — bu servis faqat: (1)
 * provider'ni SO'RAYDI (DB tranzaksiyasi TASHQARISIDA, bo'lim 19), (2)
 * natijani `ProviderOperationState` orqali TALQIN qiladi, (3) mos target
 * servisni chaqiradi, (4) `ReconciliationRun` + (kerak bo'lsa)
 * `FinancialAnomaly` yozadi.
 *
 * Uchta domen ATAYLAB alohida metod (`reconcilePayment`/`reconcileRefund`/
 * `reconcilePayout`) — umumiy generic abstraksiya EMAS (bo'lim 29's
 * "reconciliation vs repair" ajratish falsafasi bilan bir xil ruhda: har
 * domenning o'z nuance'i bor — Refund'ning Contract/Dispute lock'i,
 * Payout'ning PAYOUT_RELEASE'i — bittasini noto'g'ri generallashtirish
 * xavfliroq, Payment/Refund/Payout servislari o'zi ham shu naqshni tanlagan).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    private readonly anomalies: AnomalyService,
    private readonly paymentService: PaymentService,
    private readonly refundService: RefundService,
    private readonly payoutService: PayoutService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
    @Inject(PAYOUT_PROVIDER) private readonly payoutProvider: PayoutProvider,
  ) {}

  // ── Stuck-scan (bo'lim 15/17/57) ────────────────────────────────────────

  async findStuckPayments(limit: number): Promise<Payment[]> {
    const threshold = new Date(Date.now() - this.config.reconciliation.paymentAfterSeconds * 1000);
    return this.prisma.payment.findMany({
      where: { status: { in: [...PAYMENT_RECONCILE_ELIGIBLE_STATUSES] }, updatedAt: { lt: threshold } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async findStuckRefunds(limit: number): Promise<Refund[]> {
    const threshold = new Date(Date.now() - this.config.reconciliation.refundAfterSeconds * 1000);
    return this.prisma.refund.findMany({
      where: { status: { in: [...REFUND_RECONCILE_ELIGIBLE_STATUSES] }, updatedAt: { lt: threshold } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async findStuckPayouts(limit: number): Promise<Payout[]> {
    const threshold = new Date(Date.now() - this.config.reconciliation.payoutAfterSeconds * 1000);
    return this.prisma.payout.findMany({
      where: { status: { in: [...PAYOUT_RECONCILE_ELIGIBLE_STATUSES] }, updatedAt: { lt: threshold } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  /** Bo'lim: `GET /staff/reconciliation/summary` uchun — TO'LIQ hisob (batch limit YO'Q, faqat `count()`, arzon). */
  async countStuck(): Promise<{ payments: number; refunds: number; payouts: number }> {
    const paymentThreshold = new Date(Date.now() - this.config.reconciliation.paymentAfterSeconds * 1000);
    const refundThreshold = new Date(Date.now() - this.config.reconciliation.refundAfterSeconds * 1000);
    const payoutThreshold = new Date(Date.now() - this.config.reconciliation.payoutAfterSeconds * 1000);
    const [payments, refunds, payouts] = await Promise.all([
      this.prisma.payment.count({ where: { status: { in: [...PAYMENT_RECONCILE_ELIGIBLE_STATUSES] }, updatedAt: { lt: paymentThreshold } } }),
      this.prisma.refund.count({ where: { status: { in: [...REFUND_RECONCILE_ELIGIBLE_STATUSES] }, updatedAt: { lt: refundThreshold } } }),
      this.prisma.payout.count({ where: { status: { in: [...PAYOUT_RECONCILE_ELIGIBLE_STATUSES] }, updatedAt: { lt: payoutThreshold } } }),
    ]);
    return { payments, refunds, payouts };
  }

  /** Staff manual-reconcile javobi uchun — chaqiruv o'zi yozgan eng oxirgi `ReconciliationRun`. */
  async getLatestRun(operationType: 'PAYMENT' | 'REFUND' | 'PAYOUT', operationId: string) {
    return this.prisma.reconciliationRun.findFirst({
      where: { operationType, operationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Payment ──────────────────────────────────────────────────────────

  async reconcilePayment(payment: Payment, trigger: ReconciliationTrigger): Promise<ReconcileResult> {
    if (payment.provider === 'MANUAL_BANK' || !PAYMENT_RECONCILE_ELIGIBLE_STATUSES.includes(payment.status)) {
      return { outcome: 'SKIPPED', abortBatch: false };
    }
    const startedAt = new Date();
    if (!payment.providerPaymentId || !this.paymentProvider.queryPayment) {
      await this.persistRun(this.prisma, {
        operationType: 'PAYMENT',
        operationId: payment.id,
        provider: payment.provider,
        trigger,
        status: 'ERROR',
        observedLocalStatus: payment.status,
        actionTaken: 'NONE',
        errorCode: 'NO_PROVIDER_REFERENCE',
        startedAt,
      });
      return { outcome: 'ERROR', abortBatch: false };
    }

    let query: ProviderQueryResult;
    try {
      query = await this.paymentProvider.queryPayment(payment.providerPaymentId);
    } catch (err) {
      return this.handleQueryError('PAYMENT', payment.id, payment.provider, payment.status, trigger, startedAt, err);
    }

    if (query.state === 'PENDING' || query.state === 'PROCESSING') {
      await this.persistRun(this.prisma, {
        operationType: 'PAYMENT',
        operationId: payment.id,
        provider: payment.provider,
        trigger,
        status: 'NO_CHANGE',
        observedLocalStatus: payment.status,
        observedProviderStatus: query.state,
        actionTaken: 'NONE',
        startedAt,
      });
      return { outcome: 'NO_CHANGE', abortBatch: false };
    }
    if (query.state === 'NOT_FOUND' || query.state === 'UNKNOWN') {
      await this.prisma.$transaction(async (tx) => {
        await this.raiseQueryAnomaly(tx, 'PAYMENT', payment.id, query.state as 'NOT_FOUND' | 'UNKNOWN');
        await this.persistRun(tx, {
          operationType: 'PAYMENT',
          operationId: payment.id,
          provider: payment.provider,
          trigger,
          status: 'ANOMALY',
          observedLocalStatus: payment.status,
          observedProviderStatus: query.state,
          actionTaken: 'FLAGGED_ANOMALY',
          startedAt,
        });
      });
      return { outcome: 'ANOMALY', abortBatch: false };
    }

    // SUCCEEDED | FAILED — webhook bilan BIR XIL yo'l. Mutatsiya + audit +
    // `ReconciliationRun` BITTA tranzaksiyada (bo'lim: "business update +
    // AuditLog atomic" — audit.service.ts'dagi mavjud qoida bilan bir xil).
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const applied = await this.paymentService.applyReconciledStatus(tx, fresh, query.state as 'SUCCEEDED' | 'FAILED');
      return this.finalizeMutationOutcome(tx, 'PAYMENT', payment.id, payment.provider, payment.status, trigger, startedAt, query.state, applied);
    });
  }

  // ── Refund ───────────────────────────────────────────────────────────

  async reconcileRefund(refund: Refund, trigger: ReconciliationTrigger): Promise<ReconcileResult> {
    if (refund.provider === 'MANUAL_BANK' || !REFUND_RECONCILE_ELIGIBLE_STATUSES.includes(refund.status)) {
      return { outcome: 'SKIPPED', abortBatch: false };
    }
    const startedAt = new Date();
    if (!refund.providerRefundId || !this.paymentProvider.queryRefund) {
      await this.persistRun(this.prisma, {
        operationType: 'REFUND',
        operationId: refund.id,
        provider: refund.provider,
        trigger,
        status: 'ERROR',
        observedLocalStatus: refund.status,
        actionTaken: 'NONE',
        errorCode: 'NO_PROVIDER_REFERENCE',
        startedAt,
      });
      return { outcome: 'ERROR', abortBatch: false };
    }

    let query: ProviderQueryResult;
    try {
      query = await this.paymentProvider.queryRefund(refund.providerRefundId);
    } catch (err) {
      return this.handleQueryError('REFUND', refund.id, refund.provider, refund.status, trigger, startedAt, err);
    }

    if (query.state === 'PENDING' || query.state === 'PROCESSING') {
      await this.persistRun(this.prisma, {
        operationType: 'REFUND',
        operationId: refund.id,
        provider: refund.provider,
        trigger,
        status: 'NO_CHANGE',
        observedLocalStatus: refund.status,
        observedProviderStatus: query.state,
        actionTaken: 'NONE',
        startedAt,
      });
      return { outcome: 'NO_CHANGE', abortBatch: false };
    }
    if (query.state === 'NOT_FOUND' || query.state === 'UNKNOWN') {
      await this.prisma.$transaction(async (tx) => {
        await this.raiseQueryAnomaly(tx, 'REFUND', refund.id, query.state as 'NOT_FOUND' | 'UNKNOWN');
        await this.persistRun(tx, {
          operationType: 'REFUND',
          operationId: refund.id,
          provider: refund.provider,
          trigger,
          status: 'ANOMALY',
          observedLocalStatus: refund.status,
          observedProviderStatus: query.state,
          actionTaken: 'FLAGGED_ANOMALY',
          startedAt,
        });
      });
      return { outcome: 'ANOMALY', abortBatch: false };
    }

    // Bo'lim 12 — `RefundService.applyReconciledStatus()` o'zi Contract
    // `FOR UPDATE` qulfini (SUCCEEDED bo'lsa) ICHIDA oladi — bu yerda
    // qo'shimcha qulf kerak emas.
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      const applied = await this.refundService.applyReconciledStatus(tx, fresh, query.state as 'SUCCEEDED' | 'FAILED');
      return this.finalizeMutationOutcome(tx, 'REFUND', refund.id, refund.provider, refund.status, trigger, startedAt, query.state, applied);
    });
  }

  // ── Payout ───────────────────────────────────────────────────────────

  async reconcilePayout(payout: Payout, trigger: ReconciliationTrigger): Promise<ReconcileResult> {
    if (payout.provider === 'MANUAL' || !PAYOUT_RECONCILE_ELIGIBLE_STATUSES.includes(payout.status)) {
      return { outcome: 'SKIPPED', abortBatch: false };
    }
    const startedAt = new Date();
    if (!payout.providerPayoutId || !this.payoutProvider.queryPayout) {
      await this.persistRun(this.prisma, {
        operationType: 'PAYOUT',
        operationId: payout.id,
        provider: payout.provider,
        trigger,
        status: 'ERROR',
        observedLocalStatus: payout.status,
        actionTaken: 'NONE',
        errorCode: 'NO_PROVIDER_REFERENCE',
        startedAt,
      });
      return { outcome: 'ERROR', abortBatch: false };
    }

    let query: ProviderQueryResult;
    try {
      query = await this.payoutProvider.queryPayout(payout.providerPayoutId);
    } catch (err) {
      return this.handleQueryError('PAYOUT', payout.id, payout.provider, payout.status, trigger, startedAt, err);
    }

    if (query.state === 'PENDING' || query.state === 'PROCESSING') {
      // Bo'lim 68 — PROCESSING uzoq tursa HAM avtomatik release YO'Q,
      // faqat kuzatuv (`ReconciliationRun`) — mablag' PAYOUT_CLEARING'da
      // xavfsiz turadi, provider authoritative FAILED demaguncha.
      await this.persistRun(this.prisma, {
        operationType: 'PAYOUT',
        operationId: payout.id,
        provider: payout.provider,
        trigger,
        status: 'NO_CHANGE',
        observedLocalStatus: payout.status,
        observedProviderStatus: query.state,
        actionTaken: 'NONE',
        startedAt,
      });
      return { outcome: 'NO_CHANGE', abortBatch: false };
    }
    if (query.state === 'NOT_FOUND' || query.state === 'UNKNOWN') {
      await this.prisma.$transaction(async (tx) => {
        await this.raiseQueryAnomaly(tx, 'PAYOUT', payout.id, query.state as 'NOT_FOUND' | 'UNKNOWN');
        await this.persistRun(tx, {
          operationType: 'PAYOUT',
          operationId: payout.id,
          provider: payout.provider,
          trigger,
          status: 'ANOMALY',
          observedLocalStatus: payout.status,
          observedProviderStatus: query.state,
          actionTaken: 'FLAGGED_ANOMALY',
          startedAt,
        });
      });
      return { outcome: 'ANOMALY', abortBatch: false };
    }

    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.payout.findUniqueOrThrow({ where: { id: payout.id } });
      const applied = await this.payoutService.applyReconciledStatus(tx, fresh, query.state as 'SUCCEEDED' | 'FAILED');
      return this.finalizeMutationOutcome(tx, 'PAYOUT', payout.id, payout.provider, payout.status, trigger, startedAt, query.state, applied);
    });
  }

  // ── Batch orchestration (bo'lim 16/17/35/54) ───────────────────────────

  /**
   * Bo'lim 35/54 — ikkita MUSTAQIL "provider sog'lom" bayrog'i: Payment va
   * Refund BIR XIL `PAYMENT_PROVIDER`ni bo'lishadi (bo'lim 12 — config xato
   * bittasida bo'lsa ikkalasi ham to'xtaydi), Payout esa ALOHIDA. Bitta
   * kutilmagan (tasniflanmagan) xato BUTUN batch'ni yiqitmaydi (bo'lim 54)
   * — shu operatsiya `ERROR` bilan yozilib, keyingisiga o'tiladi.
   */
  async runBatch(trigger: ReconciliationTrigger): Promise<{
    processed: number;
    reconciled: number;
    anomalies: number;
    errors: number;
    paymentProviderAborted: boolean;
    payoutProviderAborted: boolean;
  }> {
    const batchSize = this.config.reconciliation.batchSize;
    const stats = { processed: 0, reconciled: 0, anomalies: 0, errors: 0, paymentProviderAborted: false, payoutProviderAborted: false };

    const tally = (result: ReconcileResult) => {
      if (result.outcome === 'SKIPPED') return;
      stats.processed += 1;
      if (result.outcome === 'RECONCILED') stats.reconciled += 1;
      if (result.outcome === 'ANOMALY') stats.anomalies += 1;
      if (result.outcome === 'ERROR') stats.errors += 1;
    };

    const payments = await this.findStuckPayments(batchSize);
    for (const payment of payments) {
      if (stats.paymentProviderAborted) break;
      try {
        const result = await this.reconcilePayment(payment, trigger);
        tally(result);
        if (result.abortBatch) stats.paymentProviderAborted = true;
      } catch (err) {
        this.logger.error({ paymentId: payment.id, err }, 'Reconciliation: kutilmagan xato (Payment) — batch davom etadi');
        stats.errors += 1;
      }
    }

    if (!stats.paymentProviderAborted) {
      const refunds = await this.findStuckRefunds(batchSize);
      for (const refund of refunds) {
        if (stats.paymentProviderAborted) break;
        try {
          const result = await this.reconcileRefund(refund, trigger);
          tally(result);
          if (result.abortBatch) stats.paymentProviderAborted = true;
        } catch (err) {
          this.logger.error({ refundId: refund.id, err }, 'Reconciliation: kutilmagan xato (Refund) — batch davom etadi');
          stats.errors += 1;
        }
      }
    }

    const payouts = await this.findStuckPayouts(batchSize);
    for (const payout of payouts) {
      if (stats.payoutProviderAborted) break;
      try {
        const result = await this.reconcilePayout(payout, trigger);
        tally(result);
        if (result.abortBatch) stats.payoutProviderAborted = true;
      } catch (err) {
        this.logger.error({ payoutId: payout.id, err }, 'Reconciliation: kutilmagan xato (Payout) — batch davom etadi');
        stats.errors += 1;
      }
    }

    return stats;
  }

  // ── Ichki yordamchilar ──────────────────────────────────────────────────

  private async handleQueryError(
    operationType: PersistRunInput['operationType'],
    operationId: string,
    provider: string,
    observedLocalStatus: string,
    trigger: ReconciliationTrigger,
    startedAt: Date,
    err: unknown,
  ): Promise<ReconcileResult> {
    const cls = classifyProviderQueryError(err);
    if (!cls) throw err; // bo'lim 54 — tasniflanmagan xato jimgina yutilmaydi, yuqoriga tashlanadi
    const errorCode = err instanceof DomainError ? err.code : 'UNKNOWN';
    await this.persistRun(this.prisma, {
      operationType,
      operationId,
      provider,
      trigger,
      status: 'ERROR',
      observedLocalStatus,
      actionTaken: 'NONE',
      errorCode,
      startedAt,
    });
    if (cls === 'CONFIG') {
      this.logger.error({ operationType, operationId, errorCode }, 'Reconciliation: provider config/auth xatosi — provider uchun batch to‘xtatildi');
    }
    return { outcome: 'ERROR', abortBatch: cls === 'CONFIG' };
  }

  private async raiseQueryAnomaly(
    tx: Prisma.TransactionClient,
    entityType: string,
    entityId: string,
    state: 'NOT_FOUND' | 'UNKNOWN',
  ): Promise<void> {
    await this.anomalies.raise(
      {
        code: state === 'NOT_FOUND' ? ANOMALY_CODES.PROVIDER_NOT_FOUND : ANOMALY_CODES.PROVIDER_STATUS_UNKNOWN,
        severity: 'WARNING',
        entityType,
        entityId,
        description:
          state === 'NOT_FOUND'
            ? `${entityType} ${entityId}: provider referensni topmadi (query)`
            : `${entityType} ${entityId}: provider status tasniflanmadi (query)`,
      },
      tx,
    );
  }

  /**
   * Bo'lim: mutatsiya + audit + `ReconciliationRun` shu yerda BITTA
   * tranzaksiyada yakunlanadi (`tx` chaqiruvchining ochgan `$transaction`i) —
   * "business update + AuditLog atomic" qoidasi bilan bir xil (audit.service.ts).
   */
  private async finalizeMutationOutcome(
    tx: Prisma.TransactionClient,
    operationType: PersistRunInput['operationType'],
    operationId: string,
    provider: string,
    observedLocalStatus: string,
    trigger: ReconciliationTrigger,
    startedAt: Date,
    providerState: string,
    outcome: 'APPLIED' | 'NOOP_ALREADY_TARGET' | 'CONFLICT' | 'MISMATCH' | 'UNKNOWN_PAYMENT' | 'UNKNOWN_REFUND' | 'UNKNOWN_PAYOUT',
  ): Promise<ReconcileResult> {
    if (outcome === 'APPLIED') {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: `${operationType}_RECONCILED`,
          resourceType: operationType,
          resourceId: operationId,
          newState: { status: providerState, trigger },
        },
        tx,
      );
      await this.persistRun(tx, {
        operationType,
        operationId,
        provider,
        trigger,
        status: 'RECONCILED',
        observedLocalStatus,
        observedProviderStatus: providerState,
        actionTaken: `MARKED_${providerState}`,
        startedAt,
      });
      return { outcome: 'RECONCILED', abortBatch: false };
    }
    if (outcome === 'NOOP_ALREADY_TARGET') {
      await this.persistRun(tx, {
        operationType,
        operationId,
        provider,
        trigger,
        status: 'NO_CHANGE',
        observedLocalStatus,
        observedProviderStatus: providerState,
        actionTaken: 'ALREADY_TARGET',
        startedAt,
      });
      return { outcome: 'NO_CHANGE', abortBatch: false };
    }
    // CONFLICT (bo'lim 42/43 — terminal contradiction) — MISMATCH/UNKNOWN_* bu
    // yo'lda amalda yuz bermaydi (`applyReconciledStatus()` amount tekshirmaydi,
    // `payment` har doim mavjud, oldindan `findUniqueOrThrow` bilan olingan).
    await this.anomalies.raise(
      {
        code: ANOMALY_CODES.TERMINAL_CONTRADICTION,
        severity: 'CRITICAL',
        entityType: operationType,
        entityId: operationId,
        description: `${operationType} ${operationId}: local terminal holat (${observedLocalStatus}) provider natijasiga (${providerState}) zid`,
      },
      tx,
    );
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: `${operationType}_RECONCILIATION_FAILED`,
        resourceType: operationType,
        resourceId: operationId,
        previousState: { status: observedLocalStatus },
        newState: { attemptedStatus: providerState },
      },
      tx,
    );
    await this.persistRun(tx, {
      operationType,
      operationId,
      provider,
      trigger,
      status: 'ANOMALY',
      observedLocalStatus,
      observedProviderStatus: providerState,
      actionTaken: 'FLAGGED_CONTRADICTION',
      startedAt,
    });
    return { outcome: 'ANOMALY', abortBatch: false };
  }

  private async persistRun(
    tx: Pick<PrismaService, 'reconciliationRun'>,
    input: PersistRunInput,
  ): Promise<void> {
    await tx.reconciliationRun.create({
      data: {
        id: this.ids.next(),
        operationType: input.operationType,
        operationId: input.operationId,
        provider: input.provider,
        trigger: input.trigger,
        status: input.status,
        observedLocalStatus: input.observedLocalStatus,
        observedProviderStatus: input.observedProviderStatus,
        actionTaken: input.actionTaken,
        errorCode: input.errorCode,
        startedAt: input.startedAt,
        completedAt: new Date(),
      },
    });
  }
}
