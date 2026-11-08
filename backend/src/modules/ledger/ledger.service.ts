import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Contract,
  type Dispute,
  type LedgerAccount,
  type LedgerTransaction,
  type Payment,
  type Payout,
  type Refund,
} from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { InvariantViolationError, NotFoundError } from '@/common/errors/domain-error';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import {
  assertBalanced,
  computeDisputeHoldLines,
  computeDisputeHoldReleaseLines,
  computeDisputeHoldToRefundLines,
  computeDisputeResolutionLines,
  computeFundingLines,
  computePayoutReleaseLines,
  computePayoutReservationLines,
  computeRefundLines,
  computeSettlementLines,
  type LedgerAccountRole,
  type LedgerLine,
} from './ledger-math.util';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/**
 * Double-entry ledger — YAGONA yozish yo'li (bo'lim 31/32): hech qanday
 * public/staff endpoint entry yaratmaydi, faqat shu servisning domain
 * metodlari (`fundPayment`/`settleContract`) — ular esa faqat
 * `PaymentService`/`ContractService`ning ICHKI, allaqachon-tekshirilgan
 * biznes tranzaksiyalaridan chaqiriladi.
 *
 * Har chaqiruv `tx: Prisma.TransactionClient` OLADI (default yo'q, `Audit`/
 * `OutboxService`dan farqli) — ledger posting HECH QACHON mustaqil
 * ishlamaydi, doim uni tetiklagan biznes mutatsiya bilan BITTA atomik
 * tranzaksiyada (bo'lim 16/17).
 *
 * **Muhim ichki qoida — try/catch bilan "band" xatoni tutib, SHU tranzaksiya
 * ichida davom etish YO'Q, MAGAR SAVEPOINT ishlatilmasa.** Postgres'da
 * bitta statement unique-violation bilan yiqilsa, BUTUN o'rab turgan
 * tranzaksiya "aborted" holatga o'tadi — buni oddiy JS `catch` bloki bekor
 * QILA OLMAYDI, faqat `ROLLBACK TO SAVEPOINT` tozalay oladi. Shuning uchun:
 *  - Foydalanuvchi hisoblari (`ESCROW`/`SELLER_PAYABLE`, bo'lim 42 —
 *    parallel BIRINCHI-MARTA-yaratish real race) — `SAVEPOINT` + tentativ
 *    `create()` + conflict bo'lsa `ROLLBACK TO SAVEPOINT` + fallback
 *    `findFirst()` (bo'lim 20: `upsert()` ATAYLAB ishlatilmaydi — u
 *    `ledger_accounts`ga UPDATE huquqini talab qilardi, append-only
 *    kafolatini zaiflashtirardi).
 *  - Platforma hisoblari (`PAYMENT_CLEARING`/`PLATFORM_REVENUE`) — RACE
 *    UMUMAN YO'Q: docs B8 tavsiyasiga ko'ra migratsiyada EAGER bootstrap
 *    qilingan (bitta qator, doim mavjud), runtime'da faqat o'qiladi.
 *  - Journal exactly-once (`LedgerTransaction`, bo'lim 9/30) — avval
 *    `findUnique` bilan TEKSHIRIB, keyin `create()` (catch YO'Q). Bu
 *    chaqiruvchi joylar (Payment CAS, Contract `FOR UPDATE`) allaqachon
 *    haqiqiy concurrent-double-call'ni oldindan yo'qqa chiqargani uchun
 *    xavfsiz — agar baribir (nazariy) poyga yuz bersa, butun tashqi
 *    tranzaksiya ochiq xato bilan yiqiladi (jimgina buzilish EMAS).
 */
