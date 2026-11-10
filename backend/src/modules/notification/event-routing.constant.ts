import type { NotificationChannel } from '@prisma/client';
import { tiyinToSom } from '@/common/money/money.util';
import type { NotificationContext } from './recipient-resolver.service';

export type RecipientRole = 'BUYER' | 'SELLER' | 'USER';

export interface NotificationRoute {
  channel: NotificationChannel;
  /** Statik rol, YOKI payload'ga qarab hisoblanadigan dinamik funksiya (masalan "qarshi tomon"). */
  recipient: RecipientRole | ((ctx: NotificationContext) => RecipientRole | null);
  /**
   * Bo'lim 22 — kerakli maydon YO'Q bo'lsa `null` qaytaradi (providerga
   * malformed xabar YUBORILMAYDI, chaqiruvchi buni PERMANENT_FAILURE deb
   * ko'radi). Bo'lim 20 — matn shu YERDA, markazlashtirilgan (business
   * servis matn yozmaydi).
   */
  render: (ctx: NotificationContext) => string | null;
}

/**
 * Bo'lim 50 — MARKAZIY, ANIQ jadval: `eventType → recipient → kanal →
 * shablon`. Kalitda YO'Q eventType — `UNSUPPORTED_EVENT` (bo'lim 51,
 * operator ko'rishi kerak). Qiymati `null` — ATAYLAB bildirishnoma
 * mo'ljallanmagan (bo'lim 51's "unsupported"dan FARQLI: bu KOD BILGAN,
 * ongli qaror — masalan PAYOUT_RESERVED/SELLER_FUNDS_RELEASED PAYOUT_
 * SUCCEEDED/PAYOUT_FAILED bilan bir xil daqiqada takrorlangan xabar
 * bermasin deb, yoki DISPUTE_EVIDENCE_ADDED administrativ, shoshilinch
 * SMS talab qilmaydi deb).
 *
 * Bo'lim 21 — i18n: `User.locale` maydoni UMUMAN YO'Q (audit natijasi —
 * `report.md`da qayd etilgan). Shablonlar HOZIRCHA FAQAT o'zbek tilida
 * (platforma sukut tili) — RU/EN kerak bo'lganda shu funksiyalar `Locale`
 * parametr qabul qiladigan qilib kengaytiriladi, HOZIR "hech qanday tilni
 * noto'g'ri taxmin qilmaslik" ustuvor (aralash-tilli xabar yuborishdan
 * ko'ra bitta izchil til yaxshiroq).
 *
 * Bo'lim 56 — summalar HAR DOIM `tiyinToSom()` orqali (floating point YO'Q).
 */
function som(tiyin: bigint | undefined): string | null {
  if (tiyin === undefined) return null;
  return new Intl.NumberFormat('uz-UZ').format(tiyinToSom(tiyin));
}

/** Payload'dagi tiyin-string maydonini (masalan `sellerAward`) so'mga aylantiradi. */
function somFromExtra(ctx: NotificationContext, key: string): string | null {
  const raw = ctx.extra[key];
  if (!raw) return null;
  try {
    return som(BigInt(raw));
  } catch {
    return null;
  }
}

const counterpartyOf =
  (ownerField: 'buyerId' | 'sellerId', selfEventUserKey: string) =>
  (ctx: NotificationContext): RecipientRole | null => {
    const openerId = ctx.extra[selfEventUserKey];
    if (!openerId) return ownerField === 'buyerId' ? 'SELLER' : 'BUYER';
    if (openerId === ctx.buyerId) return 'SELLER';
    if (openerId === ctx.sellerId) return 'BUYER';
    return null;
  };

