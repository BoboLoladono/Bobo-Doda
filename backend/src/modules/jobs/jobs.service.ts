import { Injectable } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, ForbiddenError, NotFoundError } from '@/common/errors/domain-error';
import { somToTiyin } from '@/common/money/money.util';
import { PLATFORM_FEE_RATE_BPS, computePlatformFee } from '@/common/money/fee.constant';
import type { Page } from '@/common/pagination/page-query.dto';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { toContractResponseDto } from '@/modules/contract/dto/contract-response.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { HireProposalDto } from './dto/hire-proposal.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import type { JobWithRelations } from './dto/job-response.dto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(buyerId: string, dto: CreateJobDto): Promise<JobWithRelations> {
    if (dto.budgetMin < 1_000) {
      throw new DomainError('INVALID_AMOUNT', "Minimal byudjet kamida 1 000 so'm bo'lishi kerak", {
        fieldErrors: { budgetMin: "Minimal byudjet kamida 1 000 so'm bo'lishi kerak" },
      });
    }
    if (dto.budgetMin > dto.budgetMax) {
      throw new DomainError('INVALID_AMOUNT', "Minimal byudjet maksimal byudjetdan katta bo'lishi mumkin emas", {
        fieldErrors: { budgetMin: "Minimal byudjet maksimaldan kam bo'lishi kerak" },
      });
    }

    const isUuid = UUID_REGEX.test(dto.category);
    const category = await this.prisma.category.findFirst({
      where: isUuid ? { OR: [{ id: dto.category }, { slug: dto.category }] } : { slug: dto.category },
    });

    if (!category) {
      throw new DomainError('NOT_FOUND', 'Kategoriya topilmadi', {
        fieldErrors: { category: 'Kategoriya topilmadi' },
      });
    }

    const id = this.ids.next();
    const deadline = dto.deadline ? new Date(dto.deadline) : undefined;
    const parsedDeadline = deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined;

    const job = await this.prisma.job.create({
      data: {
        id,
        buyerId,
        categoryId: category.id,
        title: dto.title.trim(),
        description: dto.description.trim(),
        budgetMin: somToTiyin(dto.budgetMin),
        budgetMax: somToTiyin(dto.budgetMax),
        currency: 'UZS',
        skillsRequired: dto.skillsRequired || [],
        screeningQuestions: dto.screeningQuestions || [],
        proposalsCount: 0,
        status: JobStatus.OPEN,
        deadline: parsedDeadline,
        attachedImages: dto.attachedImages || [],
      },
      include: {
        buyer: { select: { id: true, fullName: true } },
        category: { select: { id: true, slug: true } },
      },
    });

    return job;
  }

  async listPublic(query: ListJobsQueryDto): Promise<Page<JobWithRelations>> {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 20));
    const skip = (page - 1) * perPage;

    const where: Prisma.JobWhereInput = {
      status: JobStatus.OPEN,
    };

    if (query.category) {
      const isUuid = UUID_REGEX.test(query.category);
      where.category = isUuid
        ? { OR: [{ id: query.category }, { slug: query.category }] }
        : { slug: query.category };
    }

    if (query.q && query.q.trim()) {
      const search = query.q.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (query.budgetMin) {
      where.budgetMin = { gte: somToTiyin(query.budgetMin) };
    }
    if (query.budgetMax) {
      where.budgetMax = { lte: somToTiyin(query.budgetMax) };
    }

    const [total, items] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          buyer: { select: { id: true, fullName: true } },
          category: { select: { id: true, slug: true } },
        },
      }),
    ]);

    return {
      items,
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage) || 1,
    };
  }

  async listMine(buyerId: string, page = 1, perPage = 50): Promise<Page<JobWithRelations>> {
    const p = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const pp = Number.isSafeInteger(perPage) && perPage > 0 ? Math.min(100, perPage) : 50;
    const skip = (p - 1) * pp;

    const where: Prisma.JobWhereInput = { buyerId };

    const [total, items] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        skip,
        take: pp,
        orderBy: { createdAt: 'desc' },
        include: {
          buyer: { select: { id: true, fullName: true } },
          category: { select: { id: true, slug: true } },
        },
      }),
    ]);

    return {
      items,
      page: p,
      perPage: pp,
      total,
      totalPages: Math.ceil(total / pp) || 1,
    };
  }

  async getByIdOrThrow(id: string): Promise<JobWithRelations> {
    const isUuid = UUID_REGEX.test(id);
    if (!isUuid) {
      throw new NotFoundError("E'lon topilmadi");
    }

    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        buyer: { select: { id: true, fullName: true } },
        category: { select: { id: true, slug: true } },
      },
    });

    if (!job) {
      throw new NotFoundError("E'lon topilmadi");
    }

    return job;
  }

  async close(id: string, buyerId: string): Promise<JobWithRelations> {
    const job = await this.getByIdOrThrow(id);

    if (job.buyerId !== buyerId) {
      throw new ForbiddenError("Siz bu e'lonning egasi emassiz");
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.CLOSED },
      include: {
        buyer: { select: { id: true, fullName: true } },
        category: { select: { id: true, slug: true } },
      },
    });

    return updated;
  }

  async listForStaff(query: {
    page?: number;
    perPage?: number;
    status?: string;
    category?: string;
    search?: string;
  }): Promise<Page<JobWithRelations>> {
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(100, Math.max(1, query.perPage ?? 20));
    const skip = (page - 1) * perPage;

    const where: Prisma.JobWhereInput = {};

    if (query.status && query.status !== "all") {
      const s = query.status.toUpperCase();
      if (s === "OPEN" || s === "OCHIQ") {
        where.status = JobStatus.OPEN;
      } else if (s === "CLOSED" || s === "YOPILGAN") {
        where.status = JobStatus.CLOSED;
      }
    }

    if (query.category && query.category !== "all") {
      const isUuid = UUID_REGEX.test(query.category);
      where.category = isUuid
        ? { OR: [{ id: query.category }, { slug: query.category }] }
        : { slug: query.category };
    }

    if (query.search && query.search.trim()) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { buyer: { fullName: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: "desc" },
        include: {
          buyer: { select: { id: true, fullName: true } },
          category: { select: { id: true, slug: true } },
        },
      }),
    ]);

    return {
      items,
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage) || 1,
    };
  }

  async closeAsAdmin(id: string, reason: string, actor: AuditActor): Promise<JobWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({
        where: { id }, data: { status: JobStatus.CLOSED },
        include: { buyer: { select: { id: true, fullName: true } }, category: { select: { id: true, slug: true } } },
      });
      await tx.auditLog.create({
        data: {
          id: this.ids.next(), actorType: actor.type, actorId: actor.id, actorName: actor.name || 'Admin',
          action: 'JOB_CLOSED_BY_ADMIN', resourceType: 'JOB', resourceId: id,
          newState: { status: 'CLOSED', reason },
        },
      });
      return updated;
    });
  }

  async createProposal(jobId: string, sellerId: string, dto: CreateProposalDto): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize seller quota checks across different jobs and job close/submit races.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${sellerId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.job.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundError("E'lon topilmadi");
      if (job.buyerId === sellerId) throw new ForbiddenError("O'z e'loningizga taklif yubora olmaysiz");
      if (job.status !== JobStatus.OPEN) throw new DomainError('INVALID_INPUT', "Yopilgan ishga taklif yuborib bo'lmaydi");
      const seller = await tx.user.findUnique({ where: { id: sellerId }, select: { fullName: true, avatarKey: true } });
      if (!seller) throw new NotFoundError('Foydalanuvchi topilmadi');
      // Calendar day is defined in the marketplace's Uzbekistan timezone (UTC+5).
      const now = new Date();
      const dayStart = new Date(Math.floor((now.getTime() + 5 * 3600_000) / 86400_000) * 86400_000 - 5 * 3600_000);
      const count = await tx.jobProposal.count({ where: { sellerId, createdAt: { gte: dayStart } } });
      if (count >= 2) throw new DomainError('INVALID_INPUT', 'Bir kunda ko‘pi bilan 2 ta ariza topshirish mumkin');
      const existing = await tx.jobProposal.findUnique({ where: { jobId_sellerId: { jobId, sellerId } } });
      if (existing) throw new DomainError('DUPLICATE', 'Bu ishga allaqachon ariza topshirilgan');
      const proposal = {
        id: `prop_${this.ids.next()}`, jobId, jobTitle: job.title, sellerId,
        sellerName: seller.fullName, sellerAvatar: seller.avatarKey,
        bidAmount: dto.bidAmount, coverLetter: dto.coverLetter.trim(),
        screeningAnswers: (dto.screeningAnswers || []).map(({ question, answer }) => ({ question, answer })), attachedImages: dto.attachedImages || [],
        status: 'korib_chiqilmoqda', createdAt: now.toISOString(),
        ...(dto.estimatedDeliveryDays === undefined ? {} : { estimatedDeliveryDays: dto.estimatedDeliveryDays }),
      };
      await tx.jobProposal.create({ data: {
        id: proposal.id, jobId, sellerId, payload: proposal, createdAt: now,
      } });
      await tx.job.update({ where: { id: jobId }, data: { proposalsCount: { increment: 1 } } });
      return proposal;
    });
  }

  private proposalResponse(row: { payload: Prisma.JsonValue; status: string }): Record<string, unknown> {
    return { ...(row.payload as Record<string, unknown>), status: row.status };
  }

  async listProposalsForJob(jobId: string, buyerId: string): Promise<Record<string, unknown>[]> {
    const job = await this.getByIdOrThrow(jobId);
    if (job.buyerId !== buyerId) throw new ForbiddenError();
    const rows = await this.prisma.jobProposal.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.proposalResponse(row));
  }

  async listMyProposals(sellerId: string): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.jobProposal.findMany({ where: { sellerId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.proposalResponse(row));
  }

  async getProposal(proposalId: string, userId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.jobProposal.findUnique({ where: { id: proposalId }, include: { job: true } });
    if (!row) throw new NotFoundError('Taklif topilmadi');
    if (row.sellerId !== userId && row.job.buyerId !== userId) throw new ForbiddenError();
    return this.proposalResponse(row);
  }

  async withdrawProposal(proposalId: string, sellerId: string): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM job_proposals WHERE id = ${proposalId} FOR UPDATE`;
      const row = await tx.jobProposal.findUnique({ where: { id: proposalId } });
      if (!row) throw new NotFoundError('Taklif topilmadi');
      if (row.sellerId !== sellerId) throw new ForbiddenError();
      // Conditional update makes retries idempotent and prevents double decrement.
      const changed = await tx.jobProposal.updateMany({
        where: { id: proposalId, sellerId, status: 'korib_chiqilmoqda' }, data: { status: 'qaytarib_olingan' },
      });
      if (changed.count) {
        await tx.job.update({ where: { id: row.jobId }, data: { proposalsCount: { decrement: 1 } } });
      } else if (row.status !== 'qaytarib_olingan') {
        throw new DomainError('INVALID_INPUT', 'Bu holatdagi taklifni qaytarib bo‘lmaydi');
      }
      return this.proposalResponse({ ...row, status: 'qaytarib_olingan' });
    });
  }

  async hireProposal(
    proposalId: string,
    buyerId: string,
    dto?: HireProposalDto,
    actor?: AuditActor,
  ): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Concurrency lock on proposal
      await tx.$queryRaw`SELECT id FROM job_proposals WHERE id = ${proposalId} FOR UPDATE`;
      const row = await tx.jobProposal.findUnique({
        where: { id: proposalId },
        include: { job: true },
      });
      if (!row) throw new NotFoundError('Taklif topilmadi');
      if (row.job.buyerId !== buyerId) throw new ForbiddenError("Siz bu e'lonning egasi emassiz");

      // Idempotency: if already hired and contract exists, return existing contract
      if (row.status === 'yollandi') {
        const existing = await tx.contract.findUnique({
          where: { proposalId },
          include: {
            milestones: { orderBy: { position: 'asc' } },
            payments: { select: { id: true, status: true, succeededAt: true, createdAt: true } },
          },
        });
        if (existing) {
          return toContractResponseDto(existing) as unknown as Record<string, unknown>;
        }
        throw new DomainError('INVALID_PROPOSAL_STATUS', 'Bu ariza allaqachon yollangan');
      }

      if (row.status !== 'korib_chiqilmoqda') {
        throw new DomainError('INVALID_PROPOSAL_STATUS', 'Faqat ko‘rib chiqilayotgan arizani yollash mumkin');
      }
      if (row.job.status !== JobStatus.OPEN) {
        throw new DomainError('JOB_CLOSED', "Yopilgan e'longa mutaxassisni yollab bo‘lmaydi");
      }
      if (row.sellerId === buyerId) {
        throw new DomainError('SELF_PURCHASE', "O‘z e'loningizga o‘zingizni yollay olmaysiz");
      }

      // 2. Concurrency lock on seller and eligibility check
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${row.sellerId}::uuid FOR UPDATE`;
      const seller = await tx.user.findUniqueOrThrow({ where: { id: row.sellerId } });
      if (seller.status !== 'ACTIVE' || seller.sellerStatus !== 'APPROVED') {
        throw new DomainError('SELLER_NOT_APPROVED', 'Sotuvchi hozir mavjud emas yoki tasdiqlanmagan');
      }

      const buyer = await tx.user.findUniqueOrThrow({ where: { id: buyerId } });
      const category = await tx.category.findUniqueOrThrow({ where: { id: row.job.categoryId } });
      const sellerApp = await tx.sellerApplication.findFirst({
        where: { userId: row.sellerId, status: 'APPROVED' },
        orderBy: { reviewedAt: 'desc' },
      });
      const sellerDisplayName = sellerApp?.displayName ?? seller.fullName ?? seller.phone;

      // 3. Amount and milestone calculation
      const payload = row.payload as Record<string, unknown>;
      const bidAmountSom = Number(payload.bidAmount) || 0;
      if (bidAmountSom <= 0) {
        throw new DomainError('INVALID_AMOUNT', 'Taklif summasi noto‘g‘ri');
      }
      const targetAmountTiyin = somToTiyin(bidAmountSom);

      let milestonesData: Array<{ title: string; description?: string; amount: number; dueDate?: string }>;
      if (dto?.milestones && dto.milestones.length > 0) {
        const sum = dto.milestones.reduce((acc, m) => acc + m.amount, 0);
        if (sum !== bidAmountSom) {
          throw new DomainError(
            'MILESTONE_AMOUNT_MISMATCH',
            `Bosqichlar yig‘indisi (${sum}) taklif summasiga (${bidAmountSom}) teng bo‘lishi shart`,
          );
        }
        milestonesData = dto.milestones;
      } else {
        milestonesData = [
          {
            title: "1-bosqich: Ishni to'liq bajarish",
            description: row.job.title,
            amount: bidAmountSom,
            dueDate: row.job.deadline ? row.job.deadline.toISOString() : undefined,
          },
        ];
      }

      const feeAmount = computePlatformFee(targetAmountTiyin, PLATFORM_FEE_RATE_BPS);
      const contractId = this.ids.next();
      const now = new Date();

      // Deadline: latest milestone due date, job deadline, or now + 14 days
      let deadline = row.job.deadline ?? new Date(now.getTime() + 14 * 86400_000);
      const latestMilestoneDue = milestonesData
        .map((m) => (m.dueDate ? new Date(m.dueDate) : null))
        .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      if (latestMilestoneDue && latestMilestoneDue > deadline) {
        deadline = latestMilestoneDue;
      }

      // 4. Create Contract with sourceType = 'JOB'
      await tx.contract.create({
        data: {
          id: contractId,
          buyerId,
          sellerId: row.sellerId,
          sourceType: 'JOB',
          jobId: row.jobId,
          proposalId: row.id,
          serviceId: null,
          serviceTitleSnapshot: row.job.title,
          serviceDescriptionSnapshot: row.job.description,
          categoryNameSnapshot: category.nameUz,
          sellerDisplayNameSnapshot: sellerDisplayName,
          agreedAmount: targetAmountTiyin,
          currency: row.job.currency,
          platformFeeRateBpsSnapshot: PLATFORM_FEE_RATE_BPS,
          platformFeeAmountSnapshot: feeAmount,
          deadline,
          status: 'PENDING_SELLER',
        },
      });

      // 5. Create Milestones
      await tx.milestone.createMany({
        data: milestonesData.map((m, idx) => ({
          id: this.ids.next(),
          contractId,
          title: m.title,
          description: m.description ?? '',
          amount: somToTiyin(m.amount),
          position: idx + 1,
          dueAt: m.dueDate ? new Date(m.dueDate) : null,
        })),
      });

      // 6. Update Proposal status
      await tx.jobProposal.update({
        where: { id: proposalId },
        data: {
          status: 'yollandi',
          payload: {
            ...payload,
            status: 'yollandi',
            contractId,
            hiredAt: now.toISOString(),
          },
        },
      });

      // 7. Enforce User Rule #2 (Same-day conflict cancellation):
      // If specialist is hired on this day, cancel their other competing open proposals for today
      const dayStart = new Date(Math.floor((now.getTime() + 5 * 3600_000) / 86400_000) * 86400_000 - 5 * 3600_000);
      const dayEnd = new Date(dayStart.getTime() + 86400_000);

      const competingProposals = await tx.jobProposal.findMany({
        where: {
          sellerId: row.sellerId,
          id: { not: proposalId },
          status: 'korib_chiqilmoqda',
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      });

      for (const comp of competingProposals) {
        await tx.jobProposal.update({
          where: { id: comp.id },
          data: {
            status: 'rad_etilgan',
            payload: {
              ...(comp.payload as Record<string, unknown>),
              status: 'rad_etildi',
              reason: 'Boshqa ishga yollanganligi sababli bekor qilindi',
            },
          },
        });
        await tx.job.update({
          where: { id: comp.jobId },
          data: { proposalsCount: { decrement: 1 } },
        });
      }

      // 8. Close the Job & decline remaining proposals on this job
      await tx.job.update({
        where: { id: row.jobId },
        data: { status: JobStatus.CLOSED },
      });

      const remainingJobProps = await tx.jobProposal.findMany({
        where: {
          jobId: row.jobId,
          id: { not: proposalId },
          status: 'korib_chiqilmoqda',
        },
      });

      for (const p of remainingJobProps) {
        await tx.jobProposal.update({
          where: { id: p.id },
          data: {
            status: 'rad_etilgan',
            payload: {
              ...(p.payload as Record<string, unknown>),
              status: 'rad_etildi',
              reason: 'Boshqa nomzod tanlandi',
            },
          },
        });
      }

      // 9. Audit and Outbox
      const resolvedActor: AuditActor = actor ?? {
        id: buyerId,
        type: 'USER',
        name: buyer.fullName ?? buyer.phone,
      };

      await this.audit.record(
        {
          actor: resolvedActor,
          action: 'CONTRACT_CREATED',
          resourceType: 'CONTRACT',
          resourceId: contractId,
          contextId: row.sellerId,
          newState: {
            status: 'PENDING_SELLER',
            sourceType: 'JOB',
            jobId: row.jobId,
            proposalId,
            sellerId: row.sellerId,
          },
        },
        tx,
      );

      await this.outbox.enqueue(
        {
          aggregateType: 'CONTRACT',
          aggregateId: contractId,
          eventType: 'CONTRACT_CREATED',
          payload: { buyerId, sellerId: row.sellerId, jobId: row.jobId, proposalId },
        },
        tx,
      );

      const createdContract = await tx.contract.findUniqueOrThrow({
        where: { id: contractId },
        include: {
          milestones: { orderBy: { position: 'asc' } },
          payments: { select: { id: true, status: true, succeededAt: true, createdAt: true } },
        },
      });

      return toContractResponseDto(createdContract) as unknown as Record<string, unknown>;
    });
  }
}
