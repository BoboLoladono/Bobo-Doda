import { EVENT_ROUTES } from './event-routing.constant';
import type { NotificationContext } from './recipient-resolver.service';

function ctx(overrides: Partial<NotificationContext> = {}): NotificationContext {
  return {
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    userId: 'user-1',
    contractId: 'contract-1',
    amountTiyin: 90_000_00n,
    sellerNetTiyin: 85_500_00n,
    currency: 'UZS',
    title: 'Logotip yaratish',
    extra: {},
    ...overrides,
  };
}

function resolveRecipient(eventType: string, context: NotificationContext): 'BUYER' | 'SELLER' | 'USER' | null {
  const route = EVENT_ROUTES[eventType];
  if (!route) return null;
  return typeof route.recipient === 'function' ? route.recipient(context) : route.recipient;
}

describe('EVENT_ROUTES — bo‘lim 50 markaziy routing jadvali', () => {
  it('barcha real inventarizatsiya qilingan eventType kalitlari mavjud', () => {
    const expected = [
      'SELLER_APPLICATION_APPROVED',
      'SELLER_APPLICATION_REJECTED',
      'KYC_VERIFICATION_APPROVED',
      'KYC_VERIFICATION_REJECTED',
      'SERVICE_APPROVED',
      'SERVICE_REJECTED',
      'CONTRACT_CREATED',
      'CONTRACT_ACCEPTED',
      'CONTRACT_REJECTED',
      'CONTRACT_CANCELLED',
      'CONTRACT_COMPLETED',
      'CONTRACT_SETTLED',
      'MILESTONE_SUBMITTED',
      'MILESTONE_REVISION_REQUESTED',
      'MILESTONE_APPROVED',
      'PAYMENT_SUCCEEDED',
      'PAYMENT_FAILED',
      'ESCROW_FUNDED',
      'REFUND_SUCCEEDED',
      'REFUND_FAILED',
      'PAYOUT_RESERVED',
      'PAYOUT_SUCCEEDED',
      'PAYOUT_FAILED',
      'SELLER_FUNDS_RELEASED',
      'DISPUTE_OPENED',
      'DISPUTE_EVIDENCE_ADDED',
      'DISPUTE_CANCELLED',
      'DISPUTE_REVIEW_STARTED',
      'DISPUTE_REJECTED',
      'DISPUTE_SELLER_FUNDS_RELEASED',
      'DISPUTE_BUYER_REFUND_ALLOCATED',
      'DISPUTE_RESOLVED',
      'USER_BLOCKED',
      'SELLER_SUSPENDED',
    ];
    for (const eventType of expected) {
      expect(eventType in EVENT_ROUTES).toBe(true);
    }
    expect(Object.keys(EVENT_ROUTES).sort()).toEqual(expected.sort());
  });

  it('bilinmagan eventType — kalit UMUMAN yo‘q (UNSUPPORTED_EVENT worker darajasida aniqlanadi)', () => {
    expect('SOME_UNKNOWN_EVENT' in EVENT_ROUTES).toBe(false);
  });

  it('ataylab bildirishnoma mo‘ljallanmagan hodisalar — null', () => {
    expect(EVENT_ROUTES.PAYOUT_RESERVED).toBeNull();
    expect(EVENT_ROUTES.SELLER_FUNDS_RELEASED).toBeNull();
    expect(EVENT_ROUTES.DISPUTE_EVIDENCE_ADDED).toBeNull();
  });

  it('to‘liq kontekst bilan — HAR bir real shablon (null bo‘lmaganlar) matn qaytaradi', () => {
    for (const route of Object.values(EVENT_ROUTES)) {
      if (route === null) continue;
      const message = route.render(ctx({ extra: { reason: 'test sabab', resolutionReason: 'test sabab', resolutionType: 'SPLIT', sellerId: 'seller-1', openedByUserId: 'buyer-1', sellerAward: '10000000', amount: '5000000' } }));
      expect(message).not.toBeNull();
      expect(typeof message).toBe('string');
    }
  });

  it('CONTRACT_CREATED — title/amount yo‘q bo‘lsa null (bo‘lim 22 — malformed xabar yuborilmaydi)', () => {
    const route = EVENT_ROUTES.CONTRACT_CREATED!;
    expect(route.render(ctx({ title: undefined }))).toBeNull();
    expect(route.render(ctx({ amountTiyin: undefined }))).toBeNull();
  });

  it('CONTRACT_CANCELLED — payload.sellerId bo‘lsa SELLER, aks holda BUYER', () => {
    expect(resolveRecipient('CONTRACT_CANCELLED', ctx({ extra: { sellerId: 'seller-1' } }))).toBe('SELLER');
    expect(resolveRecipient('CONTRACT_CANCELLED', ctx({ extra: {} }))).toBe('BUYER');
  });

  it('DISPUTE_OPENED — ochuvchi buyer bo‘lsa SELLER xabar oladi (qarshi tomon)', () => {
    expect(resolveRecipient('DISPUTE_OPENED', ctx({ extra: { openedByUserId: 'buyer-1' } }))).toBe('SELLER');
    expect(resolveRecipient('DISPUTE_OPENED', ctx({ extra: { openedByUserId: 'seller-1' } }))).toBe('BUYER');
  });

  it('DISPUTE_SELLER_FUNDS_RELEASED — extra.sellerAward tiyin sifatida to‘g‘ri so‘mga aylantiriladi', () => {
    const route = EVENT_ROUTES.DISPUTE_SELLER_FUNDS_RELEASED!;
    const message = route.render(ctx({ extra: { sellerAward: '85500000' } })); // 855 000 so'm
    expect(message).toContain('855');
  });

  it('DISPUTE_SELLER_FUNDS_RELEASED — extra.sellerAward yo‘q bo‘lsa null', () => {
    const route = EVENT_ROUTES.DISPUTE_SELLER_FUNDS_RELEASED!;
    expect(route.render(ctx({ extra: {} }))).toBeNull();
  });

  it('MILESTONE_APPROVED — "pul tushdi" DEB YOZILMAYDI (bosqich tasdiqlash pul o‘tkazmaydi)', () => {
    const route = EVENT_ROUTES.MILESTONE_APPROVED!;
    const message = route.render(ctx());
    expect(message).not.toMatch(/tushdi|o'tkazildi|o’tkazildi/i);
  });

  it('barcha marshrutlar kanali IMPLEMENTED_CHANNELS (SMS) ichida', () => {
    for (const route of Object.values(EVENT_ROUTES)) {
      if (route === null) continue;
      expect(route.channel).toBe('SMS');
    }
  });
});
