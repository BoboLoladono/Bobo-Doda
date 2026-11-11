import { DisputeService } from './dispute.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { RefundService } from '@/modules/refund/refund.service';

describe('Dispute funding and refund boundaries', () => {
  it.each([
    ['missing payment', null, null, 'CONTRACT_NOT_FUNDED'],
    ['missing funding journal', { id: 'payment' }, null, 'CONTRACT_NOT_FUNDED'],
  ])('rejects %s before creating financial allocations', async (_label, payment, journal, code) => {
    const contract = { id: 'contract', status: 'ACTIVE' };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      dispute: { findUnique: jest.fn().mockResolvedValue({ id: 'dispute', contractId: 'contract', status: 'OPEN', preSettlement: true, heldAmount: 10000n }), create: jest.fn() },
      payment: { findFirst: jest.fn().mockResolvedValue(payment) },
    };
    const prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue(contract) },
      $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const ledger = { findFundingTransaction: jest.fn().mockResolvedValue(journal), postDisputeSellerAward: jest.fn() };
    const service = new DisputeService(
      prisma as unknown as PrismaService,
      { next: () => 'dispute' },
      {} as AuditService,
      {} as OutboxService,
      ledger as unknown as LedgerService,
      {} as RefundService,
    );
    await expect(service.resolve('dispute', 'staff', 0, 100, 'reason', { id: 'staff', type: 'STAFF', name: 'Staff' }))
      .rejects.toMatchObject({ code });
    expect(ledger.postDisputeSellerAward).not.toHaveBeenCalled();
  });
  it('rejects opening a dispute against an already reserved refund', async () => {
    const contract = { id: 'contract', status: 'ACTIVE' };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue(contract) },
      dispute: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      refund: { findFirst: jest.fn().mockResolvedValue({ id: 'refund' }) },
    };
    const prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue(contract) },
      $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new DisputeService(prisma as unknown as PrismaService,
      { next: () => 'dispute' }, {} as AuditService, {} as OutboxService,
      {} as LedgerService, {} as RefundService);
    await expect(service.open('contract', 'buyer', 'OTHER', 'description', { id: 'buyer', type: 'USER', name: 'Buyer' }))
      .rejects.toMatchObject({ code: 'CONTRACT_REFUND_IN_PROGRESS' });
    expect(tx.dispute.create).not.toHaveBeenCalled();
  });

});
