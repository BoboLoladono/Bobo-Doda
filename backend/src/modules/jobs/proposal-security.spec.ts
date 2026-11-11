import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '@/modules/auth/decorators/public.decorator';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';
import type { AuditService } from '@/common/audit/audit.service';
import type { OutboxService } from '@/common/outbox/outbox.service';

describe('durable proposal authorization and lifecycle', () => {
  const row = {
    id: 'prop_1',
    jobId: 'job-1',
    sellerId: 'seller-1',
    status: 'korib_chiqilmoqda',
    payload: { id: 'prop_1', bidAmount: 500000 },
    job: { id: 'job-1', buyerId: 'buyer-1', categoryId: 'cat-1', status: 'OPEN', title: 'Job', description: 'Desc', currency: 'UZS', deadline: null },
  };
  const setup = () => {
    const contractResult = {
      id: 'contract-id',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      serviceId: null,
      sourceType: 'JOB',
      jobId: 'job-1',
      proposalId: 'prop_1',
      serviceTitleSnapshot: 'Job',
      serviceDescriptionSnapshot: 'Desc',
      categoryNameSnapshot: 'Dasturlash',
      sellerDisplayNameSnapshot: 'Seller',
      agreedAmount: 50000000n,
      currency: 'UZS',
      platformFeeRateBpsSnapshot: 500,
      platformFeeAmountSnapshot: 2500000n,
      deadline: new Date(),
      status: 'PENDING_SELLER',
      createdAt: new Date(),
      updatedAt: new Date(),
      milestones: [],
      payments: [],
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      job: { findUnique: jest.fn().mockResolvedValue({ id: 'job-1', buyerId: 'buyer-1', status: 'OPEN', title: 'Job' }), update: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Seller', avatarKey: null }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'seller-1', fullName: 'Seller', status: 'ACTIVE', sellerStatus: 'APPROVED' }),
      },
      category: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'cat-1', nameUz: 'Dasturlash' }),
      },
      sellerApplication: {
        findFirst: jest.fn().mockResolvedValue({ displayName: 'Seller' }),
      },
      contract: {
        create: jest.fn().mockResolvedValue(contractResult),
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(contractResult),
      },
      milestone: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      jobProposal: {
        findUnique: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = { ...tx, $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) } as unknown as OutboxService;
    return {
      tx,
      service: new JobsService(db as unknown as PrismaService, { next: () => 'new-id' }, audit, outbox),
    };
  };
  it('private proposal routes do not bypass global authentication', () => {
    for (const method of ['getProposal', 'listProposals', 'hireProposal'] as const) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, JobsController.prototype[method])).not.toBe(true);
    }
  });
  it('rejects reading another participant application', async () => {
    const { service } = setup();
    await expect(service.getProposal('prop_1', 'stranger')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.getProposal('prop_1', 'seller-1')).resolves.toMatchObject({ id: 'prop_1' });
    await expect(service.getProposal('prop_1', 'buyer-1')).resolves.toMatchObject({ id: 'prop_1' });
  });
  it('only permits the buyer to inspect the job proposal list', async () => {
    const { service } = setup();
    jest.spyOn(service, 'getByIdOrThrow').mockResolvedValue({ buyerId: 'buyer-1' } as never);
    await expect(service.listProposalsForJob('job-1', 'stranger')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.listProposalsForJob('job-1', 'buyer-1')).resolves.toHaveLength(1);
  });
  it('authorizes only the job buyer and validates hiring constraints', async () => {
    const { service, tx } = setup();
    await expect(service.hireProposal('prop_1', 'stranger')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // When seller is not approved, hiring is rejected
    tx.user.findUniqueOrThrow.mockResolvedValueOnce({ id: 'seller-1', status: 'ACTIVE', sellerStatus: 'NOT_APPLIED' });
    await expect(service.hireProposal('prop_1', 'buyer-1')).rejects.toMatchObject({ code: 'SELLER_NOT_APPROVED' });

    // When seller is approved, hiring creates a job contract
    tx.user.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 'seller-1', status: 'ACTIVE', sellerStatus: 'APPROVED', fullName: 'Seller' })
      .mockResolvedValueOnce({ id: 'buyer-1', fullName: 'Buyer' });
    const contract = await service.hireProposal('prop_1', 'buyer-1');
    expect(contract).toMatchObject({ id: 'contract-id', sourceType: 'JOB' });
    expect(tx.contract.create).toHaveBeenCalled();
    expect(tx.job.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'CLOSED' } }));
  });
  it('rejects withdrawal by another seller without mutating data', async () => {
    const { service, tx } = setup();
    await expect(service.withdrawProposal('prop_1', 'stranger')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tx.jobProposal.updateMany).not.toHaveBeenCalled();
  });
  it('retrying withdrawal does not decrement the job counter twice', async () => {
    const { service, tx } = setup();
    tx.jobProposal.findUnique.mockResolvedValue({ ...row, status: 'qaytarib_olingan' });
    tx.jobProposal.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.withdrawProposal('prop_1', 'seller-1')).resolves.toMatchObject({ status: 'qaytarib_olingan' });
    expect(tx.job.update).not.toHaveBeenCalled();
  });
  it('enforces the two-per-calendar-day quota before writing', async () => {
    const { service, tx } = setup();
    tx.jobProposal.count.mockResolvedValue(2);
    await expect(service.createProposal('job-1', 'seller-1', { bidAmount: 1000, coverLetter: 'Valid application' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(tx.jobProposal.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it('rejects self applications', async () => {
    const { service, tx } = setup();
    await expect(service.createProposal('job-1', 'buyer-1', { bidAmount: 1000, coverLetter: 'Valid application' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tx.jobProposal.create).not.toHaveBeenCalled();
  });
  it('persists the application and counter within one transaction', async () => {
    const { service, tx } = setup();
    tx.jobProposal.findUnique.mockResolvedValue(null);
    await expect(service.createProposal('job-1', 'seller-1', { bidAmount: 1000, coverLetter: 'Valid application' })).resolves.toMatchObject({ id: 'prop_new-id' });
    expect(tx.jobProposal.create).toHaveBeenCalledTimes(1);
    expect(tx.job.update).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { proposalsCount: { increment: 1 } } });
  });
  it('propagates persistence failures rather than returning a fake success', async () => {
    const { service, tx } = setup();
    tx.jobProposal.findUnique.mockResolvedValue(null);
    tx.jobProposal.create.mockRejectedValue(new Error('database unavailable'));
    await expect(service.createProposal('job-1', 'seller-1', { bidAmount: 1000, coverLetter: 'Valid application' })).rejects.toThrow('database unavailable');
    expect(tx.job.update).not.toHaveBeenCalled();
  });
});
