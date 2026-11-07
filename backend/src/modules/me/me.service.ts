import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { NotFoundError } from '@/common/errors/domain-error';
import { RefreshTokenService } from '@/modules/auth/refresh-token.service';
import type { MeResponseDto } from './dto/me-response.dto';
import type { SessionDto } from './dto/session.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async getMe(userId: string, activeRole: MeResponseDto['activeRole']): Promise<MeResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      email: user.email,
      avatarKey: user.avatarKey,
      roles: user.roles,
      activeRole,
      roleChosen: user.roleChosen,
      profileDone: user.profileDone,
      verified: user.verified,
      status: user.status,
      sellerStatus: user.sellerStatus,
      createdAt: user.createdAt,
    };
  }

  /** `PATCH /me/profile` — `fullName` va `avatarKey` yangilash. */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    activeRole: MeResponseDto['activeRole'],
  ): Promise<MeResponseDto> {
    const data: { fullName?: string; avatarKey?: string | null; profileDone?: boolean } = {};
    if (dto.fullName !== undefined) {
      data.fullName = dto.fullName;
      data.profileDone = true;
    }
    if (dto.avatarKey !== undefined) {
      data.avatarKey = dto.avatarKey && dto.avatarKey.trim() !== '' ? dto.avatarKey : null;
    }
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      email: user.email,
      avatarKey: user.avatarKey,
      roles: user.roles,
      activeRole,
      roleChosen: user.roleChosen,
      profileDone: user.profileDone,
      verified: user.verified,
      status: user.status,
      sellerStatus: user.sellerStatus,
      createdAt: user.createdAt,
    };
  }

  async listSessions(userId: string, currentFamilyId?: string): Promise<SessionDto[]> {
    const sessions = await this.refreshTokens.listActiveForUser(userId);
    return sessions.map((s) => ({
      id: s.id,
      activeRole: s.activeRole,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.familyId === currentFamilyId,
    }));
  }

  /** Egalik — `userId` bilan query-scoping (ADR-04 ownership: ikkinchi tomon). */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const ok = await this.refreshTokens.revokeOwned(sessionId, userId);
    if (!ok) throw new NotFoundError('Sessiya topilmadi');
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }
}
