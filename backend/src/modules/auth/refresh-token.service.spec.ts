import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { AppConfigService } from '@/config/app-config.service';
import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService security regression', () => {
  function setup(existing: unknown) {
    const refreshToken = {
      findUnique: jest.fn().mockResolvedValue(existing),
      findFirst: jest.fn().mockResolvedValue({ userId: 'owner', familyId: 'family' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    };
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = {
      refreshToken,
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ refreshToken, $queryRaw: queryRaw, user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: 'new-password-hash' }) } })),
    };
    const service = new RefreshTokenService(
      prisma as unknown as PrismaService,
      { next: jest.fn() },
      {} as AppConfigService,
    );
    return { service, refreshToken, prisma };
  }

  it('rejects a just-rotated token and revokes the whole family without minting a sibling', async () => {
    const { service, refreshToken } = setup({
      revokedAt: new Date(), replacedById: 'replacement', familyId: 'family',
    });
    await expect(service.rotate('stolen-old-token')).rejects.toMatchObject({ code: 'TOKEN_REUSED' });
    expect(refreshToken.create).not.toHaveBeenCalled();
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });

  it('logout using an older rotated cookie also revokes its live descendants', async () => {
    const { service, refreshToken } = setup({ userId: 'owner', familyId: 'family' });
    await service.revokeByRawToken('old-cookie', 'owner');
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family', revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
  });

  it('never revokes another users family', async () => {
    const { service, refreshToken } = setup({ userId: 'other', familyId: 'family' });
    await service.revokeByRawToken('cookie', 'caller');
    expect(refreshToken.updateMany).not.toHaveBeenCalled();
  });
  it('revalidates rotation after obtaining the same user lock used by logout', async () => {
    const existing = { id: 'old', userId: 'owner', familyId: 'family', revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000) };
    const { service, refreshToken, prisma } = setup(existing);
    // Model logout winning between the optimistic read and lock acquisition.
    refreshToken.findUnique.mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, revokedAt: new Date() });
    await expect(service.rotate('old')).rejects.toMatchObject({ code: 'TOKEN_REUSED' });
    expect(refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects session issuance if a password reset won after login verification', async () => {
    const { service, refreshToken } = setup(null);
    await expect(service.issue({ userId: 'owner', activeRole: 'BUYER', expectedPasswordHash: 'old-password-hash' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(refreshToken.create).not.toHaveBeenCalled();
  });

});
