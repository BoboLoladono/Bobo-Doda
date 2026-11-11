import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Payment } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, InvariantViolationError, NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { assertSupportedCurrency } from '@/common/money/currency.constant';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AppConfigService } from '@/config/app-config.service';
import { PAYMENT_PROVIDER, type PaymentProvider, type VerifiedPaymentWebhookEvent } from './providers/payment-provider.interface';
import { PAYMENT_TERMINAL_STATUSES } from './payment.constants';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Webhook/provider-triggered audit yozuvlari uchun — inson actor yo'q (bo'lim 25/54). */
const SYSTEM_ACTOR: AuditActor = { id: null, type: 'SYSTEM', name: 'payment-provider' };

type PaymentEventOutcome = 'APPLIED' | 'NOOP_ALREADY_TARGET' | 'MISMATCH' | 'UNKNOWN_PAYMENT' | 'CONFLICT';

/**
 * `Payment` — to'liq umr davri: yaratish (faqat `ACTIVE` Contract uchun —
 * bo'lim 1 qarori), provider chaqiruvi (DB tranzaksiyasi TASHQARISIDA —
 * bo'lim 13), webhook orqali CAS bilan terminal holatga o'tish (bo'lim 22).
 *
 * Bosqich 6 — webhook `SUCCEEDED` CAS'i g'olib bo'lganda (`applyEvent()`)
 * `LedgerService.fundPayment()` SHU BITTA tranzaksiyada chaqiriladi
 * (atomik funding, bo'lim 16). Bu servis o'zi hech qanday balans/hisob
 * mantig'ini bilmaydi — faqat `LedgerService`ga ishonadi (mas'uliyat
 * ajratilgan).
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    private readonly config: AppConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ── Yaratish ──────────────────────────────────────────────────────────

  async create(
    contractId: string,
    buyerId: string,
    actor: AuditActor,
  ): Promise<{ payment: Payment; checkoutUrl?: string }> {
    const contract = await this.prisma.contract.findFirst({ where: { id: contractId, buyerId } });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');

    // Bo'lim 42 — LIVE tekshiruv (avval o'qilgan holatga ishonilmaydi).
    // Bo'lim 1 qarori: FAQAT ACTIVE contract uchun (seller allaqachon
    // qabul qilgan) — docs'dagi "to'lov → keyin ACTIVE" ketma-ketligidan
    // ATAYLAB chetga chiqish, Phase 4 state machine'iga tegilmadi.
    if (contract.status !== 'ACTIVE') {
      throw new DomainError('PAYMENT_NOT_ALLOWED', 'Faqat faol shartnoma uchun to‘lov boshlash mumkin');
    }
    assertSupportedCurrency(contract.currency);

    const paymentId = this.ids.next();
    let payment: Payment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        // Serializatsiya (Yakuniy raund talabi 1): bitta shartnomaga bir vaqtda
        // faqat bitta to'lov yaratish oqimi kirishi uchun Contract qatorini
        // `FOR UPDATE` bilan qulflaymiz. Parallel so'rovlar navbatda kutadi.
        await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
        const current = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
        if (current.status !== 'ACTIVE') {
          throw new DomainError('PAYMENT_NOT_ALLOWED', 'Faqat faol shartnoma uchun to‘lov boshlash mumkin');
        }

        const existingTx = await tx.payment.findFirst({
          where: { contractId, status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] } },
          select: { id: true, status: true },
        });
        if (existingTx) {
          if (existingTx.status === 'SUCCEEDED') {
            throw new DomainError('PAYMENT_ALREADY_SUCCEEDED', 'Bu shartnoma allaqachon to‘langan');
          }
          // Agar to'lov PENDING bo'lsa va checkout URL provayderi (Payme) bo'lsa:
          // Agar xaridor Payme oynasini yopib, tranzaksiya yaratmasdan chiqib ketgan bo'lsa (yoki to'lov hali yakunlanmagan bo'lsa),
          // mavjud PENDING to'lovni qayta ishlatamiz, shunda xaridor qayta to'lay oladi (deadlock bo'lmaydi).
          if (existingTx.status === 'PENDING' && this.provider.buildCheckoutUrl) {
            const performedPayme = await tx.paymeTransaction.findFirst({
              where: { paymentId: existingTx.id, state: 2 },
              select: { id: true },
            });
            if (!performedPayme) {
              return tx.payment.findUniqueOrThrow({ where: { id: existingTx.id } });
            }
          }
          throw new DomainError(
            'PAYMENT_ALREADY_IN_PROGRESS',
            'Ushbu shartnoma uchun to‘lov allaqachon jarayonda (PENDING yoki PROCESSING)',
          );
        }

        const created = await tx.payment.create({
          data: {
            id: paymentId,
            contractId,
            payerUserId: buyerId,
            provider: this.provider.name,
            amount: contract.agreedAmount,
            currency: contract.currency,
            status: 'PENDING',
          },
        });
        await this.audit.record(
          {
            actor,
            action: 'PAYMENT_CREATED',
            resourceType: 'PAYMENT',
            resourceId: paymentId,
            contextId: contractId,
            newState: { status: 'PENDING', amount: contract.agreedAmount.toString(), currency: contract.currency },
          },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        const target = Array.isArray(err.meta?.target)
          ? err.meta.target.join(',')
          : typeof err.meta?.target === 'string'
            ? err.meta.target
            : '';
        const message = err.message;
        if (target.includes('active') || message.includes('payments_contract_active_uidx')) {
          throw new DomainError(
            'PAYMENT_ALREADY_IN_PROGRESS',
            'Ushbu shartnoma uchun to‘lov allaqachon jarayonda (PENDING yoki PROCESSING)',
          );
        }
        throw new DomainError('PAYMENT_ALREADY_SUCCEEDED', 'Bu shartnoma allaqachon to‘langan');
      }
      throw err;
    }

    // Bosqich 12, bo'lim 24/28 — checkout-only provider (Payme): SINXRON,
    // tarmoq chaqiruvisiz. `Payment` PENDING'da qoladi — Payme o'z
    // transaksiyasini keyinroq INBOUND CreateTransaction orqali yaratadi
    // (`attachProviderReference()`, pastda).
    if (this.provider.buildCheckoutUrl) {
      const { checkoutUrl } = this.provider.buildCheckoutUrl({
        paymentId: payment.id,
        contractId: payment.contractId,
        amountTiyin: payment.amount,
        currency: payment.currency,
      });
      return { payment, checkoutUrl };
    }
    if (!this.provider.createPayment) {
      throw new InvariantViolationError(
        `Payment provider "${this.provider.name}" na createPayment, na buildCheckoutUrl amalga oshirgan`,
      );
    }

    // Bo'lim 13 — provider HTTP chaqiruvi DB tranzaksiyasi TASHQARISIDA:
    // `Payment` allaqachon COMMIT bo'lgan, lock/connection uzoq ushlab
    // turilmaydi.
    const advancedPayment = await this.callProviderAndAdvance(payment, this.provider.createPayment.bind(this.provider));
    // Local TEST provayderida to'lov settlement (tasdiqlash) simulyatsiyasi (Yakuniy raund talabi 3)
    if (
      !this.config.isProduction &&
      this.provider.name === 'TEST' &&
      (process.env.AUTO_CONFIRM_TEST_PAYMENTS === 'true' || process.env.TEST_PAYMENT_AUTO_CONFIRM === 'true')
    ) {
      return { payment: await this.simulateSuccessForTest(advancedPayment.id) };
    }
    return { payment: advancedPayment };
  }

  private async callProviderAndAdvance(
    payment: Payment,
    createPayment: NonNullable<PaymentProvider['createPayment']>,
  ): Promise<Payment> {
    let result;
    try {
      result = await createPayment({
        paymentId: payment.id,
        contractId: payment.contractId,
        amountTiyin: payment.amount,
        currency: payment.currency,
      });
    } catch (err) {
      // Bo'lim 11/59 — "provider javob bermadi" ≠ "to'lov muvaffaqiyatsiz".
      if (err instanceof DomainError && err.code === 'PAYMENT_PROVIDER_ERROR') {
        // Deterministik rad — provider ANIQ hech narsa yaratmadi, xavfsiz FAILED.
        await this.markFailed(payment.id, err.message);
      }
      // `PAYMENT_PROVIDER_UNAVAILABLE` (ambiguous) — Payment ATAYLAB PENDING'da
      // qoladi (`providerPaymentId` yo'q holda): provider aslida qabul
      // qilgan bo'lishi mumkin, ko'r-ko'rona FAILED qilinmaydi. Xato
      // `IdempotencyService` orqali xavfsiz keshlanadi (bo'lim 12) — client
      // shu javobni qayta oladi, YANGI provider chaqiruvi qilinmaydi.
      throw err;
    }

    return this.attachProviderReference(payment.id, result.providerPaymentId, result.providerCreatedAt);
  }

  /**
   * Bosqich 12, bo'lim 10/12/28 — `Payment` PENDING → PROCESSING, provider
   * referensini biriktiradi. Ilgari `callProviderAndAdvance()`ning ICHKI
   * qismi edi (outbound provider'lar uchun) — endi PUBLIC va reused: Payme
   * INBOUND `CreateTransaction` RPC handler (`PaymeMerchantService`) ham
   * SHU BITTA metodni chaqiradi (yangi ledger/CAS kodi YOZILMAYDI). CAS —
   * ikkinchi chaqiruv (masalan parallel/duplicate CreateTransaction) NOOP
   * (eski qatorni qaytaradi, xato tashlamaydi — chaqiruvchi allaqachon
   * `providerPaymentId` bir xilligini o'zi tekshiradi).
   */
  async attachProviderReference(paymentId: string, providerPaymentId: string, providerCreatedAt: Date): Promise<Payment> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'PROCESSING', providerPaymentId, providerCreatedAt },
      });
      if (cas.count === 0) return null;
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYMENT_PROVIDER_CREATED',
          resourceType: 'PAYMENT',
          resourceId: paymentId,
          contextId: fresh.contractId,
          previousState: { status: 'PENDING' },
          newState: { status: 'PROCESSING', provider: this.provider.name },
        },
        tx,
      );
      return fresh;
    });
    return updated ?? (await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }));
  }

  private async markFailed(paymentId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'FAILED', failedAt: new Date(), failureReason: reason },
      });
      if (cas.count === 0) return;
      const failed = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYMENT_FAILED',
          resourceType: 'PAYMENT',
          resourceId: paymentId,
          contextId: failed.contractId,
          previousState: { status: 'PENDING' },
          newState: { status: 'FAILED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'PAYMENT',
          aggregateId: paymentId,
          eventType: 'PAYMENT_FAILED',
          payload: { contractId: failed.contractId },
        },
        tx,
      );
    });
  }

  // ── O'qish (egalik query-scope'da) ───────────────────────────────────

  async getBuyerOwnedOrThrow(id: string, buyerId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findFirst({ where: { id, payerUserId: buyerId } });
    if (!payment) throw new NotFoundError('To‘lov topilmadi', 'PAYMENT_NOT_FOUND');
    return payment;
  }

  async getByIdOrThrow(id: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundError('To‘lov topilmadi', 'PAYMENT_NOT_FOUND');
    return payment;
  }

  async listForBuyer(
    buyerId: string,
    page: number,
    perPage: number,
    status?: Payment['status'],
    contractId?: string,
  ): Promise<Page<Payment>> {
    return this.list({ payerUserId: buyerId, status, contractId }, page, perPage);
  }

  async listForStaff(
    filters: { status?: Payment['status']; contractId?: string; payerUserId?: string; provider?: string },
    page: number,
    perPage: number,
  ): Promise<Page<Payment>> {
    return this.list(filters, page, perPage);
  }

  private async list(where: Prisma.PaymentWhereInput, page: number, perPage: number): Promise<Page<Payment>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  // ── Webhook ───────────────────────────────────────────────────────────

  /**
   * Bo'lim 15/17 — imzo/format tekshiruvi `PaymentWebhookController`da
   * (`PaymentProvider.verifyWebhook()` orqali, RAW baytlar ustida) —
   * Bosqich 7'dan boshlab bitta route (`kind`ga qarab) HAM Payment, HAM
   * Refund hodisasini qabul qiladi, shuning uchun dispatch controller
   * darajasida (bo'lim 4: ikkala domen bir-biriga bog'lanib qolmasin).
   */
  async handlePaymentEvent(event: VerifiedPaymentWebhookEvent): Promise<{ outcome: PaymentEventOutcome }> {
    const payment = await this.prisma.payment.findFirst({
      where: { provider: this.provider.name, providerPaymentId: event.providerPaymentId },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        const outcome = await this.applyEvent(tx, payment, event);

        // Bo'lim 18/19 — dedup gate BIR XIL tranzaksiyada, CAS/audit/outbox
        // dan KEYIN: agar shu `providerEventId` ALLAQACHON qayd etilgan
        // bo'lsa (parallel duplicate — bo'lim 52 "10 parallel duplicate
        // webhook"), `create()` unique violation beradi va BUTUN
        // tranzaksiya (yuqoridagi CAS/audit/outbox bilan birga) ROLLBACK
        // bo'ladi — faqat BITTA parallel so'rov haqiqiy mutatsiya qiladi.
        await tx.paymentProviderEvent.create({
          data: {
            id: this.ids.next(),
            paymentId: payment?.id ?? null,
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
        // Duplicate yetkazish — bu ANIQ providerEventId allaqachon to'liq
        // ishlov berilgan (yoki parallel g'olib boshqa tranzaksiya bo'ldi).
        // Idempotent ack — qayta mutatsiya YO'Q.
        return { outcome: 'NOOP_ALREADY_TARGET' };
      }
      throw err;
    }
  }

  private async applyEvent(
    tx: Prisma.TransactionClient,
    payment: Payment | null,
    event: VerifiedPaymentWebhookEvent,
  ): Promise<PaymentEventOutcome> {
    if (!payment) {
      return 'UNKNOWN_PAYMENT';
    }

    // Bo'lim 20/21 — provider yuborgan summa/valyuta Payment snapshot'iga
    // MOS kelishi SHART, aks holda hech qachon SUCCEEDED qilinmaydi.
    if (payment.currency !== event.currency || payment.amount !== event.amountTiyin) {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'PAYMENT_WEBHOOK_MISMATCH',
          resourceType: 'PAYMENT',
          resourceId: payment.id,
          contextId: payment.contractId,
          previousState: { amount: payment.amount.toString(), currency: payment.currency },
          newState: { amount: event.amountTiyin.toString(), currency: event.currency },
        },
        tx,
      );
      return 'MISMATCH';
    }

    return this.applyTerminalStatus(tx, payment, event.status, 'WEBHOOK');
  }

  /**
   * Bo'lim 8/9/76 — CAS + ledger funding + audit + outbox: webhook,
   * Bosqich 9 reconciliation VA Bosqich 12 Payme PerformTransaction/
   * CancelTransaction (inbound RPC) — UCHALASI ham shu BITTA metodni
   * chaqiradi (`applyReconciledStatus()`/`applyProviderRpcStatus()` —
   * pastda, public wrapper'lar). Mustaqil "reconcile ledger" matematikasi
   * YOZILMAYDI — financial mutation faqat shu yagona yo'ldan o'tadi.
   */
  private async applyTerminalStatus(
    tx: Prisma.TransactionClient,
    payment: Payment,
    status: VerifiedPaymentWebhookEvent['status'],
    source: 'WEBHOOK' | 'RECONCILIATION' | 'PROVIDER_RPC',
  ): Promise<PaymentEventOutcome> {
    if (PAYMENT_TERMINAL_STATUSES.includes(payment.status)) {
      if (payment.status === status) return 'NOOP_ALREADY_TARGET';
      return this.recordContradiction(tx, payment, status, source);
    }

    const cas = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: this.terminalUpdateData(status),
    });
    if (cas.count === 0) {
      // Race: parallel boshqa hodisa (webhook YOKI reconciliation) bizdan
      // oldin terminal holatga o'tkazdi (bo'lim 14 — race har ikki
      // yo'nalishda ham himoyalangan, faqat BITTASI g'olib chiqadi).
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (fresh.status === status) return 'NOOP_ALREADY_TARGET';
      return this.recordContradiction(tx, { ...payment, status: fresh.status }, status, source);
    }

    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: this.eventAuditAction(status),
        resourceType: 'PAYMENT',
        resourceId: payment.id,
        contextId: payment.contractId,
        previousState: { status: payment.status },
        newState: { status, source },
      },
      tx,
    );
    if (status === 'SUCCEEDED') {
      // Bo'lim 16 — ATOMIK: Payment CAS (yuqorida) + ledger funding + audit
      // + outbox BIR XIL tranzaksiyada. Natija: "Payment SUCCEEDED lekin
      // escrow funded emas" holati STRUKTURAVIY ravishda IMKONSIZ — yo
      // ikkalasi ham COMMIT bo'ladi, yo ikkalasi ham ROLLBACK.
      // `payment.status` bu obyektda hali eski (PENDING/PROCESSING) —
      // `fundPayment()` uni o'qimaydi (faqat amount/currency/id/contractId/
      // payerUserId), shuning uchun to'g'ridan-to'g'ri uzatish xavfsiz.
      const funding = await this.ledger.fundPayment(tx, payment);
      if (funding) {
        await this.audit.record(
          {
            actor: SYSTEM_ACTOR,
            action: 'LEDGER_PAYMENT_FUNDED',
            resourceType: 'LEDGER_TRANSACTION',
            resourceId: funding.id,
            contextId: payment.contractId,
            newState: { paymentId: payment.id, amount: payment.amount.toString(), currency: payment.currency },
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            aggregateType: 'PAYMENT',
            aggregateId: payment.id,
            eventType: 'ESCROW_FUNDED',
            payload: { contractId: payment.contractId, ledgerTransactionId: funding.id },
          },
          tx,
        );
      }
      await this.outbox.enqueue(
        { aggregateType: 'PAYMENT', aggregateId: payment.id, eventType: 'PAYMENT_SUCCEEDED', payload: { contractId: payment.contractId } },
        tx,
      );
    } else if (status === 'FAILED') {
      // Bo'lim 54 — FAILED/CANCELLED/EXPIRED HECH QACHON ledger funding
      // yaratmaydi (faqat authoritative SUCCEEDED source).
      await this.outbox.enqueue(
        { aggregateType: 'PAYMENT', aggregateId: payment.id, eventType: 'PAYMENT_FAILED', payload: { contractId: payment.contractId } },
        tx,
      );
    }
    return 'APPLIED';
  }

  /**
   * Bosqich 9, bo'lim 8/9/12 — reconciliation query natijasi asosida SHU
   * BITTA (webhook bilan bir xil) yo'l orqali qo'llaydi. Mismatch tekshiruvi
   * YO'Q (provider query amount/currency qaytarmaydi — faqat status),
   * qolgan hammasi (terminal-holat himoyasi, CAS, ledger, audit, outbox)
   * ANIQ bir xil. Chaqiruvchi (`ReconciliationService`) natijaga qarab
   * `FinancialAnomaly` yaratish/yaratmaslikni hal qiladi — bu servis faqat
   * "nima bo'ldi"ni qaytaradi (mas'uliyat ajratilgan).
   */
  async applyReconciledStatus(
    tx: Prisma.TransactionClient,
    payment: Payment,
    status: 'SUCCEEDED' | 'FAILED',
  ): Promise<PaymentEventOutcome> {
    return this.applyTerminalStatus(tx, payment, status, 'RECONCILIATION');
  }

  /**
   * Bosqich 12, bo'lim 14/15/17 — Payme `PerformTransaction` (SUCCEEDED)
   * va `CancelTransaction` (performed bo'lmasdan turib CANCELLED) SHU
   * BITTA metodni chaqiradi (`PaymeMerchantService`). Mismatch tekshiruvi
   * YO'Q — Payme `CheckPerformTransaction`/`CreateTransaction` amount'ni
   * ALLAQACHON tasdiqlagan (bo'lim 10/12), shuning uchun `applyReconciledStatus`
   * bilan bir xil "mismatchsiz" yo'l to'g'ri.
   */
  async applyProviderRpcStatus(
    tx: Prisma.TransactionClient,
    payment: Payment,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
  ): Promise<PaymentEventOutcome> {
    return this.applyTerminalStatus(tx, payment, status, 'PROVIDER_RPC');
  }

  private async recordContradiction(
    tx: Prisma.TransactionClient,
    payment: Payment,
    attemptedStatus: string,
    source: 'WEBHOOK' | 'RECONCILIATION' | 'PROVIDER_RPC',
  ): Promise<PaymentEventOutcome> {
    // Bo'lim 22/42/43 — "SUCCEEDED -> FAILED" kabi ziddiyatli hodisa HECH
    // QACHON jimgina qayta yozilmaydi (silent overwrite yo'q, terminal
    // monotonicity saqlanadi) — faqat audit'ga qayd etiladi.
    await this.audit.record(
      {
        actor: SYSTEM_ACTOR,
        action: 'PAYMENT_WEBHOOK_CONFLICT',
        resourceType: 'PAYMENT',
        resourceId: payment.id,
        contextId: payment.contractId,
        previousState: { status: payment.status },
        newState: { attemptedStatus, source },
      },
      tx,
    );
    return 'CONFLICT';
  }

  private terminalUpdateData(status: VerifiedPaymentWebhookEvent['status']): Prisma.PaymentUpdateManyMutationInput {
    const now = new Date();
    if (status === 'SUCCEEDED') return { status, succeededAt: now };
    if (status === 'FAILED') return { status, failedAt: now };
    return { status, cancelledAt: now };
  }

  private eventAuditAction(status: VerifiedPaymentWebhookEvent['status']): string {
    if (status === 'SUCCEEDED') return 'PAYMENT_SUCCEEDED';
    if (status === 'FAILED') return 'PAYMENT_FAILED';
    return 'PAYMENT_CANCELLED';
  }

  /**
   * FAQAT TEST/DEV: To'lov settlement (tasdiqlash) simulyatsiyasi.
   * Haqiqiy Payme/Click webhook'i bo'lmagan lokal muhitda to'lovni
   * avtomatik yoki qo'lda SUCCEEDED holatiga o'tkazib, escrow ledger'ini
   * moliyalashtirish imkonini beradi. Production'da FAIL-FAST rad etiladi.
   */
  async simulateSuccessForTest(paymentId: string, buyerId?: string): Promise<Payment> {
    if (this.config.isProduction || this.provider.name !== 'TEST') {
      throw new DomainError('TEST_SIMULATION_NOT_ALLOWED', 'To‘lov simulyatsiyasi faqat TEST muhitida ruxsat etilgan');
    }
    const payment = buyerId
      ? await this.getBuyerOwnedOrThrow(paymentId, buyerId)
      : await this.getByIdOrThrow(paymentId);

    if (payment.status === 'SUCCEEDED') {
      return payment;
    }

    const providerPaymentId = payment.providerPaymentId ?? `test_${payment.id}`;
    if (!payment.providerPaymentId) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId, status: 'PROCESSING' },
      });
    }

    await this.handlePaymentEvent({
      kind: 'PAYMENT',
      providerEventId: `sim_${payment.id}_${Date.now()}`,
      providerPaymentId,
      eventType: 'PAYMENT_SUCCEEDED',
      status: 'SUCCEEDED',
      amountTiyin: payment.amount,
      currency: payment.currency,
    });

    return this.getByIdOrThrow(paymentId);
  }
}
