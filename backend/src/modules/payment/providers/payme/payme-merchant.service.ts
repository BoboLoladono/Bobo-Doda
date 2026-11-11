import { Injectable } from '@nestjs/common';
import { Prisma, type Payment, type PaymeTransaction } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { PaymentService } from '@/modules/payment/payment.service';
import { PaymeRpcError } from './payme-rpc-error';
import {
  PAYME_ACCOUNT_FIELD,
  PAYME_ERROR,
  PAYME_REASON,
  PAYME_STATE,
  resolvePaymeReason,
} from './payme-rpc.types';
import { paymeAmountToTiyin, tiyinToPaymeAmount } from './payme-amount.util';
import { dateToPaymeTimestampMs, parsePaymeTimestampMs } from './payme-time.util';

const PRISMA_UNIQUE_VIOLATION = 'P2002';
const SYSTEM_ACTOR: AuditActor = { id: null, type: 'SYSTEM', name: 'payme-merchant-api' };

/** Bo'lim 21 — bir GetStatement chaqiruvi qaytaradigan eng ko'p qator (unbounded scan taqiqi). */
const MAX_STATEMENT_ROWS = 500;

/**
 * Bosqich 12 — Payme Merchant API rasmiy metodlarining biznes mantig'i.
 * `PaymeMerchantController` shu servisni chaqiradi va natijani/`PaymeRpcError`ni
 * JSON-RPC javobiga aylantiradi. Bu servis HECH QACHON to'g'ridan-to'g'ri
 * `Payment.status`ni yangilamaydi — SUCCEEDED/CANCELLED o'tishlari FAQAT
 * `PaymentService.applyProviderRpcStatus()`/`attachProviderReference()`
 * orqali (bo'lim 14 — mavjud authoritative yo'l, yangi ledger kodi YO'Q).
 */
