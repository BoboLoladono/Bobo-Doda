import { Injectable } from '@nestjs/common';
import type { RefreshToken, Role } from '@prisma/client';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { AppConfigService } from '@/config/app-config.service';
import { UnauthenticatedError } from '@/common/errors/domain-error';
import { generateOpaqueToken, hashOpaqueToken } from '@/common/security/opaque-token.util';
import { parseDurationMs } from '@/common/security/duration.util';

export interface IssuedRefreshToken {
  /** Xom token — FAQAT httpOnly cookie'ga yoziladi, DB'da SAQLANMAYDI. */
  raw: string;
  record: RefreshToken;
}

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

/**
 * Marketplace refresh token — DB-backed, opaque, ROTATSIYA + REUSE DETECTION
 * bilan (spec talabi). Naqsh:
 *
 *  1. `issue()` — YANGI OILA (login yoki `/me/roles/switch`): boshqa
 *     sessiyalarga ta'sir qilmaydi.
 *  2. `rotate()` — `/auth/refresh`: eski token BEKOR qilinadi, xuddi shu
 *     oilada YANGI token yaratiladi. Eski token QAYTA kelsa (allaqachon
 *     `revokedAt` bor) — bu REUSE: kimdir tokenni o'g'irlagan yoki
 *     parallel so'rov, ikkala holatda ham butun oila (barcha avlodlar)
 *     zudlik bilan bekor qilinadi ("compromised family revoke").
 *
 * Race himoyasi: CAS (`updateMany({where:{id, revokedAt:null}})`) — bir
 * vaqtda ikkita `/auth/refresh` so'rovi kelsa, faqat BITTASI `count:1`
 * bilan g'olib chiqadi; ikkinchisi `count:0` ko'rib, buni ham REUSE deb
 * hisoblaydi (chunki xuddi shu token ikki marta ishlatilmoqda) va oilani
 * yopadi. Bu qattiqroq siyosat, lekin moliyaviy/marketplace sessiyasi uchun
 * "gumon bo'lsa — yop" xavfsizroq.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ids: IdFactory,
    private readonly config: AppConfigService,
  ) {}

  private newExpiry(): Date {
    return new Date(Date.now() + parseDurationMs(this.config.jwt.refreshTtl));
  }

  async issue(params: {
    userId: string;
    /** NULL — hali rol tanlanmagan (onboarding sessiyasi). */
    activeRole: Role | null;
    meta?: RequestMeta;
    expectedPasswordHash?: string;
  }): Promise<IssuedRefreshToken> {
    const raw = generateOpaqueToken();
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${params.userId}::uuid FOR UPDATE`;
      if (params.expectedPasswordHash !== undefined) {
        const user = await tx.user.findUnique({ where: { id: params.userId }, select: { passwordHash: true } });
        if (!user || user.passwordHash !== params.expectedPasswordHash) {
          throw new UnauthenticatedError('Parol o‘zgargan — qaytadan kiring', 'INVALID_CREDENTIALS');
        }
      }
      return tx.refreshToken.create({
      data: {
        id: this.ids.next(),
        userId: params.userId,
        tokenHash: hashOpaqueToken(raw),
        familyId: this.ids.next(),
        activeRole: params.activeRole,
        userAgent: params.meta?.userAgent,
        ip: params.meta?.ip,
        expiresAt: this.newExpiry(),
      },
      });
    });
    return { raw, record };
  }

  async rotate(rawToken: string, meta?: RequestMeta): Promise<IssuedRefreshToken> {
    const tokenHash = hashOpaqueToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) {
      throw new UnauthenticatedError('Sessiya topilmadi', 'NO_SESSION');
    }
    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthenticatedError(
        'Token qayta ishlatildi — barcha sessiyalar tugatildi',
        'TOKEN_REUSED',
      );
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthenticatedError('Sessiya muddati tugagan', 'TOKEN_EXPIRED');
    }

    const nextId = this.ids.next();
    const nextRaw = generateOpaqueToken();
    const record = await this.prisma.$transaction(async (tx) => {
      // Same parent lock as every revocation: a new descendant cannot be
      // inserted behind a logout/password-reset statement's MVCC snapshot.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${existing.userId}::uuid FOR UPDATE`;
      const fresh = await tx.refreshToken.findUnique({ where: { id: existing.id } });
      if (!fresh || fresh.revokedAt || fresh.expiresAt.getTime() <= Date.now()) return null;
      const cas = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (cas.count === 0) return null;
      return tx.refreshToken.create({
        data: {
          id: nextId,
          userId: existing.userId,
          tokenHash: hashOpaqueToken(nextRaw),
          familyId: existing.familyId,
          activeRole: existing.activeRole,
          userAgent: meta?.userAgent,
          ip: meta?.ip,
          expiresAt: this.newExpiry(),
        },
      });
    });

    if (!record) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthenticatedError(
        'Token qayta ishlatildi — barcha sessiyalar tugatildi',
        'TOKEN_REUSED',
      );
    }
    return { raw: nextRaw, record };
  }

  /** Butun oila (barcha qurilma/avlod) — kompromess gumon qilinganda. */
  async revokeFamily(familyId: string): Promise<void> {
    const owner = await this.prisma.refreshToken.findFirst({ where: { familyId }, select: { userId: true } });
    if (!owner) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.userId}::uuid FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { familyId, revokedAt: null }, data: { revokedAt: new Date() },
      });
    });
  }

  /** Bitta sessiya — FAQAT egasi (`userId` bilan query-scoping — ADR-04 ownership). */
  async revokeOwned(id: string, userId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const existing = await tx.refreshToken.findFirst({ where: { id, userId }, select: { familyId: true } });
      if (!existing) return false;
      await tx.refreshToken.updateMany({
        where: { userId, familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return true;
    });
  }

  /** Logout — joriy cookie'dagi tokenning oilasini (shu qurilma) bekor qiladi. */
  async revokeByRawToken(rawToken: string, userId?: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
      select: { userId: true, familyId: true },
    });
    if (!existing || (userId && existing.userId !== userId)) return;
    await this.revokeFamily(existing.familyId);
  }

  /** "Hamma qurilmadan chiqish". */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
      });
    });
  }

  /** `/me/sessions` — `tokenHash` HECH QACHON qaytarilmaydi. */
  async listActiveForUser(userId: string): Promise<Array<Omit<RefreshToken, 'tokenHash'>>> {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        familyId: true,
        replacedById: true,
        activeRole: true,
        revokedAt: true,
        userAgent: true,
        ip: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }
}
