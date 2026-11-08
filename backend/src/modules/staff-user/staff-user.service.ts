import { Injectable } from '@nestjs/common';
import { Prisma, type Role, type SellerStatus, type User, type UserStatus } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import { AuditService, type AuditActor } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { buildPage, type Page } from '@/common/pagination/page-query.dto';

export interface ListUsersFilters {
  status?: UserStatus;
  sellerStatus?: SellerStatus;
  role?: Role;
  phone?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

export interface UserDetail extends User {
  contractsAsBuyerCount: number;
  contractsAsSellerCount: number;
  paymentsCount: number;
}

/**
 * Bosqich 3 — hisob moderatsiyasi (`User.status`). Bosqich 11 — to'liq
 * o'qish (ro'yxat/tafsilot) qo'shildi + `block()` bo'lim 25's talabi
 * bo'yicha ATOMIK qilindi (status + refresh session revoke + audit +
 * outbox — BITTA tranzaksiya).
 */
@Injectable()
export class StaffUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async listForStaff(filters: ListUsersFilters, page: number, perPage: number): Promise<Page<User>> {
    const where: Prisma.UserWhereInput = {
      status: filters.status,
      sellerStatus: filters.sellerStatus,
      roles: filters.role ? { has: filters.role } : undefined,
      phone: filters.phone ? { contains: filters.phone } : undefined,
      createdAt:
        filters.createdFrom || filters.createdTo
          ? { gte: filters.createdFrom, lte: filters.createdTo }
          : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.user.count({ where }),
    ]);
    return buildPage(items, total, page, perPage);
  }

  /** Bo'lim 23 — BOUNDED sonlar (COUNT), giant `include` YO'Q. */
  async getDetailByIdOrThrow(userId: string): Promise<UserDetail> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('Foydalanuvchi topilmadi', 'USER_NOT_FOUND');
    const [contractsAsBuyerCount, contractsAsSellerCount, paymentsCount] = await Promise.all([
      this.prisma.contract.count({ where: { buyerId: userId } }),
      this.prisma.contract.count({ where: { sellerId: userId } }),
      this.prisma.payment.count({ where: { payerUserId: userId } }),
    ]);
    return { ...user, contractsAsBuyerCount, contractsAsSellerCount, paymentsCount };
  }

  async suspend(userId: string, reason: string, suspendedUntil: string | undefined, actor: AuditActor): Promise<void> {
    const cas = await this.prisma.user.updateMany({
      where: { id: userId, status: 'ACTIVE' },
      data: {
        status: 'SUSPENDED',
        statusReason: reason,
        statusChangedAt: new Date(),
        suspendedUntil: suspendedUntil ? new Date(suspendedUntil) : null,
      },
    });
    if (cas.count === 0) {
      throw new DomainError('INVALID_TRANSITION', 'Faqat faol hisobni cheklash mumkin');
    }
    await this.audit.record({
      actor,
      action: 'USER_SUSPENDED',
      resourceType: 'USER',
      resourceId: userId,
      previousState: { status: 'ACTIVE' },
      newState: { status: 'SUSPENDED', reason, suspendedUntil },
    });
  }

  /**
   * Bo'lim 25 — ATOMIK: `User.status=BLOCKED` + barcha faol
   * `RefreshToken`larni bekor qilish + audit + `USER_BLOCKED` Outbox
   * hodisasi BITTA tranzaksiyada. Block LIVE effekt qiladi: `AccountStatusGuard`
   * keyingi so'rovda rad etadi, LEKIN eski refresh token ham endi
   * ishlamaydi (avval faqat guard ishonib qolgan edi — endi ikkalasi ham).
   */
  async block(userId: string, reason: string, actor: AuditActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.user.updateMany({
        where: { id: userId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        data: { status: 'BLOCKED', statusReason: reason, statusChangedAt: new Date(), suspendedUntil: null },
      });
      if (cas.count === 0) {
        throw new DomainError('INVALID_TRANSITION', 'Bu hisob allaqachon bloklangan');
      }
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(
        {
          actor,
          action: 'USER_BLOCKED',
          resourceType: 'USER',
          resourceId: userId,
          newState: { status: 'BLOCKED', reason },
        },
        tx,
      );
      await this.outbox.enqueue({ aggregateType: 'USER', aggregateId: userId, eventType: 'USER_BLOCKED', payload: {} }, tx);
    });
  }

  async reactivate(userId: string, actor: AuditActor): Promise<void> {
    const existing = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { status: true, statusChangedAt: true },
    });
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.user.updateMany({
        where: { id: userId, status: { in: ['SUSPENDED', 'BLOCKED'] } },
        data: { status: 'ACTIVE', statusReason: null, suspendedUntil: null, statusChangedAt: new Date() },
      });
      if (cas.count === 0) {
        throw new DomainError('INVALID_TRANSITION', 'Bu hisob allaqachon faol');
      }
      if (existing.statusChangedAt) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: { gte: existing.statusChangedAt }, expiresAt: { gt: new Date() } },
          data: { revokedAt: null },
        });
      }
      await this.audit.record(
        {
          actor,
          action: 'USER_REACTIVATED',
          resourceType: 'USER',
          resourceId: userId,
          previousState: { status: existing.status },
          newState: { status: 'ACTIVE' },
        },
        tx,
      );
    });
  }
}
