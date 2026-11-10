import { Injectable } from '@nestjs/common';
import { Prisma, UserAppealRestrictionType, UserAppealStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { buildPage } from '@/common/pagination/page-query.dto';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { ListAppealsQueryDto } from './dto/list-appeals-query.dto';
import { StaffDecideAppealDto } from './dto/staff-decide-appeal.dto';

@Injectable()
export class AppealService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly audit: AuditService,
  ) {}

  async createAppeal(userId: string, dto: CreateAppealDto) {
    const appealId = this.ids.next();
    const restrictionType = dto.restrictionType.toUpperCase() as UserAppealRestrictionType;

    const appeal = await this.prisma.userAppeal.create({
      data: {
        id: appealId,
        userId,
        restrictionType,
        originalReason: dto.originalReason,
        appealText: dto.appealText,
        evidenceUrls: dto.evidenceUrls || [],
        status: UserAppealStatus.PENDING,
      },
      include: {
        user: { select: { id: true, fullName: true, phone: true, roles: true } },
      },
    });

    return appeal;
  }

  async getByIdOrThrow(id: string) {
    const appeal = await this.prisma.userAppeal.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true, roles: true } },
      },
    });
    if (!appeal) throw new NotFoundError('Apellyatsiya topilmadi', 'APPEAL_NOT_FOUND');
    return appeal;
  }

  async listForStaff(query: ListAppealsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 10;
    const where: Prisma.UserAppealWhereInput = {};

    if (query.status && query.status !== 'all') {
      where.status = query.status.toUpperCase() as UserAppealStatus;
    }

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { appealText: { contains: q, mode: 'insensitive' } },
        { originalReason: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total, allCount, pendingCount, acceptedCount, rejectedCount] = await Promise.all([
      this.prisma.userAppeal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          user: { select: { id: true, fullName: true, phone: true, roles: true } },
        },
      }),
      this.prisma.userAppeal.count({ where }),
      this.prisma.userAppeal.count(),
      this.prisma.userAppeal.count({ where: { status: UserAppealStatus.PENDING } }),
      this.prisma.userAppeal.count({ where: { status: UserAppealStatus.ACCEPTED } }),
      this.prisma.userAppeal.count({ where: { status: UserAppealStatus.REJECTED } }),
    ]);

    const facets: Record<string, number> = {
      _all: allCount,
      pending: pendingCount,
      accepted: acceptedCount,
      rejected: rejectedCount,
    };

    const paged = buildPage(items, total, page, perPage);
    return { ...paged, facets };
  }

  async decideAsStaff(appealId: string, dto: StaffDecideAppealDto, actor: AuditActor) {
    const existing = await this.getByIdOrThrow(appealId);
    const nextStatus = dto.decision.toUpperCase() as UserAppealStatus;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const appeal = await tx.userAppeal.update({
        where: { id: appealId },
        data: {
          status: nextStatus,
          reviewerId: actor.id,
          reviewerName: actor.name,
          decisionNote: dto.note,
          resolvedAt: now,
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true, roles: true } },
        },
      });

      if (nextStatus === UserAppealStatus.ACCEPTED) {
        const userBefore = await tx.user.findUnique({
          where: { id: existing.userId },
          select: { statusChangedAt: true },
        });
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            status: UserStatus.ACTIVE,
            statusReason: null,
            statusChangedAt: now,
            suspendedUntil: null,
          },
        });
        if (userBefore?.statusChangedAt) {
          await tx.refreshToken.updateMany({
            where: {
              userId: existing.userId,
              revokedAt: { gte: userBefore.statusChangedAt },
              expiresAt: { gt: now },
            },
            data: { revokedAt: null },
          });
        }
      }

      await this.audit.record(
        {
          actor,
          action: 'APPEAL_DECIDED',
          resourceType: 'USER_APPEAL',
          resourceId: appealId,
          contextId: existing.userId,
          previousState: { status: existing.status },
          newState: { status: nextStatus, note: dto.note },
        },
        tx,
      );

      return appeal;
    });

    return updated;
  }
}