@Injectable()
export class PaymeMerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly payments: PaymentService,
  ) {}

  // ── Account resolution (bo'lim 11) ──────────────────────────────────────

  private extractPaymentId(account: unknown): string {
    if (typeof account !== 'object' || account === null || Array.isArray(account)) {
      throw new PaymeRpcError(
        PAYME_ERROR.ACCOUNT_NOT_FOUND,
        'account maydoni yo‘q',
        PAYME_ACCOUNT_FIELD,
      );
    }
    const value = (account as Record<string, unknown>)[PAYME_ACCOUNT_FIELD];
    if (typeof value !== 'string' || value.length === 0) {
      throw new PaymeRpcError(
        PAYME_ERROR.ACCOUNT_NOT_FOUND,
        'payment_id topilmadi',
        PAYME_ACCOUNT_FIELD,
      );
    }
    return value;
  }

  private async findPaymentOrThrow(paymentId: string): Promise<Payment> {
    // UUID formatida bo'lmasa Prisma `findUnique` xato tashlaydi — shuning
    // uchun avval yengil formatsiz tekshiruv, keyin DB so'rov.
    const payment = await this.prisma.payment
      .findUnique({ where: { id: paymentId } })
      .catch(() => null);
    if (!payment) {
      throw new PaymeRpcError(
        PAYME_ERROR.ACCOUNT_NOT_FOUND,
        'Ko‘rsatilgan hisob (payment) topilmadi',
        PAYME_ACCOUNT_FIELD,
      );
    }
    return payment;
  }

  private assertAmountMatches(payment: Payment, amountParam: unknown): bigint {
    const amount = paymeAmountToTiyin(amountParam);
    if (amount !== payment.amount) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_AMOUNT, 'Summa mos emas');
    }
    return amount;
  }

  // ── CheckPerformTransaction (bo'lim 10) ─────────────────────────────────

  async checkPerformTransaction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const paymentId = this.extractPaymentId(params.account);
    const payment = await this.findPaymentOrThrow(paymentId);
    this.assertAmountMatches(payment, params.amount);
    const performedTx = await this.prisma.paymeTransaction.findFirst({
      where: {
        paymentId: payment.id,
        state: PAYME_STATE.PERFORMED,
      },
    });
    if (payment.status !== 'PENDING' || performedTx) {
      throw new PaymeRpcError(
        PAYME_ERROR.ACCOUNT_NOT_FOUND,
        'Bu hisob uchun to‘lov allaqachon yakunlangan',
        PAYME_ACCOUNT_FIELD,
      );
    }
    return { allow: true };
  }

  // ── CreateTransaction (bo'lim 12/13) ────────────────────────────────────

  async createTransaction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const paymeTransactionId = this.requireStringId(params.id);
    const paymentId = this.extractPaymentId(params.account);
    const payment = await this.findPaymentOrThrow(paymentId);
    const amount = this.assertAmountMatches(payment, params.amount);
    const providerTime = parsePaymeTimestampMs(params.time, 'time');

    // Idempotent replay — SHU id bilan avval yaratilgan bo'lsa, YANGI qator
    // YARATMAYMIZ, mavjud natijani qaytaramiz (bo'lim 12).
    const existingBySameId = await this.prisma.paymeTransaction.findUnique({
      where: { paymeTransactionId },
    });
    if (existingBySameId) {
      if (existingBySameId.paymentId !== payment.id || existingBySameId.amount !== amount) {
        throw new PaymeRpcError(
          PAYME_ERROR.OPERATION_NOT_ALLOWED,
          'Bir xil id, lekin boshqa account/summa bilan qayta so‘rov',
        );
      }
      return this.createTransactionResponse(existingBySameId, payment);
    }

    if (payment.status !== 'PENDING') {
      throw new PaymeRpcError(
        PAYME_ERROR.OPERATION_NOT_ALLOWED,
        'Bu hisob uchun to‘lov allaqachon yakunlangan',
      );
    }

    // Agar avvalgi urinishdan CREATED bo'lib qolib ketgan boshqa tranzaksiya bo'lsa,
    // uni bekor qilib (CANCELLED_BEFORE_PERFORM) yangi urinishga yo'l ochamiz.
    const staleCreated = await this.prisma.paymeTransaction.findFirst({
      where: {
        paymentId: payment.id,
        state: PAYME_STATE.CREATED,
      },
    });
    if (staleCreated && staleCreated.paymeTransactionId !== paymeTransactionId) {
      await this.prisma.paymeTransaction.update({
        where: { id: staleCreated.id },
        data: {
          state: PAYME_STATE.CANCELLED_BEFORE_PERFORM,
          cancelTime: new Date(),
          cancelReason: PAYME_REASON.CANCELLED_BEFORE_PERFORM,
        },
      });
    }

    const id = this.ids.next();
    let created: PaymeTransaction;
    try {
      created = await this.prisma.paymeTransaction.create({
        data: {
          id,
          paymeTransactionId,
          paymentId: payment.id,
          amount,
          state: PAYME_STATE.CREATED,
          providerTime,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === PRISMA_UNIQUE_VIOLATION
      ) {
        // Bo'lim 13 — 10 parallel bir xil CreateTransaction: aynan BITTASI
        // `create()`ni yutadi, qolganlari shu yerga tushadi va mavjud
        // qatorni o'qib, XUDDI SHU javobni qaytaradi (exactly 1 row DB
        // unique constraint orqali kafolatlangan — try/catch faqat
        // natijani ikkinchi marta o'qiydi).
        const race = await this.prisma.paymeTransaction.findUnique({
          where: { paymeTransactionId },
        });
        if (race && race.paymentId === payment.id && race.amount === amount) {
          return this.createTransactionResponse(race, payment);
        }
        throw new PaymeRpcError(
          PAYME_ERROR.OPERATION_NOT_ALLOWED,
          'Bu hisob uchun boshqa transaksiya allaqachon mavjud',
        );
      }
      throw err;
    }

    // Bo'lim 10/28 — mavjud authoritative CAS (`PaymentService`), yangi
    // ledger/holat kodi YOZILMAYDI. `providerPaymentId` — Payme'ning o'z
    // transaksiya ID'si (traceability).
    await this.payments.attachProviderReference(payment.id, paymeTransactionId, created.createTime);

    return this.createTransactionResponse(created, payment);
  }

  private createTransactionResponse(
    tx: PaymeTransaction,
    payment: Payment,
  ): Record<string, unknown> {
    return {
      create_time: dateToPaymeTimestampMs(tx.createTime),
      transaction: payment.id,
      state: tx.state,
    };
  }

  // ── PerformTransaction (bo'lim 14/15) ───────────────────────────────────

  async performTransaction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const paymeTransactionId = this.requireStringId(params.id);
    const found = await this.prisma.paymeTransaction.findUnique({ where: { paymeTransactionId } });
    if (!found) throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND, 'Transaksiya topilmadi');

    if (found.state === PAYME_STATE.PERFORMED) {
      // Bo'lim 15 — idempotent: qayta ijro YO'Q, xuddi shu natija.
      return this.performResponse(found);
    }
    if (found.state !== PAYME_STATE.CREATED) {
      throw new PaymeRpcError(
        PAYME_ERROR.OPERATION_NOT_ALLOWED,
        'Bekor qilingan transaksiyani ijro etib bo‘lmaydi',
      );
    }

    const performTime = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.paymeTransaction.updateMany({
        where: { paymeTransactionId, state: PAYME_STATE.CREATED },
        data: { state: PAYME_STATE.PERFORMED, performTime },
      });
      if (cas.count === 0) {
        // Bo'lim 15 — parallel g'olib bizdan oldin bajardi; XUDDI SHU
        // (endi yangilangan) qatorni idempotent qaytaramiz.
        return tx.paymeTransaction.findUniqueOrThrow({ where: { paymeTransactionId } });
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.paymentId } });
      // Bo'lim 14 — YAGONA authoritative yo'l: CAS + ledger funding +
      // audit + outbox BIR XIL tranzaksiyada (`applyProviderRpcStatus`).
      await this.payments.applyProviderRpcStatus(tx, payment, 'SUCCEEDED');
      return tx.paymeTransaction.findUniqueOrThrow({ where: { paymeTransactionId } });
    });

    return this.performResponse(result);
  }

  private performResponse(tx: PaymeTransaction): Record<string, unknown> {
    return {
      transaction: tx.paymentId,
      perform_time: tx.performTime ? dateToPaymeTimestampMs(tx.performTime) : 0,
      state: tx.state,
    };
  }

  // ── CancelTransaction (bo'lim 16/17/18) ─────────────────────────────────

  async cancelTransaction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const paymeTransactionId = this.requireStringId(params.id);
    const reason = typeof params.reason === 'number' ? params.reason : null;
    const found = await this.prisma.paymeTransaction.findUnique({ where: { paymeTransactionId } });
    if (!found) throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND, 'Transaksiya topilmadi');

    if (
      found.state === PAYME_STATE.CANCELLED_BEFORE_PERFORM ||
      found.state === PAYME_STATE.CANCELLED_AFTER_PERFORM
    ) {
      // Bo'lim 31/67 — duplicate Cancel: idempotent, xuddi shu natija.
      return this.cancelResponse(found);
    }

    if (found.state === PAYME_STATE.PERFORMED) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: found.paymentId },
        include: { contract: { select: { status: true } } },
      });
      if (payment?.contract?.status === 'COMPLETED') {
        throw new PaymeRpcError(
          PAYME_ERROR.CANNOT_CANCEL_COMPLETED,
          'Buyurtma to‘liq bajarilgan, bekor qilib bo‘lmaydi',
        );
      }

      // Payme spetsifikatsiyasi: bajarilgan transaksiyani bekor qilish (state: -2, reason: 5)
      const cancelTime = new Date();
      const cancelReason = PAYME_REASON.CANCELLED_AFTER_PERFORM;
      const updated = await this.prisma.paymeTransaction.update({
        where: { paymeTransactionId },
        data: { state: PAYME_STATE.CANCELLED_AFTER_PERFORM, cancelTime, cancelReason },
      });
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: 'PAYME_CANCEL_AFTER_PERFORM',
        resourceType: 'PAYMENT',
        resourceId: found.paymentId,
        newState: { paymeTransactionId, requestedReason: reason, cancelReason, cancelTime },
      });
      return this.cancelResponse(updated);
    }

    // state === CREATED — hali performed emas, bekor qilish har doim xavfsiz.
    const cancelTime = new Date();
    const cancelReason =
      typeof params.reason === 'number' ? params.reason : PAYME_REASON.CANCELLED_BEFORE_PERFORM;
    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.paymeTransaction.updateMany({
        where: { paymeTransactionId, state: PAYME_STATE.CREATED },
        data: { state: PAYME_STATE.CANCELLED_BEFORE_PERFORM, cancelTime, cancelReason },
      });
      if (cas.count === 0) {
        // Race: parallel Perform yoki Cancel bizdan oldin o'zgartirdi —
        // yangilangan holatni o'qib qaytaramiz (chaqiruvchi keyingi
        // chaqiruvda mos javob oladi; bu chaqiruv o'zi ham idempotent
        // ko'rinishda javob beradi, xato tashlamaydi).
        return tx.paymeTransaction.findUniqueOrThrow({ where: { paymeTransactionId } });
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.paymentId } });
      await this.payments.applyProviderRpcStatus(tx, payment, 'CANCELLED');
      return tx.paymeTransaction.findUniqueOrThrow({ where: { paymeTransactionId } });
    });

    if (result.state === PAYME_STATE.PERFORMED) {
      // Race natijasida performed bo'lib ulgurdi — endi cancel-after-perform
      // qoidasi qo'llanadi (state: -2, reason: 5).
      const raceCancelTime = new Date();
      const raceCancelReason = PAYME_REASON.CANCELLED_AFTER_PERFORM;
      const updated = await this.prisma.paymeTransaction.update({
        where: { paymeTransactionId },
        data: {
          state: PAYME_STATE.CANCELLED_AFTER_PERFORM,
          cancelTime: raceCancelTime,
          cancelReason: raceCancelReason,
        },
      });
      await this.audit.record({
        actor: SYSTEM_ACTOR,
        action: 'PAYME_CANCEL_AFTER_PERFORM',
        resourceType: 'PAYMENT',
        resourceId: found.paymentId,
        newState: {
          paymeTransactionId,
          requestedReason: reason,
          cancelReason: raceCancelReason,
          cancelTime: raceCancelTime,
        },
      });
      return this.cancelResponse(updated);
    }
    return this.cancelResponse(result);
  }

  private cancelResponse(tx: PaymeTransaction): Record<string, unknown> {
    return {
      transaction: tx.paymentId,
      cancel_time: tx.cancelTime ? dateToPaymeTimestampMs(tx.cancelTime) : 0,
      state: tx.state,
    };
  }

  // ── CheckTransaction (bo'lim 20) ────────────────────────────────────────

  async checkTransaction(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const paymeTransactionId = this.requireStringId(params.id);
    const found = await this.prisma.paymeTransaction.findUnique({ where: { paymeTransactionId } });
    if (!found) throw new PaymeRpcError(PAYME_ERROR.TRANSACTION_NOT_FOUND, 'Transaksiya topilmadi');

    // Bo'lim 20 — PERSISTED qatordan deterministik javob, qayta hisoblash YO'Q.
    return {
      create_time: dateToPaymeTimestampMs(found.createTime),
      perform_time: found.performTime ? dateToPaymeTimestampMs(found.performTime) : 0,
      cancel_time: found.cancelTime ? dateToPaymeTimestampMs(found.cancelTime) : 0,
      transaction: found.paymentId,
      state: found.state,
      reason: resolvePaymeReason(found.state, found.cancelReason),
    };
  }

  // ── GetStatement (bo'lim 21) ────────────────────────────────────────────

  async getStatement(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const from = parsePaymeTimestampMs(params.from, 'from');
    const to = parsePaymeTimestampMs(params.to, 'to');
    if (from.getTime() > to.getTime()) {
      throw new PaymeRpcError(
        PAYME_ERROR.INVALID_REQUEST,
        '"from" "to"dan katta bo‘lishi mumkin emas',
      );
    }

    const rows = await this.prisma.paymeTransaction.findMany({
      where: { createTime: { gte: from, lte: to } },
      orderBy: { createTime: 'asc' },
      take: MAX_STATEMENT_ROWS,
    });

    return {
      transactions: rows.map((row) => ({
        id: row.paymeTransactionId,
        time: dateToPaymeTimestampMs(row.providerTime),
        amount: tiyinToPaymeAmount(row.amount),
        account: { [PAYME_ACCOUNT_FIELD]: row.paymentId },
        create_time: dateToPaymeTimestampMs(row.createTime),
        perform_time: row.performTime ? dateToPaymeTimestampMs(row.performTime) : 0,
        cancel_time: row.cancelTime ? dateToPaymeTimestampMs(row.cancelTime) : 0,
        transaction: row.paymentId,
        state: row.state,
        reason: resolvePaymeReason(row.state, row.cancelReason),
      })),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private requireStringId(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new PaymeRpcError(PAYME_ERROR.INVALID_REQUEST, '"id" majburiy');
    }
    return value;
  }
}
