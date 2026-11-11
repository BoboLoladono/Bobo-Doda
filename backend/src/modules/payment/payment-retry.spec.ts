import { PaymentService } from './payment.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { AppConfigService } from '@/config/app-config.service';
import type { PaymentProvider } from './providers/payment-provider.interface';

describe('Payment checkout retries', () => {
  function fixture(currentStatus = 'ACTIVE') {
    const payment = { id: 'payment', status: 'PENDING', amount: 10000n, currency: 'UZS', contractId: 'contract' };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: currentStatus }) },
      payment: {
        findFirst: jest.fn().mockResolvedValue(payment),
        findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
        create: jest.fn(),
      },
      paymeTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      contract: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE', currency: 'UZS' }) },
      $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const provider = { name: 'PAYME', buildCheckoutUrl: jest.fn().mockReturnValue({ checkoutUrl: 'https://checkout.test' }) };
    const service = new PaymentService(
      prisma as unknown as PrismaService, { next: () => 'unused' },
      {} as AuditService, {} as OutboxService, {} as LedgerService, {} as AppConfigService,
      provider as unknown as PaymentProvider,
    );
    return { service, tx, provider };
  }

  it('reuses existing pending checkout without creating a second payment', async () => {
    const { service, tx, provider } = fixture();
    await expect(service.create('contract', 'buyer', { id: 'buyer', type: 'USER', name: 'Buyer' }))
      .resolves.toMatchObject({ payment: { id: 'payment' }, checkoutUrl: 'https://checkout.test' });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(provider.buildCheckoutUrl).toHaveBeenCalledTimes(1);
  });

  it('rechecks contract lifecycle after obtaining the lock', async () => {
    const { service, tx, provider } = fixture('COMPLETED');
    await expect(service.create('contract', 'buyer', { id: 'buyer', type: 'USER', name: 'Buyer' }))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_ALLOWED' });
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(provider.buildCheckoutUrl).not.toHaveBeenCalled();
  });
});
