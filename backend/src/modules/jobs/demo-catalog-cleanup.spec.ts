import { JobStatus } from '@prisma/client';
import { DomainError, NotFoundError } from '@/common/errors/domain-error';
import type { AuditService } from '@/common/audit/audit.service';
import type { AppConfigService } from '@/config/app-config.service';
import type { IdFactory } from '@/common/id/id.factory';
import type { OutboxService } from '@/common/outbox/outbox.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import { AuthService } from '@/modules/auth/auth.service';
import { JobsService } from './jobs.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const seedSafety = require('../../../scripts/lib/seed-safety.cjs') as {
  SEED_BUYER_IDS: Set<string>;
  SEED_SELLER_IDS: Set<string>;
  KNOWN_TEST_SERVICE_IDS: Set<string>;
  assertNonProductionSeedAllowed: (name: string) => void;
  classifyDemoJob: (job: Record<string, unknown>) => string;
  classifyDemoService: (svc: Record<string, unknown>) => string;
  classifyDemoSeller: (seller: Record<string, unknown>) => string;
};

describe('Demo catalog provenance & closed job visibility', () => {
  it('blocks demo seed scripts in production and non-loopback databases', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDbUrl = process.env.DATABASE_URL;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => seedSafety.assertNonProductionSeedAllowed('seed-100-jobs.js')).toThrow('NODE_ENV=production');

      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://user:pass@prod.db.internal:5432/bobololadono';
      expect(() => seedSafety.assertNonProductionSeedAllowed('seed-100-jobs.js')).toThrow('loopback');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;
    }
  });

  it('requires both creator provenance and payload match, and protects items with history', () => {
    const seedBuyerId = Array.from(seedSafety.SEED_BUYER_IDS)[0]!;
    const seedSellerId = Array.from(seedSafety.SEED_SELLER_IDS)[0]!;
    const seedTitle = "Telegram WebApp (TMA) va to'lov tizimlari integratsiyasi";
    const seedDesc =
      "Onlayn do'konimiz uchun Telegram WebApp (Mini App) ishlab chiqish kerak. Frontend React/Next.js, backend esa Node.js yoki Python. Click va Payme orqali to'lovlarni qabul qilish, savat funksiyasi va buyurtmalarni CRM ga yuborish talab etiladi. To'liq masofaviy ish.";

    // Real buyer with 0 proposals OR matching title is NOT marked PROVEN_DEMO
    expect(
      seedSafety.classifyDemoJob({
        buyerId: 'real-buyer-id',
        buyerPhone: '+998909998877',
        title: 'Custom project',
        description: 'Real project description',
        attachedImagesCount: 0,
        proposalsCount: 0,
        contractsCount: 0,
      }),
    ).toBe('REAL');

    expect(
      seedSafety.classifyDemoJob({
        buyerId: 'real-buyer-id',
        buyerPhone: '+998909998877',
        title: seedTitle,
        description: seedDesc,
        attachedImagesCount: 0,
        proposalsCount: 0,
        contractsCount: 0,
      }),
    ).toBe('UNKNOWN');

    // Proven demo with no history -> PROVEN_DEMO
    expect(
      seedSafety.classifyDemoJob({
        buyerId: seedBuyerId,
        title: seedTitle,
        description: seedDesc,
        attachedImagesCount: 0,
        proposalsCount: 0,
        contractsCount: 0,
      }),
    ).toBe('PROVEN_DEMO');

    // Proven demo with proposal or contract -> PROTECTED_WITH_HISTORY
    expect(
      seedSafety.classifyDemoJob({
        buyerId: seedBuyerId,
        title: seedTitle,
        description: seedDesc,
        attachedImagesCount: 0,
        proposalsCount: 1,
        contractsCount: 0,
      }),
    ).toBe('PROTECTED_WITH_HISTORY');

    // Known test service on seeded seller
    expect(
      seedSafety.classifyDemoService({
        id: '01a14e25-700d-72de-ac13-1117147e475f',
        sellerId: seedSellerId,
        title: "Payme Test Xizmati — 1 000 so'm",
        contractsCount: 0,
        offersCount: 0,
      }),
    ).toBe('PROVEN_DEMO');

    expect(
      seedSafety.classifyDemoSeller({
        userId: seedSellerId,
        contractsCount: 1,
        proposalsCount: 0,
        payoutsCount: 0,
        ledgerEntriesCount: 0,
        hasNonSeedService: false,
      }),
    ).toBe('PROTECTED_WITH_HISTORY');
  });

  it('hides CLOSED jobs from unauthenticated visitors and strangers while keeping buyer & bidder access', async () => {
    const jobId = '01930000-0000-7000-8000-000000000123';
    const closedJob = {
      id: jobId,
      buyerId: 'buyer-owner',
      categoryId: 'cat-1',
      title: 'Closed demo job',
      description: 'Should not be exposed publicly',
      budgetMin: BigInt(100_000_00),
      budgetMax: BigInt(200_000_00),
      currency: 'UZS',
      skillsRequired: [],
      screeningQuestions: [],
      proposalsCount: 1,
      status: JobStatus.CLOSED,
      deadline: null,
      attachedImages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
      buyer: { id: 'buyer-owner', fullName: 'Buyer' },
      category: { id: 'cat-1', slug: 'dasturlash' },
    };

    const prisma = {
      job: { findUnique: jest.fn().mockResolvedValue(closedJob) },
      jobProposal: {
        findFirst: jest.fn(({ where }: { where: { sellerId: string } }) =>
          Promise.resolve(where.sellerId === 'seller-bidder' ? { id: 'prop-1' } : null),
        ),
      },
    };

    const service = new JobsService(
      prisma as unknown as PrismaService,
      {} as IdFactory,
      {} as AuditService,
      {} as OutboxService,
    );

    await expect(service.getByIdOrThrow(jobId)).rejects.toThrow(NotFoundError);
    await expect(service.getByIdOrThrow(jobId, 'stranger-1')).rejects.toThrow(NotFoundError);

    const buyerView = await service.getByIdOrThrow(jobId, 'buyer-owner');
    expect(buyerView.id).toBe(jobId);

    const bidderView = await service.getByIdOrThrow(jobId, 'seller-bidder');
    expect(bidderView.id).toBe(jobId);
  });

  it('pauses new registrations with 503 REGISTRATION_PAUSED when REGISTRATION_PAUSED=true', async () => {
    const config = { registrationPaused: true } as unknown as AppConfigService;
    const authService = new AuthService(
      {} as PrismaService,
      {} as IdFactory,
      {} as never,
      {} as never,
      {} as AuditService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      config,
    );

    await expect(authService.requestRegisterOtp('+998901234567')).rejects.toThrow(DomainError);
    await expect(authService.requestRegisterOtp('+998901234567')).rejects.toMatchObject({
      code: 'REGISTRATION_PAUSED',
    });
    await expect(authService.verifyRegisterOtp('+998901234567', '123456')).rejects.toMatchObject({
      code: 'REGISTRATION_PAUSED',
    });
  });
});
