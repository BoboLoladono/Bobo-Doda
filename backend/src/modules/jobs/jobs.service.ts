import { Injectable, Optional } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { RedisService } from '@/infra/redis/redis.service';
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
    @Optional() private readonly redis?: RedisService,
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
    const p = Math.max(1, page);
    const pp = Math.min(100, Math.max(1, perPage));
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
    await this.getByIdOrThrow(id);
    const updated = await this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.CLOSED },
      include: {
        buyer: { select: { id: true, fullName: true } },
        category: { select: { id: true, slug: true } },
      },
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          id: this.ids.next(),
          actorType: actor.type,
          actorId: actor.id,
          actorName: actor.name || 'Admin',
          action: "JOB_CLOSED_BY_ADMIN",
          resourceType: "JOB",
          resourceId: id,
          newState: { status: "CLOSED", reason },
        },
      });
    } catch {
      // Audit log creation shouldn't fail the operation
    }

    return updated;
  }

  async createProposal(jobId: string, sellerId: string, dto: CreateProposalDto): Promise<Record<string, unknown>> {
    const job = await this.getByIdOrThrow(jobId);
    if (job.status !== JobStatus.OPEN) {
      throw new DomainError('INVALID_INPUT', "Yopilgan ishga taklif yuborib bo'lmaydi");
    }

    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true, fullName: true, avatarKey: true },
    });

    const proposalId = `prop_${this.ids.next()}`;
    const proposal: Record<string, unknown> = {
      id: proposalId,
      jobId,
      jobTitle: job.title,
      sellerId,
      sellerName: seller?.fullName || 'Mutaxassis',
      sellerAvatar: seller?.avatarKey || null,
      bidAmount: dto.bidAmount,
      coverLetter: dto.coverLetter.trim(),
      screeningAnswers: dto.screeningAnswers || [],
      attachedImages: dto.attachedImages || [],
      status: 'korib_chiqilmoqda',
      createdAt: new Date().toISOString(),
      estimatedDeliveryDays: dto.estimatedDeliveryDays,
    };

    if (this.redis?.client) {
      try {
        await this.redis.client.rpush(`proposals:job:${jobId}`, JSON.stringify(proposal));
        await this.redis.client.rpush(`proposals:seller:${sellerId}`, JSON.stringify(proposal));
        await this.redis.client.set(`proposal:${proposalId}`, JSON.stringify(proposal));
      } catch {
        // Redis fallback if offline
      }
    }

    try {
      await this.prisma.job.update({
        where: { id: jobId },
        data: { proposalsCount: { increment: 1 } },
      });
    } catch {
      // Mock rejimida yoki e'lon o'chirilgan bo'lsa xatoni e'tiborsiz qoldirish
    }

    return proposal;
  }

  async listProposalsForJob(jobId: string): Promise<Record<string, unknown>[]> {
    if (!this.redis?.client) return [];
    try {
      const raw = await this.redis.client.lrange(`proposals:job:${jobId}`, 0, -1);
      return raw.map((r) => JSON.parse(r) as unknown as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  async listMyProposals(sellerId: string): Promise<Record<string, unknown>[]> {
    if (!this.redis?.client) return [];
    try {
      const raw = await this.redis.client.lrange(`proposals:seller:${sellerId}`, 0, -1);
      return raw.map((r) => JSON.parse(r) as unknown as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  async getProposal(proposalId: string): Promise<Record<string, unknown> | null> {
    if (!this.redis?.client) return null;
    try {
      const raw = await this.redis.client.get(`proposal:${proposalId}`);
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  async withdrawProposal(proposalId: string, sellerId: string): Promise<Record<string, unknown>> {
    if (!this.redis?.client) {
      return { id: proposalId, status: 'qaytarib_olingan' };
    }
    try {
      const raw = await this.redis.client.get(`proposal:${proposalId}`);
      if (!raw) {
        return { id: proposalId, status: 'qaytarib_olingan' };
      }
      const prop = JSON.parse(raw) as unknown as { id: string; jobId: string; sellerId: string; status: string; [key: string]: unknown };
      if (prop.sellerId !== sellerId) {
        throw new DomainError('FORBIDDEN', 'Bu taklif sizga tegishli emas');
      }
      prop.status = 'qaytarib_olingan';
      await this.redis.client.set(`proposal:${proposalId}`, JSON.stringify(prop));

      // Update in proposals:job:${jobId}
      const jobListRaw = await this.redis.client.lrange(`proposals:job:${prop.jobId}`, 0, -1);
      const updatedJobList = jobListRaw.map((item) => {
        const p = JSON.parse(item) as unknown as { id: string; status: string; [key: string]: unknown };
        if (p.id === proposalId) p.status = 'qaytarib_olingan';
        return JSON.stringify(p);
      });
      await this.redis.client.del(`proposals:job:${prop.jobId}`);
      if (updatedJobList.length > 0) {
        await this.redis.client.rpush(`proposals:job:${prop.jobId}`, ...updatedJobList);
      }

      // Update in proposals:seller:${sellerId}
      const sellerListRaw = await this.redis.client.lrange(`proposals:seller:${sellerId}`, 0, -1);
      const updatedSellerList = sellerListRaw.map((item) => {
        const p = JSON.parse(item) as unknown as { id: string; status: string; [key: string]: unknown };
        if (p.id === proposalId) p.status = 'qaytarib_olingan';
        return JSON.stringify(p);
      });
      await this.redis.client.del(`proposals:seller:${sellerId}`);
      if (updatedSellerList.length > 0) {
        await this.redis.client.rpush(`proposals:seller:${sellerId}`, ...updatedSellerList);
      }

      // Decrement job proposalsCount
      try {
        await this.prisma.job.update({
          where: { id: prop.jobId },
          data: { proposalsCount: { decrement: 1 } },
        });
      } catch {
        // E'lon topilmasa yoki Prisma yangilanmasa davom etadi
      }

      return prop;
    } catch (err) {
      if (err instanceof DomainError) throw err;
      return { id: proposalId, status: 'qaytarib_olingan' };
    }
  }

  async hireProposal(proposalId: string): Promise<Record<string, unknown>> {
    if (!this.redis?.client) {
      return { id: proposalId, status: 'yollandi' };
    }
    try {
      const raw = await this.redis.client.get(`proposal:${proposalId}`);
      if (!raw) return { id: proposalId, status: 'yollandi' };

      const prop = JSON.parse(raw) as unknown as { id: string; jobId: string; sellerId: string; status: string; [key: string]: unknown };
      prop.status = 'yollandi';
      await this.redis.client.set(`proposal:${proposalId}`, JSON.stringify(prop));

      // Update in proposals:job:${jobId}
      const jobListRaw = await this.redis.client.lrange(`proposals:job:${prop.jobId}`, 0, -1);
      const updatedJobList = jobListRaw.map((item) => {
        const p = JSON.parse(item) as unknown as { id: string; status: string; [key: string]: unknown };
        if (p.id === proposalId) p.status = 'yollandi';
        return JSON.stringify(p);
      });
      await this.redis.client.del(`proposals:job:${prop.jobId}`);
      if (updatedJobList.length > 0) {
        await this.redis.client.rpush(`proposals:job:${prop.jobId}`, ...updatedJobList);
      }

      // Update in proposals:seller:${sellerId}
      const sellerListRaw = await this.redis.client.lrange(`proposals:seller:${prop.sellerId}`, 0, -1);
      const updatedSellerList = sellerListRaw.map((item) => {
        const p = JSON.parse(item) as unknown as { id: string; status: string; [key: string]: unknown };
        if (p.id === proposalId) p.status = 'yollandi';
        return JSON.stringify(p);
      });
      await this.redis.client.del(`proposals:seller:${prop.sellerId}`);
      if (updatedSellerList.length > 0) {
        await this.redis.client.rpush(`proposals:seller:${prop.sellerId}`, ...updatedSellerList);
      }

      return prop;
    } catch {
      return { id: proposalId, status: 'yollandi' };
    }
  }
}

