import { DomainError } from '@/common/errors/domain-error';
import { MAX_SOM, somToTiyin } from '@/common/money/money.util';

export interface DisputeAwardInput {
  buyerAwardAmount?: number;
  sellerAwardAmount?: number;
  buyerAwardAmountTiyin?: string;
  sellerAwardAmountTiyin?: string;
}

/** Accept exactly one complete pair. Never convert exact minor units through Number. */
export function parseDisputeAwards(input: DisputeAwardInput): { buyerAward: bigint; sellerAward: bigint } {
  const invalid = (): never => {
    throw new DomainError('INVALID_AMOUNT', 'Ikkala ulushni bir xil birlikda kiriting: butun so‘m yoki aniq tiyin');
  };
  const exact = input.buyerAwardAmountTiyin !== undefined || input.sellerAwardAmountTiyin !== undefined;
  if (exact) {
    if (input.buyerAwardAmount !== undefined || input.sellerAwardAmount !== undefined) return invalid();
    const parse = (value: unknown): bigint => {
      if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,12})$/.test(value)) return invalid();
      const amount = BigInt(value);
      if (amount > BigInt(MAX_SOM) * 100n) return invalid();
      return amount;
    };
    return { buyerAward: parse(input.buyerAwardAmountTiyin), sellerAward: parse(input.sellerAwardAmountTiyin) };
  }
  const parse = (value: unknown): bigint => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_SOM) return invalid();
    return value === 0 ? 0n : somToTiyin(value);
  };
  return { buyerAward: parse(input.buyerAwardAmount), sellerAward: parse(input.sellerAwardAmount) };
}
