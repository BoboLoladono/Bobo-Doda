import { Injectable } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { DomainError, ForbiddenError, NotFoundError } from '@/common/errors/domain-error';
import { somToTiyin } from '@/common/money/money.util';
import type { Page } from '@/common/pagination/page-query.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import type { JobWithRelations } from './dto/job-response.dto';
import type { AuditActor } from '@/common/audit/audit.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
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

  async hireProposal(proposalId: string, buyerId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.jobProposal.findUnique({ where: { id: proposalId }, include: { job: true } });
    if (!row) throw new NotFoundError('Taklif topilmadi');
    if (row.job.buyerId !== buyerId) throw new ForbiddenError();
    // The contract schema supports service purchases only. Never claim a hire
    // succeeded until a job contract and same-day exclusion can commit atomically.
    throw new DomainError('NOT_READY', 'Ish arizasidan shartnoma yaratish hali mavjud emas');
  }
}
