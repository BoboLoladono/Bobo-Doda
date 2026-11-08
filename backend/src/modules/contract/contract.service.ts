import { Injectable } from '@nestjs/common';
import { Prisma, type Contract, type Milestone, type PaymentStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, InvariantViolationError, NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { somToTiyin } from '@/common/money/money.util';
import { PLATFORM_FEE_RATE_BPS, computePlatformFee } from '@/common/money/fee.constant';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';
import { LedgerService } from '@/modules/ledger/ledger.service';
import type { CreateContractDto } from './dto/create-contract.dto';
import type { SubmitMilestoneDto } from './dto/submit-milestone.dto';
import type { RequestRevisionDto } from './dto/request-revision.dto';
import {
  assertDeadlineValid,
  assertMilestoneCountWithinLimit,
  assertMilestonesSumMatches,
  assertNotSelfPurchase,
} from './contract-validation.util';

type ContractWithMilestones = Contract & {
  milestones: Milestone[];
  payments?: Array<{ id: string; status: PaymentStatus; succeededAt: Date | null; createdAt: Date }>;
};

const MILESTONE_INCLUDE = {
  milestones: { orderBy: { position: 'asc' as const } },
  payments: {
    where: { status: 'SUCCEEDED' as const },
    select: { id: true, status: true, succeededAt: true, createdAt: true },
  },
};
const SERIALIZATION_CONFLICT = 'P2034';

/**
 * `Contract` — to'liq umr davri: yaratish (snapshot + Serializable
 * tranzaksiya), seller accept/reject, buyer cancel, milestone submit/
 * revision/approve (+ avtomatik `COMPLETED`). Bitta modul chegarasi
 * (Phase 3 naqshi bilan bir xil — `docs/01`: "bir modul boshqasining
 * Prisma modeliga tegmaydi").
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerService,
  ) {}

  // ── Yaratish ──────────────────────────────────────────────────────────

  async create(buyerId: string, dto: CreateContractDto): Promise<ContractWithMilestones> {
    assertMilestoneCountWithinLimit(dto.milestones.length);
    const deadline = new Date(dto.deadline);
    assertDeadlineValid(deadline);

    const run = () =>
      this.prisma.$transaction((tx) => this.createWithinTransaction(tx, buyerId, dto, deadline), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

    try {
      return await run();
    } catch (err) {
      // Bo'lim 4 — service/seller holati parallel o'zgarishi juda kam
      // uchraydigan Postgres serialization conflict beradi; bir marta
      // avtomatik qayta urinish yetarli (Prisma P2034).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === SERIALIZATION_CONFLICT) {
        return await run();
      }
      throw err;
    }
  }

  private async createWithinTransaction(
    tx: Prisma.TransactionClient,
    buyerId: string,
    dto: CreateContractDto,
    deadline: Date,
  ): Promise<ContractWithMilestones> {
    const service = await tx.service.findUnique({ where: { id: dto.serviceId } });
    if (!service || service.status !== 'ACTIVE') {
      throw new DomainError('SERVICE_NOT_AVAILABLE', 'Xizmat hozir mavjud emas');
    }
    assertNotSelfPurchase(buyerId, service.sellerId);

    const seller = await tx.user.findUniqueOrThrow({ where: { id: service.sellerId } });
    if (seller.status !== 'ACTIVE' || seller.sellerStatus !== 'APPROVED') {
      throw new DomainError('SELLER_NOT_APPROVED', 'Sotuvchi hozir mavjud emas');
    }

    const buyer = await tx.user.findUniqueOrThrow({ where: { id: buyerId } });
    const category = await tx.category.findUniqueOrThrow({ where: { id: service.categoryId } });
    const sellerApp = await tx.sellerApplication.findFirst({
      where: { userId: service.sellerId, status: 'APPROVED' },
      orderBy: { reviewedAt: 'desc' },
    });
    const sellerDisplayName = sellerApp?.displayName ?? seller.fullName ?? seller.phone;

    const targetAmount = dto.agreedAmount ? somToTiyin(dto.agreedAmount) : service.price;
    assertMilestonesSumMatches(dto.milestones, targetAmount);

    const feeAmount = computePlatformFee(targetAmount, PLATFORM_FEE_RATE_BPS);
    const contractId = this.ids.next();

    await tx.contract.create({
      data: {
        id: contractId,
        buyerId,
        sellerId: service.sellerId,
        serviceId: service.id,
        serviceTitleSnapshot: service.title,
        serviceDescriptionSnapshot: service.description,
        categoryNameSnapshot: category.nameUz,
        sellerDisplayNameSnapshot: sellerDisplayName,
        agreedAmount: targetAmount,
        currency: service.currency,
        platformFeeRateBpsSnapshot: PLATFORM_FEE_RATE_BPS,
        platformFeeAmountSnapshot: feeAmount,
        deadline,
        status: 'PENDING_SELLER',
      },
    });

    await tx.milestone.createMany({
      data: dto.milestones.map((m, idx) => ({
        id: this.ids.next(),
        contractId,
        title: m.title,
        description: m.description,
        amount: somToTiyin(m.amount),
        position: idx + 1,
        dueAt: m.dueAt ? new Date(m.dueAt) : null,
      })),
    });

    await this.audit.record(
      {
        actor: { id: buyerId, type: 'USER', name: buyer.fullName ?? buyer.phone },
        action: 'CONTRACT_CREATED',
        resourceType: 'CONTRACT',
        resourceId: contractId,
        contextId: service.sellerId,
        newState: { status: 'PENDING_SELLER', serviceId: service.id, sellerId: service.sellerId },
      },
      tx,
    );
    await this.outbox.enqueue(
      {
        aggregateType: 'CONTRACT',
        aggregateId: contractId,
        eventType: 'CONTRACT_CREATED',
        payload: { buyerId, sellerId: service.sellerId },
      },
      tx,
    );

    return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: MILESTONE_INCLUDE });
  }

  // ── O'qish (egalik query-scope'da) ───────────────────────────────────

  async getBuyerOwnedOrThrow(id: string, buyerId: string): Promise<ContractWithMilestones> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, buyerId },
      include: MILESTONE_INCLUDE,
    });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
    return contract;
  }

  async getSellerOwnedOrThrow(id: string, sellerId: string): Promise<ContractWithMilestones> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, sellerId },
      include: MILESTONE_INCLUDE,
    });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
    return contract;
  }

  async getByIdOrThrow(id: string): Promise<ContractWithMilestones> {
    const contract = await this.prisma.contract.findUnique({ where: { id }, include: MILESTONE_INCLUDE });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
    return contract;
  }

  async listForBuyer(
    buyerId: string,
    page: number,
    perPage: number,
    status?: Contract['status'],
  ): Promise<Page<ContractWithMilestones>> {
    return this.list({ buyerId, status }, page, perPage);
  }

  async listForSeller(
    sellerId: string,
    page: number,
    perPage: number,
    status?: Contract['status'],
  ): Promise<Page<ContractWithMilestones>> {
    return this.list({ sellerId, status }, page, perPage);
  }

  async listForStaff(
    filters: { status?: Contract['status']; buyerId?: string; sellerId?: string; serviceId?: string },
    page: number,
    perPage: number,
  ): Promise<Page<ContractWithMilestones>> {
    return this.list(filters, page, perPage);
  }

  private async list(
    where: Prisma.ContractWhereInput,
    page: number,
    perPage: number,
  ): Promise<Page<ContractWithMilestones>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        include: MILESTONE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  // ── Seller: accept / reject ──────────────────────────────────────────

  async accept(contractId: string, sellerId: string, actor: AuditActor): Promise<ContractWithMilestones> {
    const existing = await this.getSellerOwnedOrThrow(contractId, sellerId);
    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.contract.updateMany({
        where: { id: contractId, sellerId, status: 'PENDING_SELLER' },
        data: { status: 'ACTIVE' },
      });
      if (cas.count === 0) return null;

      // Barcha bosqich birgalikda ishga tushadi — Bosqich 5/6'da bu
      // "escrow fund" bilan almashtiriladi, hozir shunchaki ish boshlanishi.
      await tx.milestone.updateMany({
        where: { contractId, status: 'PENDING' },
        data: { status: 'IN_PROGRESS' },
      });

      await this.audit.record(
        {
          actor,
          action: 'CONTRACT_ACCEPTED',
          resourceType: 'CONTRACT',
          resourceId: contractId,
          contextId: existing.buyerId,
          previousState: { status: 'PENDING_SELLER' },
          newState: { status: 'ACTIVE' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'CONTRACT',
          aggregateId: contractId,
          eventType: 'CONTRACT_ACCEPTED',
          payload: { buyerId: existing.buyerId },
        },
        tx,
      );
      return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: MILESTONE_INCLUDE });
    });
    if (!result) throw new DomainError('INVALID_TRANSITION', 'Bu shartnoma javob kutish holatida emas');
    return result;
  }

  async reject(contractId: string, sellerId: string, actor: AuditActor): Promise<ContractWithMilestones> {
    const existing = await this.getSellerOwnedOrThrow(contractId, sellerId);
    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.contract.updateMany({
        where: { id: contractId, sellerId, status: 'PENDING_SELLER' },
        data: { status: 'REJECTED' },
      });
      if (cas.count === 0) return null;

      await this.audit.record(
        {
          actor,
          action: 'CONTRACT_REJECTED',
          resourceType: 'CONTRACT',
          resourceId: contractId,
          contextId: existing.buyerId,
          previousState: { status: 'PENDING_SELLER' },
          newState: { status: 'REJECTED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'CONTRACT',
          aggregateId: contractId,
          eventType: 'CONTRACT_REJECTED',
          payload: { buyerId: existing.buyerId },
        },
        tx,
      );
      return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: MILESTONE_INCLUDE });
    });
    if (!result) throw new DomainError('INVALID_TRANSITION', 'Bu shartnoma javob kutish holatida emas');
    return result;
  }

  // ── Buyer: cancel ─────────────────────────────────────────────────────

  /**
   * FAQAT `PENDING_SELLER`dan (bo'lim 10 — "eng xavfsiz minimal flow"):
   * seller hali qaror qilmagan bo'lsa buyer fikridan qaytishi mumkin.
   * `ACTIVE`dan unilateral cancel BU BOSQICHDA YO'Q — moliyaviy oqim
   * (Bosqich 5+) kelganda cancellation escrow/refund bilan bog'liq
   * bo'ladi, hozir buni ochiq qoldirish xavfli.
   */
  async cancel(contractId: string, buyerId: string, actor: AuditActor): Promise<ContractWithMilestones> {
    const existing = await this.getBuyerOwnedOrThrow(contractId, buyerId);
    const result = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.contract.updateMany({
        where: { id: contractId, buyerId, status: 'PENDING_SELLER' },
        data: { status: 'CANCELLED' },
      });
      if (cas.count === 0) return null;

      await this.audit.record(
        {
          actor,
          action: 'CONTRACT_CANCELLED',
          resourceType: 'CONTRACT',
          resourceId: contractId,
          contextId: existing.sellerId,
          previousState: { status: 'PENDING_SELLER' },
          newState: { status: 'CANCELLED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'CONTRACT',
          aggregateId: contractId,
          eventType: 'CONTRACT_CANCELLED',
          payload: { sellerId: existing.sellerId },
        },
        tx,
      );
      return tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: MILESTONE_INCLUDE });
    });
    if (!result) {
      throw new DomainError('INVALID_TRANSITION', 'Faqat javob kutilayotgan shartnomani bekor qilish mumkin');
    }
    return result;
  }

  // ── Milestone: submit / revision / approve ──────────────────────────

  private async getSellerOwnedMilestoneOrThrow(
    contractId: string,
    milestoneId: string,
    sellerId: string,
  ): Promise<Milestone> {
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, contractId, contract: { sellerId } },
    });
    if (!milestone) throw new NotFoundError('Bosqich topilmadi', 'MILESTONE_NOT_FOUND');
    return milestone;
  }

  private async getBuyerOwnedMilestoneOrThrow(
    contractId: string,
    milestoneId: string,
    buyerId: string,
  ): Promise<Milestone> {
    const milestone = await this.prisma.milestone.findFirst({
      where: { id: milestoneId, contractId, contract: { buyerId } },
    });
    if (!milestone) throw new NotFoundError('Bosqich topilmadi', 'MILESTONE_NOT_FOUND');
    return milestone;
  }

  /**
   * Bosqich 6, bo'lim 1/18 — "unfunded contract hech qachon financial
   * settlement qilinadigan COMPLETED holatga yetib bormasin" invarianti.
   * Eng xavfsiz nuqta: seller ISH TOPSHIRISHDAN oldin (bo'lim 18ning
   * tavsiyasi) — agar hech qachon submit bo'lmasa, hech qachon approve/
   * COMPLETED ham bo'lmaydi. `Payment.status`ni bir marta SUCCEEDED
   * bo'lgach abadiy shunday qoladi (terminal, hech qachon orqaga
   * qaytmaydi — Bosqich 5) — shuning uchun bu yerda oddiy "hozir bormi"
   * tekshiruvi TOCTOU xavfsiz (faqat unfunded→funded tomon o'zgaradi,
   * aksincha emas).
   */
  private async assertContractFunded(contractId: string): Promise<void> {
    const funded = await this.prisma.payment.findFirst({
      where: { contractId, status: 'SUCCEEDED' },
      select: { id: true },
    });
    if (!funded) {
      throw new DomainError('CONTRACT_NOT_FUNDED', "Shartnoma hali to'lanmagan — ish topshirib bo'lmaydi");
    }
  }

  private async assertMilestoneMutationAllowed(
    tx: Prisma.TransactionClient,
    contractId: string,
    operation?: 'submit' | 'revision' | 'approve',
  ): Promise<void> {
    // The contract lock also serializes this gate with refund/dispute decisions.
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${contractId}::uuid FOR UPDATE`;
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
    if (contract.status !== 'ACTIVE') {
      throw new DomainError('INVALID_TRANSITION', 'Faqat faol shartnoma bosqichini o‘zgartirish mumkin');
    }
    if (operation === 'approve') {
      const refund = await tx.refund.findFirst({
        where: { contractId, status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] } },
        select: { id: true },
      });
      if (refund) throw new DomainError('CONTRACT_REFUND_IN_PROGRESS', 'Shartnoma uchun refund boshlangan');
      const dispute = await tx.dispute.findFirst({
        where: { contractId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
        select: { id: true },
      });
      if (dispute) throw new DomainError('DISPUTE_IN_PROGRESS', 'Ochiq nizo hal qilinishini kuting');
    }
  }

  async submitMilestone(
    contractId: string,
    milestoneId: string,
    sellerId: string,
    dto: SubmitMilestoneDto,
    actor: AuditActor,
  ): Promise<Milestone> {
    await this.getSellerOwnedMilestoneOrThrow(contractId, milestoneId, sellerId);
    await this.assertContractFunded(contractId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertMilestoneMutationAllowed(tx, contractId, 'submit');
      const cas = await tx.milestone.updateMany({
        where: { id: milestoneId, contractId, status: { in: ['IN_PROGRESS', 'REVISION_REQUESTED'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      if (cas.count === 0) return null;

      await tx.milestoneSubmission.create({
        data: {
          id: this.ids.next(),
          milestoneId,
          submittedById: sellerId,
          message: dto.message,
          deliverableUrls: dto.deliverableUrls ?? [],
        },
      });

      await this.audit.record(
        {
          actor,
          action: 'MILESTONE_SUBMITTED',
          resourceType: 'MILESTONE',
          resourceId: milestoneId,
          contextId: contractId,
          newState: { status: 'SUBMITTED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'MILESTONE',
          aggregateId: milestoneId,
          eventType: 'MILESTONE_SUBMITTED',
          payload: { contractId },
        },
        tx,
      );
      return tx.milestone.findUniqueOrThrow({ where: { id: milestoneId } });
    });
    if (!result) throw new DomainError('INVALID_TRANSITION', "Bu bosqichni hozir topshirib bo'lmaydi");
    return result;
  }

  async requestRevision(
    contractId: string,
    milestoneId: string,
    buyerId: string,
    dto: RequestRevisionDto,
    actor: AuditActor,
  ): Promise<Milestone> {
    await this.getBuyerOwnedMilestoneOrThrow(contractId, milestoneId, buyerId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertMilestoneMutationAllowed(tx, contractId, 'revision');
      const cas = await tx.milestone.updateMany({
        where: { id: milestoneId, contractId, status: 'SUBMITTED' },
        data: { status: 'REVISION_REQUESTED' },
      });
      if (cas.count === 0) return null;

      await tx.milestoneRevisionRequest.create({
        data: { id: this.ids.next(), milestoneId, requestedById: buyerId, reason: dto.reason },
      });

      await this.audit.record(
        {
          actor,
          action: 'MILESTONE_REVISION_REQUESTED',
          resourceType: 'MILESTONE',
          resourceId: milestoneId,
          contextId: contractId,
          previousState: { status: 'SUBMITTED' },
          newState: { status: 'REVISION_REQUESTED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'MILESTONE',
          aggregateId: milestoneId,
          eventType: 'MILESTONE_REVISION_REQUESTED',
          payload: { contractId, reason: dto.reason },
        },
        tx,
      );
      return tx.milestone.findUniqueOrThrow({ where: { id: milestoneId } });
    });
    if (!result) throw new DomainError('INVALID_TRANSITION', "Faqat topshirilgan bosqichga o'zgartirish so'ralishi mumkin");
    return result;
  }

  /**
   * Eng nozik metod — bo'lim 34 test #7 ("oxirgi bosqich parallel
   * approval"): ikkita OXIRGI qolgan milestone bir vaqtda approve
   * qilinsa, oddiy CAS YETARLI EMAS (har biri o'zining tranzaksiyasida
   * "qolgani bormi" deb hali COMMIT bo'lmagan boshqasini KO'RMAYDI —
   * natijada IKKALASI ham "hali qolgan bor" deb hisoblab, shartnoma
   * HECH QACHON COMPLETED bo'lmay qolishi mumkin). Yechim: `Contract`
   * qatorini `FOR UPDATE` bilan qulflab, shu contract uchun approve
   * operatsiyalarini TO'LIQ serializatsiya qilamiz (submit/revision-
   * request'ga bu kerak emas — ular boshqa-boshqa milestone qatorini
   * CAS qiladi, Postgres'ning oddiy qator qulfi allaqachon yetarli).
   */
  async approveMilestone(
    contractId: string,
    milestoneId: string,
    buyerId: string,
    actor: AuditActor,
  ): Promise<Milestone> {
    await this.getBuyerOwnedMilestoneOrThrow(contractId, milestoneId, buyerId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertMilestoneMutationAllowed(tx, contractId, 'approve');

      const cas = await tx.milestone.updateMany({
        where: { id: milestoneId, contractId, status: 'SUBMITTED' },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
      if (cas.count === 0) return null;

      await this.audit.record(
        {
          actor,
          action: 'MILESTONE_APPROVED',
          resourceType: 'MILESTONE',
          resourceId: milestoneId,
          contextId: contractId,
          previousState: { status: 'SUBMITTED' },
          newState: { status: 'APPROVED' },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'MILESTONE',
          aggregateId: milestoneId,
          eventType: 'MILESTONE_APPROVED',
          payload: { contractId },
        },
        tx,
      );

      const remaining = await tx.milestone.count({ where: { contractId, status: { not: 'APPROVED' } } });
      if (remaining === 0) {
        // Bo'lim 17 — atomik: shu bitta tranzaksiya ichida COMPLETED +
        // ledger settlement. Contract qatori allaqachon shu tranzaksiya
        // boshida `FOR UPDATE` bilan qulflangan (yuqorida) — shuning uchun
        // parallel oxirgi-milestone-approve holatida bu blok FAQAT bitta
        // g'olib tranzaksiyada ishlaydi (bo'lim 24/53).
        const completionCas = await tx.contract.updateMany({
          where: { id: contractId, status: 'ACTIVE' },
          data: { status: 'COMPLETED' },
        });
        if (completionCas.count === 1) {
          const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });

          // Bosqich 7, bo'lim 18/62 — SIMMETRIK himoya: Refund tomoni
          // (`RefundService.applyEvent()`) shu Contract qatorini BIR XIL
          // `FOR UPDATE` qulf bilan qulflab, ACTIVE'ni qayta tekshiradi —
          // shu qulf ikkalasini TO'LIQ serializatsiya qiladi. Lekin
          // `Refund.create()` o'zi hali PENDING/PROCESSING bosqichida bu
          // qulfni OLMAYDI (faqat webhook-triggered SUCCEEDED tugatish
          // oladi) — shuning uchun bu yerda ALOHIDA tekshiruv kerak: agar
          // provider tomon refund allaqachon boshlangan (yoki tugallangan)
          // bo'lsa, settlement BLOKLANADI (aks holda provider pulni
          // qaytarib bo'lgandan keyin webhook kelganda `ledger.refundPayment()`
          // Contract endi COMPLETED bo'lgani uchun rad etardi — pul
          // provider tarafida ketgan, lekin ledger'da HECH QACHON aks
          // etolmaydigan holat).
          const conflictingRefund = await tx.refund.findFirst({
            where: { contractId, status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] } },
            select: { id: true },
          });
          if (conflictingRefund) {
            throw new DomainError(
              'CONTRACT_REFUND_IN_PROGRESS',
              'Bu shartnoma uchun refund boshlangan/yakunlangan — yakuniy bosqichni tasdiqlab bo‘lmaydi',
              { context: { contractId, refundId: conflictingRefund.id } },
            );
          }

          // Bosqich 8, bo'lim 8/39 — XUDDI SHU simmetriya: ochiq nizo
          // bo'lgan Contract to'lanmagan holda COMPLETED bo'lib qolmasin
          // (aks holda dispute keyinroq PRE-settlement deb resolve
          // qilinishi kerak bo'lib qolardi, lekin Contract allaqachon
          // COMPLETED — ikkalasi mos kelmaydi).
          const openDispute = await tx.dispute.findFirst({
            where: { contractId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
            select: { id: true },
          });
          if (openDispute) {
            throw new DomainError(
              'DISPUTE_IN_PROGRESS',
              'Bu shartnoma uchun ochiq nizo bor — yakuniy bosqichni tasdiqlab bo‘lmaydi',
              { context: { contractId, disputeId: openDispute.id } },
            );
          }

          // Bo'lim 13/18 — defensive: submitMilestone() gate'i buni allaqachon
          // oldini olishi kerak, lekin settlement O'ZI HAM mustaqil tekshiradi
          // ("boshqa qatlamga ishonmaydi" — bo'lim 59). Topilmasa — bu
          // Contract hech qachon COMPLETED bo'lmasligi kerak edi;
          // `InvariantViolationError` BUTUN tranzaksiyani (milestone
          // APPROVED bo'lishini ham) rollback qiladi — jimgina COMPLETED +
          // muvaffaqiyatsiz settlement YO'Q (bo'lim 17).
          const fundingPayment = await tx.payment.findFirst({ where: { contractId, status: 'SUCCEEDED' } });
          if (!fundingPayment) {
            throw new InvariantViolationError(
              'Contract to‘lanmagan holda COMPLETED bo‘lishga urinmoqda — settlement bloklandi',
              { contractId },
            );
          }
          const fundingTransaction = await this.ledger.findFundingTransaction(tx, fundingPayment.id);
          if (!fundingTransaction) {
            throw new InvariantViolationError(
              'Payment SUCCEEDED, lekin ledger funding journal topilmadi — settlement bloklandi',
              { contractId, paymentId: fundingPayment.id },
            );
          }

          const settlement = await this.ledger.settleContract(tx, contract, fundingPayment);

          await this.audit.record(
            {
              actor,
              action: 'CONTRACT_COMPLETED',
              resourceType: 'CONTRACT',
              resourceId: contractId,
              previousState: { status: 'ACTIVE' },
              newState: { status: 'COMPLETED' },
            },
            tx,
          );
          await this.outbox.enqueue(
            { aggregateType: 'CONTRACT', aggregateId: contractId, eventType: 'CONTRACT_COMPLETED', payload: {} },
            tx,
          );

          if (settlement) {
            await this.audit.record(
              {
                actor,
                action: 'LEDGER_CONTRACT_SETTLED',
                resourceType: 'LEDGER_TRANSACTION',
                resourceId: settlement.id,
                contextId: contractId,
                newState: {
                  agreedAmount: contract.agreedAmount.toString(),
                  platformFeeAmount: contract.platformFeeAmountSnapshot.toString(),
                  currency: contract.currency,
                },
              },
              tx,
            );
            await this.outbox.enqueue(
              {
                aggregateType: 'CONTRACT',
                aggregateId: contractId,
                eventType: 'CONTRACT_SETTLED',
                payload: { ledgerTransactionId: settlement.id, sellerId: contract.sellerId },
              },
              tx,
            );
          }
        }
      }

      return tx.milestone.findUniqueOrThrow({ where: { id: milestoneId } });
    });
    if (!result) throw new DomainError('INVALID_TRANSITION', "Faqat topshirilgan bosqichni tasdiqlash mumkin");
    return result;
  }
}