export const EVENT_ROUTES: Record<string, NotificationRoute | null> = {
  // ── Seller onboarding ──────────────────────────────────────────────
  SELLER_APPLICATION_APPROVED: {
    channel: 'SMS',
    recipient: 'USER',
    render: () => 'Tabriklaymiz! Sotuvchi arizangiz tasdiqlandi. Endi xizmat qo’sha olasiz. — Bobololadono',
  },
  SELLER_APPLICATION_REJECTED: {
    channel: 'SMS',
    recipient: 'USER',
    render: (ctx) => {
      const reason = ctx.extra.reason;
      if (!reason) return null;
      return `Sotuvchi arizangiz rad etildi. Sabab: ${reason} — Bobololadono`;
    },
  },

  // ── KYC Verification ────────────────────────────────────────────────
  KYC_VERIFICATION_APPROVED: {
    channel: 'SMS',
    recipient: 'USER',
    render: () => 'Tabriklaymiz! Shaxsingiz (KYC) muvaffaqiyatli tasdiqlandi — Bobololadono',
  },
  KYC_VERIFICATION_REJECTED: {
    channel: 'SMS',
    recipient: 'USER',
    render: (ctx) => {
      const reason = ctx.extra.rejectionReason;
      if (!reason) return 'Hujjatlaringiz tasdiqlanmadi. Iltimos, qayta topshiring — Bobololadono';
      return `Hujjatlaringiz rad etildi. Sabab: ${reason} — Bobololadono`;
    },
  },

  // ── Marketplace (Service) ──────────────────────────────────────────
  SERVICE_APPROVED: {
    channel: 'SMS',
    recipient: 'USER',
    render: (ctx) => (ctx.title ? `Xizmatingiz "${ctx.title}" tasdiqlandi va bozorda ko’rinadi — Bobololadono` : null),
  },
  SERVICE_REJECTED: {
    channel: 'SMS',
    recipient: 'USER',
    render: (ctx) => {
      if (!ctx.title || !ctx.extra.reason) return null;
      return `Xizmatingiz "${ctx.title}" rad etildi. Sabab: ${ctx.extra.reason} — Bobololadono`;
    },
  },

  // ── Contract lifecycle ──────────────────────────────────────────────
  CONTRACT_CREATED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => {
      const amount = som(ctx.amountTiyin);
      if (!ctx.title || !amount) return null;
      return `Yangi shartnoma taklifi: "${ctx.title}", ${amount} so’m. Ko’rib chiqing — Bobololadono`;
    },
  },
  CONTRACT_ACCEPTED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `Sotuvchi shartnomangizni qabul qildi: "${ctx.title}". To’lovni amalga oshiring — Bobololadono` : null),
  },
  CONTRACT_REJECTED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `Sotuvchi shartnomangizni rad etdi: "${ctx.title}" — Bobololadono` : null),
  },
  CONTRACT_CANCELLED: {
    channel: 'SMS',
    // Bo'lim 32 — ikkita chaqiruv joyi bor (buyer o'z ixtiyori bilan / arbitraj
    // orqali); payload'da `sellerId` bo'lsa — buyer bekor qilgan (seller xabar
    // oladi), aks holda buyer xabar oladi (arbitraj/refund-driven bekor qilish).
    recipient: (ctx) => (ctx.extra.sellerId ? 'SELLER' : 'BUYER'),
    render: (ctx) => (ctx.title ? `Shartnoma bekor qilindi: "${ctx.title}" — Bobololadono` : null),
  },
  CONTRACT_COMPLETED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `Ish yakunlandi: "${ctx.title}". Rahmat! Sharh qoldirishni unutmang — Bobololadono` : null),
  },
  CONTRACT_SETTLED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => {
      const amount = som(ctx.sellerNetTiyin);
      return amount ? `To’lovingiz hisobingizga tushdi: ${amount} so’m — Bobololadono` : null;
    },
  },

  // ── Milestone lifecycle ──────────────────────────────────────────────
  MILESTONE_SUBMITTED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `"${ctx.title}" bosqichi topshirildi. Ko’rib chiqing — Bobololadono` : null),
  },
  MILESTONE_REVISION_REQUESTED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => {
      if (!ctx.title || !ctx.extra.reason) return null;
      return `"${ctx.title}" bosqichiga o’zgartirish so’raldi: ${ctx.extra.reason} — Bobololadono`;
    },
  },
  // Bo'lim 56 — DIQQAT: bosqich tasdiqlanishi HALI pul o'tkazmaydi (backend
  // faqat OXIRGI bosqich tasdiqlanganda, CONTRACT_COMPLETED/SETTLED bilan
  // BIR TRANZAKSIYADA, settlement qiladi — `contract.service.ts`ning
  // `approveMilestone()` mantig'i). Shuning uchun bu yerda "pul tushdi"
  // DEB YOZILMAYDI — bu haqiqatga mos kelmas edi.
  MILESTONE_APPROVED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => (ctx.title ? `"${ctx.title}" bosqichi tasdiqlandi — Bobololadono` : null),
  },

  // ── Payment ───────────────────────────────────────────────────────────
  PAYMENT_SUCCEEDED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => {
      const amount = som(ctx.amountTiyin);
      if (!amount || !ctx.title) return null;
      return `To’lovingiz muvaffaqiyatli: ${amount} so’m ("${ctx.title}") — Bobololadono`;
    },
  },
  PAYMENT_FAILED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `To’lovingiz amalga oshmadi ("${ctx.title}"). Qayta urinib ko’ring — Bobololadono` : null),
  },
  ESCROW_FUNDED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => {
      const amount = som(ctx.amountTiyin);
      if (!amount || !ctx.title) return null;
      return `Shartnoma mablag’landi: "${ctx.title}", ${amount} so’m. Ishni boshlashingiz mumkin — Bobololadono`;
    },
  },

  // ── Refund ────────────────────────────────────────────────────────────
  REFUND_SUCCEEDED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => {
      const amount = som(ctx.amountTiyin);
      if (!amount || !ctx.title) return null;
      return `Qaytarilgan mablag’ hisobingizga tushdi: ${amount} so’m ("${ctx.title}") — Bobololadono`;
    },
  },
  REFUND_FAILED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `Mablag’ni qaytarishda xatolik yuz berdi ("${ctx.title}"). Tez orada hal qilinadi — Bobololadono` : null),
  },

  // ── Payout ────────────────────────────────────────────────────────────
  // Bo'lim: darhol rezervatsiya haqida SMS yuborilmaydi — PAYOUT_SUCCEEDED/
  // PAYOUT_FAILED tez orada keladi, ikki marta xabar spam bo'lardi.
  PAYOUT_RESERVED: null,
  PAYOUT_SUCCEEDED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => {
      const amount = som(ctx.amountTiyin);
      return amount ? `Pul yechish so’rovingiz bajarildi: ${amount} so’m kartangizga o’tkazildi — Bobololadono` : null;
    },
  },
  PAYOUT_FAILED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: () => 'Pul yechish so’rovingiz bajarilmadi. Mablag’ balansingizga qaytarildi — Bobololadono',
  },
  // Bo'lim: PAYOUT_FAILED bilan BIR XIL daqiqada, BIR XIL ma'noda hodisa —
  // ikkinchi SMS yuborilsa foydalanuvchi ikki marta bir xil xabar oladi.
  SELLER_FUNDS_RELEASED: null,

  // ── Dispute ───────────────────────────────────────────────────────────
  DISPUTE_OPENED: {
    channel: 'SMS',
    recipient: counterpartyOf('buyerId', 'openedByUserId'),
    render: (ctx) => (ctx.title ? `Nizo ochildi ("${ctx.title}"). Holatni tekshiring — Bobololadono` : null),
  },
  // Bo'lim: dalil qo'shish — administrativ, shoshilinch SMS talab qilmaydi
  // (staff dashboard orqali kuzatiladi); kim qo'shganini ANIQ bilmasdan
  // "qarshi tomon"ni hisoblash ham ishonchsiz bo'lardi.
  DISPUTE_EVIDENCE_ADDED: null,
  DISPUTE_CANCELLED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => (ctx.title ? `Nizo bekor qilindi ("${ctx.title}") — Bobololadono` : null),
  },
  DISPUTE_REVIEW_STARTED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `Nizoyingiz ko’rib chiqilmoqda ("${ctx.title}") — Bobololadono` : null),
  },
  DISPUTE_REJECTED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => {
      if (!ctx.title || !ctx.extra.resolutionReason) return null;
      return `Nizoyingiz rad etildi ("${ctx.title}"). Sabab: ${ctx.extra.resolutionReason} — Bobololadono`;
    },
  },
  DISPUTE_SELLER_FUNDS_RELEASED: {
    channel: 'SMS',
    recipient: 'SELLER',
    render: (ctx) => {
      const amount = somFromExtra(ctx, 'sellerAward');
      return amount ? `Nizo natijasida ${amount} so’m hisobingizga tushdi — Bobololadono` : null;
    },
  },
  DISPUTE_BUYER_REFUND_ALLOCATED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => {
      const amount = somFromExtra(ctx, 'amount');
      return amount ? `Nizo natijasida qaytarish rasmiylashtirildi: ${amount} so’m. Tez orada hisobingizga tushadi — Bobololadono` : null;
    },
  },
  DISPUTE_RESOLVED: {
    channel: 'SMS',
    recipient: 'BUYER',
    render: (ctx) => (ctx.title ? `Nizoyingiz hal qilindi ("${ctx.title}") — Bobololadono` : null),
  },

  // ── Staff admin operatsiyalari (Bosqich 11) ─────────────────────────────
  USER_BLOCKED: {
    channel: 'SMS',
    recipient: 'USER',
    render: () => 'Hisobingiz bloklandi. Batafsil ma’lumot uchun qo’llab-quvvatlash bilan bog’laning — Bobololadono',
  },
  SELLER_SUSPENDED: {
    channel: 'SMS',
    recipient: 'USER',
    render: () => 'Sotuvchi faoliyatingiz vaqtincha to’xtatildi. Batafsil: qo’llab-quvvatlash — Bobololadono',
  },
};
