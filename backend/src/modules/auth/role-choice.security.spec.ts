import type { PrismaService } from '@/infra/prisma/prisma.service';
import { AuthService } from './auth.service';

describe('One-time role choice concurrency', () => {
  it('does not issue a second role session when another request already claimed onboarding', async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'user', roleChosen: false }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    // Other collaborators must not be reached when the atomic role claim fails.
    const service = new AuthService(
      prisma as unknown as PrismaService,
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never, undefined as never,
    );
    await expect(service.chooseRole({ sub: 'user', familyId: 'family', activeRole: null }, 'BUYER'))
      .rejects.toMatchObject({ code: 'BAD_STATE' });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user', roleChosen: false },
      data: { roles: ['BUYER'], roleChosen: true, lastActiveRole: 'BUYER' },
    });
  });
});