@Injectable()
export class LedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
  ) {}

  // ── Hisoblar ──────────────────────────────────────────────────────────

  /** Bootstrap migratsiyada yaratilgan, o'zgarmas — faqat o'qiladi, race yo'q. */
  private async getPlatformAccount(
    tx: Prisma.TransactionClient,
    type: Extract<LedgerAccountRole, 'PAYMENT_CLEARING' | 'PLATFORM_REVENUE' | 'REFUND_CLEARING'>,
    currency: string,
  ): Promise<LedgerAccount> {
    const account = await tx.ledgerAccount.findFirst({ where: { type, ownerType: 'PLATFORM', currency } });
    if (!account) {
      throw new InvariantViolationError(`Platforma ledger hisobi topilmadi (bootstrap qilinmagan?): ${type}/${currency}`);
    }
    return account;
  }

  /**
   * Bo'lim 42 — race-safe, LEKIN `upsert()` ISHLATILMAYDI: `ledger_accounts`
   * TO'LIQ append-only (UPDATE huquqi UMUMAN yo'q — hatto `upsert()`ning
   * hech qachon ishlamaydigan "no-op" UPDATE tarmog'i ham Postgres'da
   * UPDATE huquqini talab qilardi, bu esa jadvalning append-only
   * kafolatini zaiflashtirardi).
   *
   * Buning o'rniga `SAVEPOINT`: tentativ `INSERT` conflict bersa,
   * `ROLLBACK TO SAVEPOINT` Postgres'ning "tranzaksiya aborted" holatini
   * TOZALAYDI (oddiy JS `catch` buni QILA OLMAYDI — bu butun servis
   * bo'yicha muhim ichki qoida, klass izohiga qarang) — shundan keyin
   * mavjud qatorni xavfsiz o'qiymiz, BITTA tashqi tranzaksiya ichida,
   * hech qanday UPDATE huquqisiz.
   */
  private async getOrCreateUserAccount(
    tx: Prisma.TransactionClient,
    type: Extract<LedgerAccountRole, 'ESCROW' | 'SELLER_PAYABLE' | 'PAYOUT_CLEARING' | 'DISPUTE_HOLD'>,
    userId: string,
    currency: string,
  ): Promise<LedgerAccount> {
    const where = { type_ownerType_ownerId_currency: { type, ownerType: 'USER' as const, ownerId: userId, currency } };
    const existing = await tx.ledgerAccount.findUnique({ where });
    if (existing) return existing;

    const savepoint = `ledger_acct_${this.ids.next().replace(/-/g, '')}`;
    await tx.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
    try {
      return await tx.ledgerAccount.create({
        data: { id: this.ids.next(), type, ownerType: 'USER', ownerId: userId, currency },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
        const created = await tx.ledgerAccount.findUnique({ where });
        if (created) return created;
      }
      throw err;
    }
  }

  private async resolveAccount(
    tx: Prisma.TransactionClient,
    role: LedgerAccountRole,
    currency: string,
    context: { buyerId?: string; sellerId?: string },
  ): Promise<LedgerAccount> {
    switch (role) {
      case 'PAYMENT_CLEARING':
        return this.getPlatformAccount(tx, 'PAYMENT_CLEARING', currency);
      case 'PLATFORM_REVENUE':
        return this.getPlatformAccount(tx, 'PLATFORM_REVENUE', currency);
      case 'REFUND_CLEARING':
        return this.getPlatformAccount(tx, 'REFUND_CLEARING', currency);
      case 'ESCROW':
        if (!context.buyerId) throw new InvariantViolationError('Ledger: ESCROW hisobi uchun buyerId shart');
        return this.getOrCreateUserAccount(tx, 'ESCROW', context.buyerId, currency);
      case 'SELLER_PAYABLE':
        if (!context.sellerId) throw new InvariantViolationError('Ledger: SELLER_PAYABLE hisobi uchun sellerId shart');
        return this.getOrCreateUserAccount(tx, 'SELLER_PAYABLE', context.sellerId, currency);
      case 'PAYOUT_CLEARING':
        if (!context.sellerId) throw new InvariantViolationError('Ledger: PAYOUT_CLEARING hisobi uchun sellerId shart');
        return this.getOrCreateUserAccount(tx, 'PAYOUT_CLEARING', context.sellerId, currency);
      case 'DISPUTE_HOLD':
        if (!context.sellerId) throw new InvariantViolationError('Ledger: DISPUTE_HOLD hisobi uchun sellerId shart');
        return this.getOrCreateUserAccount(tx, 'DISPUTE_HOLD', context.sellerId, currency);
    }
  }

  // ── Journal yozish (generic, ICHKI — export qilinmaydi) ──────────────

  /**
   * Bo'lim 9/30 — exactly-once: avval `findUnique` bilan tekshiradi, topsa
   * `null` qaytaradi (idempotent no-op — audit/outbox qayta yozilmaydi,
   * bo'lim 23/24). Chaqiruvchi joylar (Payment CAS / Contract `FOR UPDATE`)
   * allaqachon haqiqiy concurrent-double-call'ni oldini oladi — bu shu
   * sababli xavfsiz pre-check (yuqoridagi klass izohi).
   */
  private async postJournal(
    tx: Prisma.TransactionClient,
    params: {
      type: LedgerTransaction['type'];
      sourceId: string;
      currency: string;
      description?: string;
      lines: LedgerLine[];
      context: { buyerId?: string; sellerId?: string };
    },
  ): Promise<LedgerTransaction | null> {
    assertBalanced(params.lines);

    const existing = await tx.ledgerTransaction.findUnique({
      where: { type_sourceId: { type: params.type, sourceId: params.sourceId } },
    });
    if (existing) return null;

    const transactionId = this.ids.next();
    await tx.ledgerTransaction.create({
      data: {
        id: transactionId,
        type: params.type,
        currency: params.currency,
        sourceId: params.sourceId,
        description: params.description,
      },
    });

    for (const line of params.lines) {
      const account = await this.resolveAccount(tx, line.account, params.currency, params.context);
      await tx.ledgerEntry.create({
        data: { id: this.ids.next(), transactionId, accountId: account.id, amount: line.amount, currency: params.currency },
      });
    }

    return tx.ledgerTransaction.findUniqueOrThrow({ where: { id: transactionId } });
  }

  // ── Domain metodlari (chaqiriladigan YAGONA yuzaki API) ──────────────

  /**
   * Bo'lim 10/16 — `Payment.status → SUCCEEDED` bilan BIR XIL tranzaksiyada
   * chaqiriladi (`PaymentService.applyEvent()`). Faqat SUCCEEDED source —
   * FAILED/CANCELLED/EXPIRED hech qachon bu metodni chaqirmaydi (bo'lim 54).
   */
  async fundPayment(tx: Prisma.TransactionClient, payment: Payment): Promise<LedgerTransaction | null> {
    const lines = computeFundingLines(payment.amount);
    return this.postJournal(tx, {
      type: 'PAYMENT_FUNDING',
      sourceId: payment.id,
      currency: payment.currency,
      description: `Payment funding — contract ${payment.contractId}`,
      lines,
      context: { buyerId: payment.payerUserId },
    });
  }

  /**
   * Bosqich 8, bo'lim 14 — POST-settlement dispute uchun provenance:
   * "shu Contract sozlamasi sellerga aynan qancha net keltirgan" savoli
   * `LedgerTransaction(type=CONTRACT_SETTLEMENT, sourceId=contract.id)`ning
   * SELLER_PAYABLE yozuvidan olinadi (mutable mapping YARATILMAYDI — bo'lim
   * 14: "ledger transaction source yetarli bo'lsa, shundan foydalan").
   */
  async getSettlementSellerNet(tx: Prisma.TransactionClient, contractId: string): Promise<bigint> {
    const settlement = await tx.ledgerTransaction.findUnique({
      where: { type_sourceId: { type: 'CONTRACT_SETTLEMENT', sourceId: contractId } },
      include: { entries: { include: { account: true } } },
    });
    if (!settlement) {
      throw new InvariantViolationError('Dispute: Contract COMPLETED, lekin settlement journal topilmadi', { contractId });
    }
    const sellerEntry = settlement.entries.find((e) => e.account.type === 'SELLER_PAYABLE');
    if (!sellerEntry) {
      throw new InvariantViolationError('Dispute: settlement journalida SELLER_PAYABLE yozuvi topilmadi', { contractId });
    }
    return sellerEntry.amount;
  }

  /** Bo'lim 13 — settlement oldidan tekshirish uchun (defensive, `ContractService` chaqiradi). */
  async findFundingTransaction(tx: Prisma.TransactionClient, paymentId: string): Promise<LedgerTransaction | null> {
    return tx.ledgerTransaction.findUnique({
      where: { type_sourceId: { type: 'PAYMENT_FUNDING', sourceId: paymentId } },
    });
  }

  /**
   * Bo'lim 11/17 — `Contract.status → COMPLETED` bilan BIR XIL tranzaksiyada
   * (oxirgi milestone approve). Fee — `contract.platformFeeAmountSnapshot`
   * (bo'lim 12: runtime fee config HECH QACHON qayta o'qilmaydi).
   *
   * `fundingPayment` — chaqiruvchi (`ContractService`) allaqachon topib,
   * mavjudligini tasdiqlagan `SUCCEEDED` Payment (bo'lim 14: "client payment
   * ID yubormaydi, backend authoritative relation orqali topadi"). Bu yerda
   * FAQAT integrity tekshiruvi uchun ishlatiladi.
   */
  async settleContract(
    tx: Prisma.TransactionClient,
    contract: Contract,
    fundingPayment: Payment,
  ): Promise<LedgerTransaction | null> {
    if (contract.currency !== fundingPayment.currency || contract.agreedAmount !== fundingPayment.amount) {
      throw new InvariantViolationError('Ledger settlement: Contract va Payment summasi/valyutasi mos emas', {
        contractId: contract.id,
        paymentId: fundingPayment.id,
      });
    }

    const lines = computeSettlementLines(contract.agreedAmount, contract.platformFeeAmountSnapshot);
    return this.postJournal(tx, {
      type: 'CONTRACT_SETTLEMENT',
      sourceId: contract.id,
      currency: contract.currency,
      description: `Contract settlement — ${contract.id}`,
      lines,
      context: { buyerId: contract.buyerId, sellerId: contract.sellerId },
    });
  }

  /**
   * Bosqich 7, bo'lim 10/18 — `Refund.status → SUCCEEDED` (webhook) bilan
   * BIR XIL tranzaksiyada. **FAQAT pre-settlement**: `contract.status`
   * SHU TRANZAKSIYA ichida (chaqiruvchi — `RefundService` — Contract
   * qatorini oldindan `FOR UPDATE` bilan qulflagan bo'lishi kerak, xuddi
   * `ContractService.approveMilestone()` bilan bir xil naqsh, bo'lim 18/62
   * "settlement bilan poyga") ANIQ `ACTIVE` bo'lishi shart — aks holda bu
   * pul allaqachon SELLER_PAYABLE/PLATFORM_REVENUE'ga o'tgan bo'lishi
   * mumkin, ikkinchi marta ESCROW'dan "ayirib" bo'lmaydi.
   */
  async refundPayment(tx: Prisma.TransactionClient, refund: Refund, contract: Contract): Promise<LedgerTransaction | null> {
    if (contract.status !== 'ACTIVE') {
      throw new InvariantViolationError(
        'Ledger refund: Contract endi ACTIVE emas (allaqachon settled/cancelled bo‘lishi mumkin) — refund bloklandi',
        { contractId: contract.id, refundId: refund.id, contractStatus: contract.status },
      );
    }
    if (contract.currency !== refund.currency || contract.id !== refund.contractId) {
      throw new InvariantViolationError('Ledger refund: Contract va Refund mos emas', {
        contractId: contract.id,
        refundId: refund.id,
      });
    }

    const lines = computeRefundLines(refund.amount);
    return this.postJournal(tx, {
      type: 'REFUND',
      sourceId: refund.id,
      currency: refund.currency,
      description: `Refund — contract ${contract.id}`,
      lines,
      context: { buyerId: contract.buyerId },
    });
  }

  // ── Payout (bo'lim 19-35) ─────────────────────────────────────────────

  /**
   * Bo'lim 22/26/62 — payout so'rovi RESERVATION qilishdan OLDIN shu
   * seller+currency uchun MUTEX oladi va joriy balansni SHU qulf ostida
   * qaytaradi. Chaqiruvchi (`PayoutService`) balansni tekshirib, YETARLI
   * bo'lsagina `reservePayout()`ni chaqiradi — ikkalasi ORASIDA hech qanday
   * boshqa tranzaksiya bu hisobni o'zgartira OLMAYDI (qulf tashqi
   * tranzaksiya COMMIT/ROLLBACK bo'lgunicha ushlab turiladi) — bu aynan
   * ikkinchi parallel `payout` so'rovini `INSUFFICIENT_BALANCE`ga
   * majburlaydigan mexanizm.
   *
   * **Muhim ichki qoida — `SELECT ... FOR UPDATE` EMAS, `pg_advisory_
   * xact_lock`.** Dastlab `ledger_accounts` qatorini haqiqiy row-lock
   * (`FOR UPDATE`) bilan qulflashga urinilgan edi — real e2e run buni
   * `permission denied for table ledger_accounts` bilan yiqitdi: Postgres
   * qoidasi, `SELECT ... FOR UPDATE` SELECT'dan TASHQARI jadvalda UPDATE
   * (yoki DELETE) huquqini ham talab qiladi (qator qulfini keyingi
   * UPDATE/DELETE bilan bog'liq deb hisoblaydi) — `ledger_accounts`dan esa
   * append-only invariant uchun UPDATE/DELETE ATAYLAB REVOKE qilingan
   * (A4). Shuning uchun: transaction-scoped advisory lock — jadvalga
   * HECH QANDAY maxsus huquq talab qilmaydi (PUBLIC'ga ochiq funksiya),
   * COMMIT/ROLLBACK'da avtomatik bo'shaydi, va seller+currency kaliti
   * bo'yicha xuddi row-lock kabi to'liq serializatsiya beradi.
   */
  async lockSellerPayableBalance(
    tx: Prisma.TransactionClient,
    sellerId: string,
    currency: string,
  ): Promise<{ accountId: string; balance: bigint }> {
    const lockKey = `SELLER_PAYABLE:${sellerId}:${currency}`;
    // `$executeRaw` (natija YO'Q, faqat effekt) — `$queryRaw` `void`
    // qaytadigan funksiyani deserializatsiya qila olmaydi ("Failed to
    // deserialize column of type 'void'").
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const account = await this.getOrCreateUserAccount(tx, 'SELLER_PAYABLE', sellerId, currency);
    const agg = await tx.ledgerEntry.aggregate({ where: { accountId: account.id }, _sum: { amount: true } });
    return { accountId: account.id, balance: agg._sum.amount ?? 0n };
  }

  /**
   * Bo'lim 23/25/50 — `Payout` yaratilgan ZAHOTI, tashqi provider
   * chaqiruvidan OLDIN (bo'lim 29: uzoq tranzaksiya ichida HTTP call yo'q).
   * Chaqiruvchi `lockSellerPayableBalance()` orqali yetarlilikni ALLAQACHON
   * tekshirgan bo'lishi SHART — bu metod faqat arifmetika/posting.
   */
  async reservePayout(tx: Prisma.TransactionClient, payout: Payout): Promise<LedgerTransaction | null> {
    const lines = computePayoutReservationLines(payout.amount);
    return this.postJournal(tx, {
      type: 'PAYOUT_RESERVATION',
      sourceId: payout.id,
      currency: payout.currency,
      description: `Payout reservation — seller ${payout.sellerId}`,
      lines,
      context: { sellerId: payout.sellerId },
    });
  }

  /**
   * Bo'lim 31/32 — `Payout.status → FAILED`. Original `PAYOUT_RESERVATION`
   * yozuvi HECH QACHON o'zgartirilmaydi — bu YANGI, mustaqil reversal
   * journal (birinchi haqiqiy reversal naqshi, Bosqich 6'da faqat
   * hujjatlashtirilgan edi).
   */
  async releasePayout(tx: Prisma.TransactionClient, payout: Payout): Promise<LedgerTransaction | null> {
    const lines = computePayoutReleaseLines(payout.amount);
    return this.postJournal(tx, {
      type: 'PAYOUT_RELEASE',
      sourceId: payout.id,
      currency: payout.currency,
      description: `Payout release (failed) — seller ${payout.sellerId}`,
      lines,
      context: { sellerId: payout.sellerId },
    });
  }

  // ── Bosqich 8: Dispute hold / resolution ──────────────────────────────

  /**
   * Bo'lim 9/40/41/12 — POST-settlement `Dispute` OCHILGANDA chaqiriladi
   * (`DisputeService.open()`). `lockSellerPayableBalance()` BILAN BIR XIL
   * advisory lock'ni qayta ishlatadi (bo'lim 12 — Payout bilan lock domain
   * YAGONA bo'lishi SHART, aks holda ikkalasi bir vaqtda seller balansidan
   * foydalanishga urinishi mumkin). `heldAmount = min(sellerNetSnapshot,
   * joriy balans)` — agar seller allaqachon (qisman) payout qilib ulgurgan
   * bo'lsa, FAQAT mavjud qismi ushlab qolinadi, negative balans HECH QACHON
   * yaratilmaydi. Agar mavjud balans 0 bo'lsa — hech qanday journal
   * yozilmaydi, `heldAmount=0n` qaytadi (Dispute BARIBIR ochiladi —
   * workflow/evidence process moliyaviy holatga bog'liq emas, bo'lim 40).
   */
  async openDisputeHold(
    tx: Prisma.TransactionClient,
    dispute: Dispute,
    sellerId: string,
    currency: string,
    sellerNetSnapshot: bigint,
  ): Promise<{ ledgerTx: LedgerTransaction | null; heldAmount: bigint }> {
    const { balance } = await this.lockSellerPayableBalance(tx, sellerId, currency);
    const heldAmount = sellerNetSnapshot < balance ? sellerNetSnapshot : balance;
    if (heldAmount <= 0n) return { ledgerTx: null, heldAmount: 0n };

    const lines = computeDisputeHoldLines(heldAmount);
    const ledgerTx = await this.postJournal(tx, {
      type: 'DISPUTE_HOLD',
      sourceId: dispute.id,
      currency,
      description: `Dispute hold — seller ${sellerId}, dispute ${dispute.id}`,
      lines,
      context: { sellerId },
    });
    return { ledgerTx, heldAmount };
  }

  /**
   * Bo'lim 37/38 — `Dispute` REJECTED/CANCELLED (moliyaviy resolution YO'Q):
   * ushlab qolingan mablag' TO'LIQ SELLER_PAYABLE'ga qaytadi, hech qanday
   * komissiya yo'q. Faqat `dispute.heldAmount > 0` bo'lganda chaqiriladi
   * (chaqiruvchi tekshiradi) — pre-settlement disputlarda hech qachon
   * chaqirilmaydi (hold umuman yo'q).
   */
  async releaseDisputeHoldFully(tx: Prisma.TransactionClient, dispute: Dispute, sellerId: string): Promise<LedgerTransaction | null> {
    const lines = computeDisputeHoldReleaseLines(dispute.heldAmount);
    return this.postJournal(tx, {
      type: 'DISPUTE_HOLD_RELEASE',
      sourceId: dispute.id,
      currency: dispute.currency,
      description: `Dispute hold release (${dispute.status}) — dispute ${dispute.id}`,
      lines,
      context: { sellerId },
    });
  }

  /**
   * Bo'lim 23/30/31 — resolve() vaqtida SELLER-BOUND qismni ko'chiradi
   * (`sellerAwardAmount > 0`). Manba `dispute.preSettlement`ga qarab:
   * `true` → ESCROW(buyer), `false` → DISPUTE_HOLD(seller). Komissiya —
   * `Contract.platformFeeRateBpsSnapshot` (authoritative snapshot).
   */
  async postDisputeSellerAward(
    tx: Prisma.TransactionClient,
    dispute: Dispute,
    contract: Contract,
    sellerAwardAmount: bigint,
  ): Promise<LedgerTransaction | null> {
    const debitRole = dispute.preSettlement ? 'ESCROW' : 'DISPUTE_HOLD';
    const lines = computeDisputeResolutionLines(debitRole, sellerAwardAmount, contract.platformFeeRateBpsSnapshot);
    return this.postJournal(tx, {
      type: 'DISPUTE_RESOLUTION',
      sourceId: dispute.id,
      currency: dispute.currency,
      description: `Dispute resolution (seller award) — dispute ${dispute.id}, contract ${contract.id}`,
      lines,
      context: { buyerId: contract.buyerId, sellerId: contract.sellerId },
    });
  }

  /**
   * Bo'lim 25/60 — Dispute-driven buyer refund uchun mavjud `REFUND` turi
   * (Bosqich 7) qayta ishlatiladi, lekin manba hisobi `dispute.
   * preSettlement`ga qarab farqlanadi: `true` → ESCROW (`refundPayment()`
   * bilan BIR XIL hisob, lekin bu funksiya `Contract.status==='ACTIVE'`
   * talab qilmaydi — dispute allaqachon tasdiqlagan), `false` → DISPUTE_
   * HOLD. Ikkalasida ham kredit — REFUND_CLEARING. `refundPayment()`ning
   * o'zi ATAYLAB o'zgartirilmagan (Bosqich 7 kontrakti, bo'lim 26).
   */
  async postDisputeBuyerRefund(
    tx: Prisma.TransactionClient,
    refund: Refund,
    dispute: Dispute,
    contract: Contract,
  ): Promise<LedgerTransaction | null> {
    if (dispute.contractId !== contract.id || dispute.id !== refund.disputeId || refund.contractId !== contract.id) {
      throw new InvariantViolationError('Ledger dispute refund: Contract/Dispute/Refund mos emas', {
        contractId: contract.id,
        disputeId: dispute.id,
        refundId: refund.id,
      });
    }
    if (contract.currency !== refund.currency) {
      throw new InvariantViolationError('Ledger dispute refund: valyuta mos emas', {
        contractId: contract.id,
        refundId: refund.id,
      });
    }

    const lines = dispute.preSettlement ? computeRefundLines(refund.amount) : computeDisputeHoldToRefundLines(refund.amount);
    return this.postJournal(tx, {
      type: 'REFUND',
      sourceId: refund.id,
      currency: refund.currency,
      description: `Dispute refund — dispute ${dispute.id}, contract ${contract.id}`,
      lines,
      context: dispute.preSettlement ? { buyerId: contract.buyerId } : { sellerId: contract.sellerId },
    });
  }

  // ── O'qish (balans, staff diagnostika) ───────────────────────────────

  /** Bo'lim 25/34/56 — mutable `balance` ustuni YO'Q, har doim ledgerdan hisoblanadi. */
  async getUserAccountBalance(
    type: Extract<LedgerAccountRole, 'ESCROW' | 'SELLER_PAYABLE' | 'PAYOUT_CLEARING' | 'DISPUTE_HOLD'>,
    userId: string,
    currency: string,
  ): Promise<bigint> {
    const account = await this.prisma.ledgerAccount.findFirst({
      where: { type, ownerType: 'USER', ownerId: userId, currency },
      select: { id: true },
    });
    if (!account) return 0n;
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { accountId: account.id },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0n;
  }

  // ── Staff read-only (bo'lim 33/60) ───────────────────────────────────

  async listTransactionsForStaff(
    filters: { type?: LedgerTransaction['type']; sourceId?: string },
    page: number,
    perPage: number,
  ): Promise<Page<LedgerTransaction & { entries: (Prisma.LedgerEntryGetPayload<{ include: { account: true } }>)[] }>> {
    const where: Prisma.LedgerTransactionWhereInput = { type: filters.type, sourceId: filters.sourceId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ledgerTransaction.findMany({
        where,
        include: { entries: { include: { account: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.ledgerTransaction.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  async getTransactionForStaffOrThrow(
    id: string,
  ): Promise<LedgerTransaction & { entries: (Prisma.LedgerEntryGetPayload<{ include: { account: true } }>)[] }> {
    const transaction = await this.prisma.ledgerTransaction.findUnique({
      where: { id },
      include: { entries: { include: { account: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!transaction) throw new NotFoundError('Ledger tranzaksiyasi topilmadi', 'NOT_FOUND');
    return transaction;
  }
}
