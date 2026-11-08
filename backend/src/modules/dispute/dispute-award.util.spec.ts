import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { parseDisputeAwards, type DisputeAwardInput } from './dispute-award.util';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { DisputeService } from './dispute.service';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { AuditService } from '@/common/audit/audit.service';
import { OutboxService } from '@/common/outbox/outbox.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { RefundService } from '@/modules/refund/refund.service';

describe('Dispute award input units', () => {
  it.each([
    [{ buyerAwardAmount: 0, sellerAwardAmount: 1 }, 0n, 100n],
    [{ buyerAwardAmountTiyin: '0', sellerAwardAmountTiyin: '95' }, 0n, 95n],
    [{ buyerAwardAmountTiyin: '1000000000000', sellerAwardAmountTiyin: '0' }, 1000000000000n, 0n],
  ] as const)('accepts complete bounded pair %j', (input, buyerAward, sellerAward) => {
    expect(parseDisputeAwards(input)).toEqual({ buyerAward, sellerAward });
    expect(validateSync(plainToInstance(ResolveDisputeDto, { ...input, resolutionReason: 'Valid resolution reason' }))).toHaveLength(0);
  });

  it.each([
    {}, { buyerAwardAmount: 1 }, { buyerAwardAmountTiyin: '95' },
    { buyerAwardAmount: 0, sellerAwardAmount: 1, buyerAwardAmountTiyin: '0', sellerAwardAmountTiyin: '95' },
    { buyerAwardAmount: 0, sellerAwardAmountTiyin: '95' },
    ...['-1', '1.5', '1e2', ' 95', '095', '+95', '1000000000001', '9999999999999999999999999', null, 95]
      .map((value) => ({ buyerAwardAmountTiyin: '0', sellerAwardAmountTiyin: value })),
    { buyerAwardAmount: null, sellerAwardAmount: 0 },
  ])('rejects missing, mixed or malformed input %j at DTO and domain boundaries', (input) => {
    expect(() => parseDisputeAwards(input as DisputeAwardInput)).toThrow();
    expect(validateSync(plainToInstance(ResolveDisputeDto, { ...input, resolutionReason: 'Valid resolution reason' })).length).toBeGreaterThan(0);
  });

  it.each([['95', true], ['94', false]] as const)('resolves a 95-tiyin hold only with exact matching award %s', async (sellerAmount, succeeds) => {
    const dispute = { id: 'dispute', contractId: 'contract', status: 'OPEN', preSettlement: false, heldAmount: 95n };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      dispute: { findUnique: jest.fn().mockResolvedValue(dispute), update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue(dispute) },
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'contract', status: 'COMPLETED' }) },
      disputeEvent: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)) };
    const ledger = { postDisputeSellerAward: jest.fn().mockResolvedValue(null) };
    const service = new DisputeService(prisma as unknown as PrismaService, { next: () => 'event' },
      { record: jest.fn() } as unknown as AuditService, { enqueue: jest.fn() } as unknown as OutboxService,
      ledger as unknown as LedgerService, {} as RefundService);
    const result = service.resolve('dispute', 'staff', undefined, undefined, 'Valid resolution reason',
      { id: 'staff', type: 'STAFF', name: 'Staff' }, { buyerAwardAmountTiyin: '0', sellerAwardAmountTiyin: sellerAmount });
    if (succeeds) {
      await expect(result).resolves.toMatchObject({ refund: null });
      expect(ledger.postDisputeSellerAward).toHaveBeenCalledWith(tx, dispute, { id: 'contract', status: 'COMPLETED' }, 95n);
      expect(tx.dispute.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ buyerAwardAmount: 0n, sellerAwardAmount: 95n }) }));
    } else {
      await expect(result).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
      expect(ledger.postDisputeSellerAward).not.toHaveBeenCalled();
    }
  });
});
