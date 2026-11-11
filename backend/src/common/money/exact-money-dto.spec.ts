import type { Dispute, Payout, Prisma, Refund } from '@prisma/client';
import { toLedgerTransactionResponseDto } from '@/modules/ledger/dto/ledger-transaction-response.dto';
import { toSellerBalanceResponseDto } from '@/modules/ledger/dto/seller-balance-response.dto';
import { toRefundResponseDto, toStaffRefundResponseDto } from '@/modules/refund/dto/refund-response.dto';
import { toPayoutResponseDto, toStaffPayoutResponseDto } from '@/modules/payout/dto/payout-response.dto';
import { toDisputeResponseDto, toStaffDisputeResponseDto } from '@/modules/dispute/dto/dispute-response.dto';

describe('Exact minor-unit money response serialization', () => {
  it.each([0n, 95n, -95n, 12345n, 9223372036854775807n])('preserves balance %s tiyin through JSON', (amount) => {
    const dto = toSellerBalanceResponseDto('UZS', amount);
    const wire = JSON.parse(JSON.stringify(dto)) as { availableTiyin: string; available: number };
    expect(BigInt(wire.availableTiyin)).toBe(amount);
    expect(wire.available).toBe(Number(amount / 100n));
  });

  it('preserves balanced debit/credit journals even when legacy whole-som lines lose fractions', () => {
    type Journal = Prisma.LedgerTransactionGetPayload<{ include: { entries: { include: { account: true } } } }>;
    const amounts = [-100n, 95n, 5n];
    const journal = {
      entries: amounts.map((amount) => ({ amount, account: { type: 'SELLER_PAYABLE', ownerType: 'USER' } })),
    } as unknown as Journal;
    const dto = toLedgerTransactionResponseDto(journal);
    const wire = JSON.parse(JSON.stringify(dto)) as { entries: { amountTiyin: string; amount: number }[] };
    expect(wire.entries.reduce((sum, entry) => sum + BigInt(entry.amountTiyin), 0n)).toBe(0n);
    expect(wire.entries.map((entry) => entry.amount)).toEqual([-1, 0, 0]);
    expect(wire.entries.map((entry) => entry.amountTiyin)).toEqual(['-100', '95', '5']);
  });

  it('preserves fractional-so‘m refund and payout amounts for both customer and staff responses', () => {
    const refund = { amount: 95n } as Refund;
    const payout = { amount: 95n } as Payout;
    for (const dto of [toRefundResponseDto(refund), toStaffRefundResponseDto(refund), toPayoutResponseDto(payout), toStaffPayoutResponseDto(payout)]) {
      expect(dto).toMatchObject({ amount: 0, amountTiyin: '95' });
      expect(JSON.stringify(dto)).toContain('"amountTiyin":"95"');
    }
  });

  it('preserves dispute allocations, including zero awards and unresolved nulls', () => {
    const base = { disputedAmount: 195n, heldAmount: 95n, buyerAwardAmount: 0n, sellerAwardAmount: 95n } as Dispute;
    for (const dto of [toDisputeResponseDto(base), toStaffDisputeResponseDto(base)]) {
      expect(dto).toMatchObject({ disputedAmountTiyin: '195', heldAmountTiyin: '95', buyerAwardAmountTiyin: '0', sellerAwardAmountTiyin: '95' });
      expect(JSON.stringify(dto)).toContain('"buyerAwardAmountTiyin":"0"');
    }
    const unresolved = toDisputeResponseDto({ ...base, buyerAwardAmount: null, sellerAwardAmount: null });
    expect(unresolved.buyerAwardAmountTiyin).toBeNull();
    expect(unresolved.sellerAwardAmountTiyin).toBeNull();
  });
});
