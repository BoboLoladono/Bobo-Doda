import { RefundService } from './refund.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import type { PaymentProvider } from '@/modules/payment/providers/payment-provider.interface';

describe('Refund creation financial serialization', () => {
  function fixture(status: string, dispute: { id: string } | null = null) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status }) },
      dispute: { findFirst: jest.fn().mockResolvedValue(dispute) },
      refund: { create: jest.fn().mockResolvedValue({ id: 'refund' }) },
    };
    const prisma = {
      contract: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 'payment', amount: 100n, currency: 'UZS' }) },
      dispute: { findFirst: jest.fn().mockResolvedValue(null) },
      refund: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const provider = { name: 'TEST', refundPayment: jest.fn() };
    const service = new RefundService(
      prisma as unknown as PrismaService,
      { next: () => 'refund' },
      { record: jest.fn() } as unknown as AuditService,
      {} as OutboxService,
      {} as LedgerService,
      provider as unknown as PaymentProvider,
    );
    return { service, tx, provider };
  }

  it('does not send external refund when settlement wins after the preflight read', async () => {
    const { service, tx, provider } = fixture('COMPLETED');
    await expect(service.create('contract', 'staff', 'reason', { id: 'staff', type: 'STAFF', name: 'Staff' }))
      .rejects.toMatchObject({ code: 'REFUND_NOT_ALLOWED' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.refund.create).not.toHaveBeenCalled();
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });

  it('does not send external refund when a dispute wins after the preflight read', async () => {
    const { service, tx, provider } = fixture('ACTIVE', { id: 'dispute' });
    await expect(service.create('contract', 'staff', 'reason', { id: 'staff', type: 'STAFF', name: 'Staff' }))
      .rejects.toMatchObject({ code: 'DISPUTE_IN_PROGRESS' });
    expect(tx.refund.create).not.toHaveBeenCalled();
    expect(provider.refundPayment).not.toHaveBeenCalled();
  });
});
