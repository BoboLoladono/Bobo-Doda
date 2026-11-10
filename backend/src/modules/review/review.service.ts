import { Injectable } from '@nestjs/common';
import { ContractStatus, Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { NotFoundError, DomainError, ForbiddenError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { buildPage } from '@/common/pagination/page-query.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
  ) {}

  async createReview(buyerId: string, contractId: string, dto: CreateReviewDto) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundError('Shartnoma topilmadi', 'CONTRACT_NOT_FOUND');
    if (contract.buyerId !== buyerId) {
      throw new ForbiddenError('Faqat shartnoma buyurtmachisi sharh qoldira oladi', 'FORBIDDEN');
    }
    if (contract.status !== ContractStatus.COMPLETED) {
      throw new DomainError('CONTRACT_NOT_COMPLETED', 'Faqat yakunlangan shartnomalar uchun sharh qoldirish mumkin');
    }

    const existing = await this.prisma.review.findUnique({ where: { contractId } });
    if (existing) {
      throw new DomainError('ALREADY_REVIEWED', 'Ushbu shartnoma uchun sharh allaqachon qoldirilgan');
    }

    const reviewId = this.ids.next();
    const review = await this.prisma.review.create({
      data: {
        id: reviewId,
        contractId,
        authorId: buyerId,
        targetId: contract.sellerId,
        rating: dto.rating,
        comment: dto.comment,
        status: ReviewStatus.APPROVED,
      },
      include: {
        contract: { select: { id: true, serviceTitleSnapshot: true } },
        author: { select: { id: true, fullName: true, phone: true } },
        target: { select: { id: true, fullName: true, phone: true } },
      },
    });

    return review;
  }

  async listForSeller(sellerId: string, page = 1, perPage = 20) {
    const where: Prisma.ReviewWhereInput = {
      targetId: sellerId,
      status: ReviewStatus.APPROVED,
    };
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          contract: { select: { id: true, serviceTitleSnapshot: true } },
          author: { select: { id: true, fullName: true, phone: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return buildPage(items, total, page, perPage);
  }

  async getByIdOrThrow(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        contract: { select: { id: true, serviceTitleSnapshot: true } },
        author: { select: { id: true, fullName: true, phone: true } },
        target: { select: { id: true, fullName: true, phone: true } },
      },
    });
    if (!review) throw new NotFoundError('Sharh topilmadi', 'REVIEW_NOT_FOUND');
    return review;
  }

  async listForStaff(query: ListReviewsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where: Prisma.ReviewWhereInput = {};

    if (query.status && query.status !== 'all') {
      const parsedRating = parseInt(query.status, 10);
      if (!isNaN(parsedRating) && parsedRating >= 1 && parsedRating <= 5) {
        where.rating = parsedRating;
      } else {
        where.status = query.status.toUpperCase() as ReviewStatus;
      }
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { comment: { contains: q, mode: 'insensitive' } },
        { author: { fullName: { contains: q, mode: 'insensitive' } } },
        { target: { fullName: { contains: q, mode: 'insensitive' } } },
        { contract: { serviceTitleSnapshot: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total, allCount, r5, r4, r3, r2, r1, agg] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          contract: { select: { id: true, serviceTitleSnapshot: true } },
          author: { select: { id: true, fullName: true, phone: true } },
          target: { select: { id: true, fullName: true, phone: true } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.count(),
      this.prisma.review.count({ where: { rating: 5 } }),
      this.prisma.review.count({ where: { rating: 4 } }),
      this.prisma.review.count({ where: { rating: 3 } }),
      this.prisma.review.count({ where: { rating: 2 } }),
      this.prisma.review.count({ where: { rating: 1 } }),
      this.prisma.review.aggregate({ _avg: { rating: true } }),
    ]);

    const facets: Record<string, number> = {
      _all: allCount,
      'rating:5': r5,
      'rating:4': r4,
      'rating:3': r3,
      'rating:2': r2,
      'rating:1': r1,
      avgRating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
    };

    const paged = buildPage(items, total, page, perPage);
    return { ...paged, facets };
  }

  async hideReviewAsStaff(reviewId: string, reason: string, actor: AuditActor) {
    const existing = await this.getByIdOrThrow(reviewId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.update({
        where: { id: reviewId },
        data: { status: ReviewStatus.HIDDEN },
        include: {
          contract: { select: { id: true, serviceTitleSnapshot: true } },
          author: { select: { id: true, fullName: true, phone: true } },
          target: { select: { id: true, fullName: true, phone: true } },
        },
      });

      await this.audit.record(
        {
          actor,
          action: 'REVIEW_HIDDEN',
          resourceType: 'REVIEW',
          resourceId: reviewId,
          contextId: existing.targetId,
          previousState: { status: existing.status },
          newState: { status: 'HIDDEN', reason },
        },
        tx,
      );

      return review;
    });

    return updated;
  }

  async deleteReviewAsStaff(reviewId: string, actor: AuditActor) {
    const existing = await this.getByIdOrThrow(reviewId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const review = await tx.review.update({
        where: { id: reviewId },
        data: { status: ReviewStatus.HIDDEN },
        include: {
          contract: { select: { id: true, serviceTitleSnapshot: true } },
          author: { select: { id: true, fullName: true, phone: true } },
          target: { select: { id: true, fullName: true, phone: true } },
        },
      });

      await this.audit.record(
        {
          actor,
          action: 'REVIEW_DELETED',
          resourceType: 'REVIEW',
          resourceId: reviewId,
          contextId: existing.targetId,
          previousState: { status: existing.status },
          newState: { status: 'HIDDEN' },
        },
        tx,
      );

      return review;
    });

    return updated;
  }
}
