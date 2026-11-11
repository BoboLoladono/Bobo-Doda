import { parseDisputeAwards, type DisputeAwardInput } from './dispute-award.util';
import { Injectable } from '@nestjs/common';
import { Prisma, type Dispute, type DisputeEvidence, type DisputeReason, type DisputeStatus, type Refund } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, InvalidTransitionError, NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { RefundService } from '@/modules/refund/refund.service';
import { DISPUTE_OPEN_STATUSES, DISPUTE_USER_CANCELLABLE_STATUSES, type DisputeEvidenceTypeValue } from './dispute.constants';

const PRISMA_UNIQUE_VIOLATION = 'P2002';
const SYSTEM_ACTOR: AuditActor = { id: null, type: 'SYSTEM', name: 'dispute-service' };

/**
 * `Dispute` — Contract-darajasida (bo'lim 3/42: bizning haqiqiy settlement
 * bitta contract uchun BIR MARTA, YAXLIT — docs'dagi eski per-milestone
 * mock modelidan farqli, Bosqich 4/6 qarori), shuning uchun "qaysi
 * milestone disputed" savolining moliyaviy ma'nosi yo'q.
 *
 * Ikki rejim (`Dispute.preSettlement`):
 *  - PRE-settlement (Contract ACTIVE): ESCROW o'zi tabiiy "hold" — hech
 *    qanday ledger harakati OCHILISHDA kerak emas, `heldAmount =
 *    disputedAmount = agreedAmount` har doim.
 *  - POST-settlement (Contract COMPLETED): OCHILISHDA DARHOL `DISPUTE_HOLD`
 *    journal — `LedgerService.openDisputeHold()` xuddi Payout bilan BIR
 *    XIL advisory lock domenini ishlatadi (bo'lim 12) — seller balansidan
 *    ikkalasi (payout reservation, dispute hold) BIR VAQTDA foydalana
 *    olmaydi. `heldAmount <= disputedAmount` (agar seller allaqachon
 *    (qisman) payout qilib ulgurgan bo'lsa — bo'lim 40/41: negative balans
 *    HECH QACHON yaratilmaydi, ortiqcha qism "yo'q" deb hisoblanadi).
 */
