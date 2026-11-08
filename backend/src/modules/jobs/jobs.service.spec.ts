import { JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { IdFactory } from '@/common/id/id.factory';
import { DomainError, ForbiddenError, NotFoundError } from '@/common/errors/domain-error';
import { somToTiyin } from '@/common/money/money.util';

describe('JobsService', () => {
  let service: JobsService;
  let prisma: Partial<PrismaService>;
  let ids: Partial<IdFactory>;

  const mockJob = {
    id: '01925b6a-9999-7000-8000-000000000001',
    buyerId: '01925b6a-8888-7000-8000-000000000002',
    categoryId: '01a092fb-037e-740b-9b72-83002432b73c',
    title: 'Veb-sayt yaratish kerak',
    description: 'Biznesimiz uchun zamonaviy landing page kerak',
    budgetMin: somToTiyin(1_000_000),
    budgetMax: somToTiyin(2_000_000),
    currency: 'UZS',
    skillsRequired: ['Next.js', 'Tailwind'],
    screeningQuestions: ['Portfolio bormi?'],
    proposalsCount: 0,
    status: JobStatus.OPEN,
    deadline: new Date('2026-12-31T00:00:00Z'),
    attachedImages: [],
    createdAt: new Date('2026-10-08T12:00:00Z'),
    updatedAt: new Date('2026-10-08T12:00:00Z'),
    version: 0,
    buyer: { id: '01925b6a-8888-7000-8000-000000000002', fullName: 'Alisher V.' },
    category: { id: '01a092fb-037e-740b-9b72-83002432b73c', slug: 'dasturlash' },
  };

  beforeEach(() => {
    ids = {
      next: jest.fn().mockReturnValue('01925b6a-9999-7000-8000-000000000001'),
    };
    prisma = {
      category: {
        findFirst: jest.fn().mockResolvedValue({
          id: '01a092fb-037e-740b-9b72-83002432b73c',
          slug: 'dasturlash',
        }),
      } as unknown,
      job: {
        create: jest.fn().mockResolvedValue(mockJob),
        findMany: jest.fn().mockResolvedValue([mockJob]),
        findUnique: jest.fn().mockResolvedValue(mockJob),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue({ ...mockJob, status: JobStatus.CLOSED }),
      } as unknown,
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      } as unknown,
    } as unknown as PrismaService;

    prisma.$transaction = jest.fn((fn: (tx: Partial<PrismaService>) => unknown) => fn(prisma)) as never;
    service = new JobsService(prisma as PrismaService, ids as IdFactory);
  });

  describe('create', () => {
    it('creates a job with valid input', async () => {
      const res = await service.create('01925b6a-8888-7000-8000-000000000002', {
        title: 'Veb-sayt yaratish kerak',
        description: 'Biznesimiz uchun zamonaviy landing page kerak',
        category: 'dasturlash',
        budgetMin: 1_000_000,
        budgetMax: 2_000_000,
        skillsRequired: ['Next.js'],
        screeningQuestions: ['Portfolio bormi?'],
      });

      expect(res.id).toBe('01925b6a-9999-7000-8000-000000000001');
      expect(prisma.job?.create).toHaveBeenCalled();
    });

    it('throws INVALID_AMOUNT when budgetMin < 1_000', async () => {
      await expect(
        service.create('01925b6a-8888-7000-8000-000000000002', {
          title: 'Veb-sayt yaratish kerak',
          description: 'Biznesimiz uchun zamonaviy landing page kerak',
          category: 'dasturlash',
          budgetMin: 10,
          budgetMax: 2_000_000,
        }),
      ).rejects.toThrow(DomainError);
    });

    it('throws INVALID_AMOUNT when budgetMin > budgetMax', async () => {
      await expect(
        service.create('01925b6a-8888-7000-8000-000000000002', {
          title: 'Veb-sayt yaratish kerak',
          description: 'Biznesimiz uchun zamonaviy landing page kerak',
          category: 'dasturlash',
          budgetMin: 3_000_000,
          budgetMax: 2_000_000,
        }),
      ).rejects.toThrow(DomainError);
    });

    it('throws NOT_FOUND when category does not exist', async () => {
      (prisma.category?.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create('01925b6a-8888-7000-8000-000000000002', {
          title: 'Veb-sayt yaratish kerak',
          description: 'Biznesimiz uchun zamonaviy landing page kerak',
          category: 'mavjud_emas',
          budgetMin: 1_000_000,
          budgetMax: 2_000_000,
        }),
      ).rejects.toThrow(DomainError);
    });
  });

  describe('listPublic', () => {
    it('returns paginated public jobs', async () => {
      const res = await service.listPublic({ page: 1, perPage: 20 });
      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
    });
  });

  describe('listMine', () => {
    it('returns jobs created by the buyer', async () => {
      const res = await service.listMine('01925b6a-8888-7000-8000-000000000002');
      expect(res.items).toHaveLength(1);
    });
  });

  describe('getByIdOrThrow', () => {
    it('returns job if found', async () => {
      const res = await service.getByIdOrThrow('01925b6a-9999-7000-8000-000000000001');
      expect(res.id).toBe('01925b6a-9999-7000-8000-000000000001');
    });

    it('throws NotFoundError for non-UUID id', async () => {
      await expect(service.getByIdOrThrow('invalid-id')).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when not found', async () => {
      (prisma.job?.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        service.getByIdOrThrow('01925b6a-9999-7000-8000-000000000001'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('close', () => {
    it('closes job when requested by owner', async () => {
      const res = await service.close(
        '01925b6a-9999-7000-8000-000000000001',
        '01925b6a-8888-7000-8000-000000000002',
      );
      expect(res.status).toBe(JobStatus.CLOSED);
    });

    it('throws ForbiddenError when requested by another user', async () => {
      await expect(
        service.close('01925b6a-9999-7000-8000-000000000001', 'other-user-uuid'),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('listForStaff', () => {
    it('returns paginated jobs for staff', async () => {
      const res = await service.listForStaff({ page: 1, perPage: 10, status: 'OPEN' });
      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
      expect(res.page).toBe(1);
    });
  });

  describe('closeAsAdmin', () => {
    it('allows staff to close job and creates audit log', async () => {
      const res = await service.closeAsAdmin(
        '01925b6a-9999-7000-8000-000000000001',
        'Moderatsiya sababi',
        { id: 'staff-1', type: 'STAFF', name: 'Admin Ali' },
      );
      expect(res.status).toBe(JobStatus.CLOSED);
      expect(prisma.job?.update).toHaveBeenCalled();
      expect(prisma.auditLog?.create).toHaveBeenCalled();
    });

    it('fails the transaction when mandatory audit logging fails', async () => {
      (prisma.auditLog?.create as jest.Mock).mockRejectedValue(new Error('audit unavailable'));
      await expect(service.closeAsAdmin(mockJob.id, 'Reason', { id: 'staff-1', type: 'STAFF', name: 'Admin' }))
        .rejects.toThrow('audit unavailable');
    });
  });
});
