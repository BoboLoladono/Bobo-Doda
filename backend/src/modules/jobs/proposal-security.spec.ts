import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '@/modules/auth/decorators/public.decorator';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import type { PrismaService } from '@/infra/prisma/prisma.service';

describe('durable proposal authorization and lifecycle', () => {
  const row = { id: 'prop_1', jobId: 'job-1', sellerId: 'seller-1', status: 'korib_chiqilmoqda', payload: { id: 'prop_1' }, job: { buyerId: 'buyer-1' } };
  const setup = () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      job: { findUnique: jest.fn().mockResolvedValue({ id: 'job-1', buyerId: 'buyer-1', status: 'OPEN', title: 'Job' }), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Seller', avatarKey: null }) },
      jobProposal: {
        findUnique: jest.fn().mockResolvedValue(row), findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = { ...tx, $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
    return { tx, service: new JobsService(db as unknown as PrismaService, { next: () => 'new-id' }) };
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
  it('does not fabricate hiring success or authorize another buyer', async () => {
    const { service } = setup();
    await expect(service.hireProposal('prop_1', 'stranger')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.hireProposal('prop_1', 'buyer-1')).rejects.toMatchObject({ code: 'NOT_READY' });
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
