import { ContractService } from './contract.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { IdFactory } from '@/common/id/id.factory';
import { AuditService } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { LedgerService } from '@/modules/ledger/ledger.service';

describe('Milestone lifecycle guards', () => {
  it.each(['submit', 'revision', 'approve'] as const)('%s rejects a cancelled contract even with funded, mutable milestones', async (operation) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'CANCELLED' }) },
      milestone: { updateMany: jest.fn() },
    };
    const prisma = {
      milestone: { findFirst: jest.fn().mockResolvedValue({ id: 'milestone' }) },
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment' }) },
      $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new ContractService(prisma as unknown as PrismaService, {} as IdFactory,
      {} as AuditService, {} as OutboxService, {} as LedgerService);
    const actor = { id: 'user', type: 'USER' as const, name: 'User' };
    const promise = operation === 'submit'
      ? service.submitMilestone('contract', 'milestone', 'user', { message: 'done' }, actor)
      : operation === 'revision'
        ? service.requestRevision('contract', 'milestone', 'user', { reason: 'revise' }, actor)
        : service.approveMilestone('contract', 'milestone', 'user', actor);
    await expect(promise).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(tx.milestone.updateMany).not.toHaveBeenCalled();
  });
});