@Injectable()
export class DisputeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundService,
  ) {}

  // ── Ochish (contract ishtirokchisi) ───────────────────────────────────

  async open(contractId: string, userId: string, reason: DisputeReason, description: string, actor: AuditActor): Promise<Dispute> {
    // Bo'lim 5 — query-scoped: topilmasa YOKI ishtirokchi bo'lmasa BIR XIL
    // 404 (existence leak yo'q — boshqa joylarda ishlatilgan naqsh bilan bir xil).
    const contract = await this.prisma.contract.findFirst({
      where: { id: contractId, OR: [{ buyerId: userId }, { sellerId: userId }] },
    });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
    if (contract.status !== 'ACTIVE' && contract.status !== 'COMPLETED') {
      throw new DomainError('DISPUTE_NOT_ALLOWED', 'Bu shartnoma holati nizo ochishga yaroqli emas');
    }

    const disputeId = this.ids.next();
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Bo'lim 12/53 — lock tartibi: Contract qatori BIRINCHI (settlement/
        // refund/boshqa dispute-open bilan serializatsiya), keyin (faqat
        // post-settlement) advisory lock (`openDisputeHold` ichida).
        await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
        const freshContract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
        if (freshContract.status !== 'ACTIVE' && freshContract.status !== 'COMPLETED') {
          throw new DomainError('DISPUTE_NOT_ALLOWED', 'Bu shartnoma holati nizo ochishga yaroqli emas');
        }

        // Bo'lim 7/54 — tezkor qayta tekshiruv (HAQIQIY himoya — DB partial
        // unique index, pastdagi catch).
        const existingOpen = await tx.dispute.findFirst({
          where: { contractId, status: { in: DISPUTE_OPEN_STATUSES as DisputeStatus[] } },
          select: { id: true },
        });
        if (existingOpen) {
          throw new DomainError('DISPUTE_ALREADY_OPEN', 'Bu shartnoma uchun allaqachon ochiq nizo bor');
        }

        const preSettlement = freshContract.status === 'ACTIVE';
        if (preSettlement) {
          const refund = await tx.refund.findFirst({
            where: { contractId, status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] } },
            select: { id: true },
          });
          if (refund) {
            throw new DomainError('CONTRACT_REFUND_IN_PROGRESS', 'Shartnoma uchun refund allaqachon boshlangan');
          }
        }
        const disputedAmount = preSettlement
          ? freshContract.agreedAmount
          : await this.ledger.getSettlementSellerNet(tx, contractId);

        const created = await tx.dispute.create({
          data: {
            id: disputeId,
            contractId,
            openedByUserId: userId,
            reason,
            description,
            status: 'OPEN',
            preSettlement,
            disputedAmount,
            heldAmount: preSettlement ? disputedAmount : 0n,
            currency: freshContract.currency,
          },
        });

        let heldAmount = created.heldAmount;
        if (!preSettlement) {
          const holdResult = await this.ledger.openDisputeHold(tx, created, freshContract.sellerId, freshContract.currency, disputedAmount);
          heldAmount = holdResult.heldAmount;
          await tx.dispute.update({ where: { id: disputeId }, data: { heldAmount } });
          if (holdResult.ledgerTx) {
            await this.audit.record(
              {
                actor: SYSTEM_ACTOR,
                action: 'LEDGER_DISPUTE_HELD',
                resourceType: 'LEDGER_TRANSACTION',
                resourceId: holdResult.ledgerTx.id,
                contextId: disputeId,
                newState: { sellerId: freshContract.sellerId, amount: heldAmount.toString() },
              },
              tx,
            );
          }
        }

        await this.audit.record(
          {
            actor,
            action: 'DISPUTE_OPENED',
            resourceType: 'DISPUTE',
            resourceId: disputeId,
            contextId: contractId,
            newState: { status: 'OPEN', reason, preSettlement, heldAmount: heldAmount.toString() },
          },
          tx,
        );
        await this.recordEvent(tx, disputeId, 'OPENED', actor, { reason });
        await this.outbox.enqueue(
          { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_OPENED', payload: { contractId } },
          tx,
        );

        return tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === PRISMA_UNIQUE_VIOLATION) {
        throw new DomainError('DISPUTE_ALREADY_OPEN', 'Bu shartnoma uchun allaqachon ochiq nizo bor');
      }
      throw err;
    }
  }

  // ── Evidence ───────────────────────────────────────────────────────────

  async addEvidence(
    disputeId: string,
    dto: { type: DisputeEvidenceTypeValue; text?: string; fileReference?: string; milestoneId?: string },
    submitter: { userId?: string; staffId?: string },
    actor: AuditActor,
  ): Promise<DisputeEvidence> {
    const dispute = await this.getByIdOrThrow(disputeId);
    if (!DISPUTE_OPEN_STATUSES.includes(dispute.status)) {
      throw new DomainError('INVALID_TRANSITION', 'Yopiq nizoga dalil qo‘shib bo‘lmaydi');
    }
    if (dto.milestoneId) {
      const milestone = await this.prisma.milestone.findFirst({ where: { id: dto.milestoneId, contractId: dispute.contractId } });
      if (!milestone) throw new NotFoundError('Bosqich topilmadi', 'MILESTONE_NOT_FOUND');
    }

    return this.prisma.$transaction(async (tx) => {
      const evidence = await tx.disputeEvidence.create({
        data: {
          id: this.ids.next(),
          disputeId,
          submittedByUserId: submitter.userId,
          submittedByStaffId: submitter.staffId,
          type: dto.type,
          text: dto.text,
          fileReference: dto.fileReference,
          milestoneId: dto.milestoneId,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'DISPUTE_EVIDENCE_ADDED',
          resourceType: 'DISPUTE',
          resourceId: disputeId,
          contextId: dispute.contractId,
          newState: { evidenceId: evidence.id, type: dto.type },
        },
        tx,
      );
      await this.recordEvent(tx, disputeId, 'EVIDENCE_ADDED', actor, { evidenceId: evidence.id, type: dto.type });
      await this.outbox.enqueue(
        { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_EVIDENCE_ADDED', payload: { evidenceId: evidence.id } },
        tx,
      );
      return evidence;
    });
  }

  async listEvidence(disputeId: string): Promise<DisputeEvidence[]> {
    return this.prisma.disputeEvidence.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } });
  }

  async listEvents(disputeId: string) {
    return this.prisma.disputeEvent.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } });
  }

  private async recordEvent(
    tx: Prisma.TransactionClient,
    disputeId: string,
    type: string,
    actor: AuditActor,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await tx.disputeEvent.create({
      data: {
        id: this.ids.next(),
        disputeId,
        type,
        actorType: actor.type,
        actorId: actor.id,
        actorName: actor.name,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  // ── User: cancel ──────────────────────────────────────────────────────

  /** Bo'lim 37 — FAQAT ochgan tomon, FAQAT OPEN'dan (UNDER_REVIEW'dan keyin cancel YO'Q — explicit qoida). */
  async cancel(disputeId: string, userId: string, actor: AuditActor): Promise<Dispute> {
    const dispute = await this.getByIdOrThrow(disputeId);
    if (dispute.openedByUserId !== userId) {
      throw new NotFoundError('Nizo topilmadi', 'DISPUTE_NOT_FOUND');
    }
    return this.prisma.$transaction(async (tx) => {
      const cas = await tx.dispute.updateMany({
        where: { id: disputeId, status: { in: DISPUTE_USER_CANCELLABLE_STATUSES as DisputeStatus[] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (cas.count === 0) {
        throw new InvalidTransitionError(dispute.status, 'CANCELLED', 'Dispute', 'Faqat OPEN nizoni qaytarib olish mumkin');
      }
      await this.releaseHoldIfAny(tx, dispute);
      await this.audit.record(
        {
          actor,
          action: 'DISPUTE_CANCELLED',
          resourceType: 'DISPUTE',
          resourceId: disputeId,
          contextId: dispute.contractId,
          previousState: { status: dispute.status },
          newState: { status: 'CANCELLED' },
        },
        tx,
      );
      await this.recordEvent(tx, disputeId, 'CANCELLED', actor);
      await this.outbox.enqueue(
        { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_CANCELLED', payload: { contractId: dispute.contractId } },
        tx,
      );
      return tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    });
  }

  // ── Staff: review / reject / resolve ──────────────────────────────────

  async startReview(disputeId: string, actor: AuditActor): Promise<Dispute> {
    const dispute = await this.getByIdOrThrow(disputeId);
    const cas = await this.prisma.dispute.updateMany({
      where: { id: disputeId, status: 'OPEN' },
      data: { status: 'UNDER_REVIEW', reviewStartedAt: new Date() },
    });
    if (cas.count === 0) {
      throw new InvalidTransitionError(dispute.status, 'UNDER_REVIEW', 'Dispute');
    }
    await this.audit.record({
      actor,
      action: 'DISPUTE_REVIEW_STARTED',
      resourceType: 'DISPUTE',
      resourceId: disputeId,
      contextId: dispute.contractId,
      previousState: { status: 'OPEN' },
      newState: { status: 'UNDER_REVIEW' },
    });
    await this.prisma.$transaction(async (tx) => this.recordEvent(tx, disputeId, 'REVIEW_STARTED', actor));
    await this.outbox.enqueue({
      aggregateType: 'DISPUTE',
      aggregateId: disputeId,
      eventType: 'DISPUTE_REVIEW_STARTED',
      payload: { contractId: dispute.contractId },
    });
    return this.getByIdOrThrow(disputeId);
  }

  async reject(disputeId: string, staffId: string, resolutionReason: string, actor: AuditActor): Promise<Dispute> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
      const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new NotFoundError('Nizo topilmadi', 'DISPUTE_NOT_FOUND');

      const cas = await tx.dispute.updateMany({
        where: { id: disputeId, status: { in: DISPUTE_OPEN_STATUSES as DisputeStatus[] } },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectedByStaffId: staffId, resolutionReason },
      });
      if (cas.count === 0) {
        throw new InvalidTransitionError(dispute.status, 'REJECTED', 'Dispute');
      }
      await this.releaseHoldIfAny(tx, dispute);
      await this.audit.record(
        {
          actor,
          action: 'DISPUTE_REJECTED',
          resourceType: 'DISPUTE',
          resourceId: disputeId,
          contextId: dispute.contractId,
          previousState: { status: dispute.status },
          newState: { status: 'REJECTED', resolutionReason },
        },
        tx,
      );
      await this.recordEvent(tx, disputeId, 'REJECTED', actor, { resolutionReason });
      await this.outbox.enqueue(
        { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_REJECTED', payload: { contractId: dispute.contractId } },
        tx,
      );
      return tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    });
  }

  private async releaseHoldIfAny(tx: Prisma.TransactionClient, dispute: Dispute): Promise<void> {
    if (dispute.preSettlement || dispute.heldAmount <= 0n) return;
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: dispute.contractId } });
    const releaseTx = await this.ledger.releaseDisputeHoldFully(tx, dispute, contract.sellerId);
    if (releaseTx) {
      await this.audit.record(
        {
          actor: SYSTEM_ACTOR,
          action: 'LEDGER_DISPUTE_RELEASED',
          resourceType: 'LEDGER_TRANSACTION',
          resourceId: releaseTx.id,
          contextId: dispute.id,
          newState: { sellerId: contract.sellerId, amount: dispute.heldAmount.toString() },
        },
        tx,
      );
    }
  }

  /**
   * Bo'lim 20/33 — buyerAward + sellerAward === dispute.heldAmount
   * (majburiy invariant). Seller-bound qism (agar >0) DARHOL ledgerga
   * yoziladi (`DISPUTE_RESOLUTION`) — tashqi chaqiruv YO'Q, xavfsiz atomik.
   * Buyer-bound qism (agar >0) — DEFERRED: `Refund` qatori (PENDING)
   * SHU tranzaksiyada yaratiladi, lekin haqiqiy ledger harakati
   * (`REFUND` journal) FAQAT webhook orqali `RefundService.applyEvent()`
   * ichida (bo'lim 25 — crash-safe orchestration, provider HTTP chaqiruvi
   * TX TASHQARISIDA).
   */
  async resolve(
    disputeId: string,
    staffId: string,
    buyerAwardAmountSom: number | undefined,
    sellerAwardAmountSom: number | undefined,
    resolutionReason: string,
    actor: AuditActor,
    exactAwards?: Pick<DisputeAwardInput, 'buyerAwardAmountTiyin' | 'sellerAwardAmountTiyin'>,
  ): Promise<{ dispute: Dispute; refund: Refund | null }> {
    const { buyerAward, sellerAward } = parseDisputeAwards({
      buyerAwardAmount: buyerAwardAmountSom,
      sellerAwardAmount: sellerAwardAmountSom,
      ...exactAwards,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM disputes WHERE id = ${disputeId}::uuid FOR UPDATE`;
      const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new NotFoundError('Nizo topilmadi', 'DISPUTE_NOT_FOUND');
      if (!DISPUTE_OPEN_STATUSES.includes(dispute.status)) {
        throw new InvalidTransitionError(dispute.status, 'RESOLVED', 'Dispute');
      }
      if (buyerAward + sellerAward !== dispute.heldAmount) {
        throw new DomainError(
          'INVALID_AMOUNT',
          `buyerAwardAmount + sellerAwardAmount ushlab qolingan summaga (${dispute.heldAmount.toString()} tiyin) teng bo‘lishi shart`,
        );
      }

      await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${dispute.contractId}::uuid FOR UPDATE`;
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: dispute.contractId } });
      // Opening an unfunded dispute is allowed for support, but an award must
      // never manufacture seller credit from an escrow that was never funded.
      if (dispute.preSettlement && buyerAward + sellerAward > 0n) {
        const funding = await tx.payment.findFirst({ where: { contractId: contract.id, status: 'SUCCEEDED' } });
        if (!funding || !(await this.ledger.findFundingTransaction(tx, funding.id))) {
          throw new DomainError('CONTRACT_NOT_FUNDED', 'Moliyaviy qaror uchun shartnoma avval to‘lanishi shart');
        }
      }

      const resolutionType =
        sellerAward === 0n ? 'BUYER_FULL_REFUND' : buyerAward === 0n ? 'SELLER_FULL_RELEASE' : 'SPLIT';

      if (sellerAward > 0n) {
        const resolutionTx = await this.ledger.postDisputeSellerAward(tx, dispute, contract, sellerAward);
        if (resolutionTx) {
          await this.audit.record(
            {
              actor: SYSTEM_ACTOR,
              action: 'LEDGER_DISPUTE_RESOLVED',
              resourceType: 'LEDGER_TRANSACTION',
              resourceId: resolutionTx.id,
              contextId: disputeId,
              newState: { sellerAward: sellerAward.toString() },
            },
            tx,
          );
        }
        // Bo'lim 22/23 — pre-settlement'da seller HAR QANDAY musbat award
        // olsa, Contract yakunlanadi (SPLIT ham, 100% ham) — buyer-bound
        // qism (agar bor bo'lsa) endi ESCROW'dagi QOLGAN qismdan chiqadi,
        // Contract holati bunga bog'liq emas. POST-settlement'da Contract
        // holati UMUMAN o'zgarmaydi (allaqachon COMPLETED).
        if (dispute.preSettlement) {
          await tx.contract.updateMany({ where: { id: contract.id, status: 'ACTIVE' }, data: { status: 'COMPLETED' } });
          await this.audit.record(
            {
              actor,
              action: 'CONTRACT_COMPLETED',
              resourceType: 'CONTRACT',
              resourceId: contract.id,
              contextId: disputeId,
              previousState: { status: 'ACTIVE' },
              newState: { status: 'COMPLETED' },
            },
            tx,
          );
          await this.outbox.enqueue(
            { aggregateType: 'CONTRACT', aggregateId: contract.id, eventType: 'CONTRACT_COMPLETED', payload: { disputeId } },
            tx,
          );
        }
        await this.outbox.enqueue(
          { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_SELLER_FUNDS_RELEASED', payload: { sellerAward: sellerAward.toString() } },
          tx,
        );
      } else if (dispute.preSettlement) {
        // Pre-settlement'da seller award 0 (100% BUYER_FULL_REFUND) bo'lsa, Contract
        // DARHOL CANCELLED bo'ladi — tashqi refund provider kechikishi yoki xatosi
        // shartnoma bo'yicha qo'shimcha bosqich tasdiqlanishiga YO'L QO'YMAYDI.
        await tx.contract.updateMany({ where: { id: contract.id, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
        await this.audit.record(
          {
            actor,
            action: 'CONTRACT_CANCELLED',
            resourceType: 'CONTRACT',
            resourceId: contract.id,
            contextId: disputeId,
            previousState: { status: 'ACTIVE' },
            newState: { status: 'CANCELLED', reason: 'DISPUTE_BUYER_FULL_REFUND' },
          },
          tx,
        );
        await this.outbox.enqueue(
          { aggregateType: 'CONTRACT', aggregateId: contract.id, eventType: 'CONTRACT_CANCELLED', payload: { disputeId, reason: 'DISPUTE_BUYER_FULL_REFUND' } },
          tx,
        );
      }

      let refund: Refund | null = null;
      if (buyerAward > 0n) {
        const payment = await tx.payment.findFirst({ where: { contractId: contract.id, status: 'SUCCEEDED' } });
        if (!payment) {
          throw new DomainError('PAYMENT_NOT_FOUND', 'Ushbu shartnoma uchun muvaffaqiyatli to‘lov topilmadi');
        }
        refund = await this.refunds.createDisputeRefundRow(tx, {
          id: this.ids.next(),
          contractId: contract.id,
          paymentId: payment.id,
          disputeId,
          amount: buyerAward,
          currency: dispute.currency,
          resolvedByStaffId: staffId,
          actor,
        });
        await this.outbox.enqueue(
          { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_BUYER_REFUND_ALLOCATED', payload: { refundId: refund.id, amount: buyerAward.toString() } },
          tx,
        );
      }

      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedByStaffId: staffId,
          resolutionType,
          buyerAwardAmount: buyerAward,
          sellerAwardAmount: sellerAward,
          resolutionReason,
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'DISPUTE_RESOLVED',
          resourceType: 'DISPUTE',
          resourceId: disputeId,
          contextId: contract.id,
          previousState: { status: dispute.status },
          newState: { status: 'RESOLVED', resolutionType, buyerAward: buyerAward.toString(), sellerAward: sellerAward.toString() },
        },
        tx,
      );
      await this.recordEvent(tx, disputeId, 'RESOLVED', actor, { resolutionType, buyerAward: buyerAward.toString(), sellerAward: sellerAward.toString() });
      await this.outbox.enqueue(
        { aggregateType: 'DISPUTE', aggregateId: disputeId, eventType: 'DISPUTE_RESOLVED', payload: { contractId: contract.id, resolutionType } },
        tx,
      );

      const updatedDispute = await tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
      const payment = buyerAward > 0n ? await tx.payment.findFirstOrThrow({ where: { contractId: contract.id, status: 'SUCCEEDED' } }) : null;
      return { dispute: updatedDispute, refund, payment };
    });

    // Bo'lim 25/33 — provider HTTP chaqiruvi TRANZAKSIYA TASHQARISIDA.
    if (result.refund && result.payment) {
      await this.refunds.callProviderAndAdvance(result.refund, result.payment);
    }
    return { dispute: result.dispute, refund: result.refund };
  }

  // ── O'qish ────────────────────────────────────────────────────────────

  async getParticipantOwnedOrThrow(id: string, userId: string): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findFirst({
      where: { id, contract: { OR: [{ buyerId: userId }, { sellerId: userId }] } },
    });
    if (!dispute) throw new NotFoundError('Nizo topilmadi', 'DISPUTE_NOT_FOUND');
    return dispute;
  }

  async getByIdOrThrow(id: string): Promise<Dispute> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id } });
    if (!dispute) throw new NotFoundError('Nizo topilmadi', 'DISPUTE_NOT_FOUND');
    return dispute;
  }

  async listForParticipant(userId: string, page: number, perPage: number, status?: Dispute['status']): Promise<Page<Dispute>> {
    return this.list({ contract: { OR: [{ buyerId: userId }, { sellerId: userId }] }, status }, page, perPage);
  }

  async listForStaff(
    filters: { status?: Dispute['status']; contractId?: string; buyerId?: string; sellerId?: string },
    page: number,
    perPage: number,
  ): Promise<Page<Dispute>> {
    const { buyerId, sellerId, ...rest } = filters;
    const where: Prisma.DisputeWhereInput = { ...rest };
    if (buyerId || sellerId) {
      where.contract = { ...(buyerId ? { buyerId } : {}), ...(sellerId ? { sellerId } : {}) };
    }
    return this.list(where, page, perPage);
  }

  private async list(where: Prisma.DisputeWhereInput, page: number, perPage: number): Promise<Page<Dispute>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dispute.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.dispute.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }
}
