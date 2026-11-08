import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UnauthenticatedError } from '@/common/errors/domain-error';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { TokenService } from '../token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AccessTokenPayload } from '../types/token-payload';

/**
 * GLOBAL guard (`APP_GUARD`, `app.module.ts`) — sukut bo'yicha HAR bir
 * marshrut autentifikatsiya talab qiladi ("fail closed"). Ochiq marshrutlar
 * `@Public()` bilan ANIQ belgilanadi (OTP so'rash/tasdiqlash, refresh,
 * health, staff — staff o'z alohida guard zanjiriga ega).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      throw new UnauthenticatedError('Autentifikatsiya talab qilinadi', 'NO_SESSION');
    }

    const payload = this.tokens.verifyAccessToken(token);
    if (!payload.sub || !payload.familyId) {
      throw new UnauthenticatedError('Token yaroqsiz', 'UNAUTHENTICATED');
    }
    // Access tokens remain valid only while their device family has an unexpired
    // refresh session. Rotation preserves the family; logout/reset revokes it.
    const session = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        familyId: payload.familyId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, revokedAt: true },
    });
    if (!session) throw new UnauthenticatedError('Sessiya tugagan', 'TOKEN_EXPIRED');

    if (session.revokedAt) {
      // If the session was revoked because the user was blocked by staff,
      // allow the access token to authenticate the user so that AccountStatusGuard
      // can enforce ACCOUNT_BLOCKED (403) on writes while GET /me returns 200 (BLOCKED).
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });
      if (user?.status !== 'BLOCKED') {
        throw new UnauthenticatedError('Sessiya tugagan', 'TOKEN_EXPIRED');
      }
    }
    req.user = payload;
    return true;
  }
}
