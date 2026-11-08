import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { TokenService } from '../token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard live session boundary', () => {
  const payload = { sub: 'user', familyId: 'device', activeRole: 'BUYER' };
  function setup(live: boolean, isPublic = false) {
    const request = { headers: { authorization: 'Bearer signed' }, user: undefined };
    const findFirst = jest.fn().mockResolvedValue(live ? { id: 'refresh' } : null);
    const guard = new JwtAuthGuard(
      { getAllAndOverride: () => isPublic } as unknown as Reflector,
      { verifyAccessToken: () => payload } as unknown as TokenService,
      { refreshToken: { findFirst } } as unknown as PrismaService,
    );
    const context = {
      getHandler: () => undefined, getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, context, request, findFirst };
  }
  it('rejects an otherwise signed access token after logout or password reset', async () => {
    const { guard, context } = setup(false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });
  it('accepts tokens after refresh rotation in the same live family', async () => {
    const { guard, context, request, findFirst } = setup(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user', familyId: 'device' }),
    }));
  });
  it('does not query sessions for public endpoints', async () => {
    const { guard, context, findFirst } = setup(false, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
