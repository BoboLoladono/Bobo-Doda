import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';

/**
 * Bo'lim 14/16 — Outbox payload ATAYLAB minimal (ko'p hodisada `{}` yoki
 * bitta-ikkita maydon). Recipient/shablon uchun kerakli TO'LIQ kontekst
 * `aggregateType`+`aggregateId` orqali JORIY (snapshot EMAS) DB holatidan
 * o'qiladi — bo'lim 16's "business notification uchun current profile"
 * qarori: agar buyer keyinchalik telefon raqamini almashtirsa, u YANGI
 * raqamiga bildirishnoma oladi (bu — ataylab, OTP'dan farqli qaror).
 *
 * `payload` FAQAT qo'shimcha (ba'zi hodisalarda contextni tezlashtiradi/
 * aniqlashtiradi — masalan `reason`), HECH QACHON yagona manba emas.
 */
export interface NotificationContext {
  buyerId?: string;
  sellerId?: string;
  /** Bitta-tomonlama hodisalar uchun (SELLER_APPLICATION/SERVICE — target sotuvchi). */
  userId?: string;
  contractId?: string;
  amountTiyin?: bigint;
  /** Faqat CONTRACT — `agreedAmount - platformFeeAmountSnapshot` (sotuvchi sof ulushi). */
  sellerNetTiyin?: bigint;
  currency?: string;
  title?: string;
  /** Xom payload maydonlari (masalan `reason`, `resolutionType`) — shablon validatsiyasi shu yerdan o'qiydi. */
  extra: Record<string, string>;
}

function toExtra(payload: unknown): Record<string, string> {
  if (typeof payload !== 'object' || payload === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

@Injectable()
export class RecipientResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** `null` — aggregat qator topilmadi (masalan kelajakda tozalangan bo'lishi mumkin bo'lgan holat) — chaqiruvchi buni RECIPIENT_MISSING deb ko'radi. */
  async resolve(aggregateType: string, aggregateId: string, payload: unknown): Promise<NotificationContext | null> {
    const extra = toExtra(payload);

    switch (aggregateType) {
      case 'SELLER_APPLICATION': {
        const userId = typeof extra.userId === 'string' ? extra.userId : undefined;
        if (!userId) return null;
        return { userId, extra };
      }

      case 'KYC_VERIFICATION': {
        const userId = typeof extra.userId === 'string' ? extra.userId : undefined;
        if (userId) return { userId, extra };
        const kyc = await this.prisma.kycVerification.findUnique({ where: { id: aggregateId } });
        if (!kyc) return null;
        return { userId: kyc.userId, extra };
      }

      case 'SERVICE': {
        const service = await this.prisma.service.findUnique({ where: { id: aggregateId } });
        if (!service) return null;
        return { userId: service.sellerId, title: service.title, extra };
      }

      case 'CONTRACT': {
        const contract = await this.prisma.contract.findUnique({ where: { id: aggregateId } });
        if (!contract) return null;
        return {
          buyerId: contract.buyerId,
          sellerId: contract.sellerId,
          contractId: contract.id,
          amountTiyin: contract.agreedAmount,
          sellerNetTiyin: contract.agreedAmount - contract.platformFeeAmountSnapshot,
          currency: contract.currency,
          title: contract.serviceTitleSnapshot,
          extra,
        };
      }

      case 'MILESTONE': {
        const milestone = await this.prisma.milestone.findUnique({
          where: { id: aggregateId },
          include: { contract: true },
        });
        if (!milestone) return null;
        return {
          buyerId: milestone.contract.buyerId,
          sellerId: milestone.contract.sellerId,
          contractId: milestone.contractId,
          amountTiyin: milestone.amount,
          currency: milestone.contract.currency,
          title: milestone.title,
          extra,
        };
      }

      case 'PAYMENT': {
        const payment = await this.prisma.payment.findUnique({
          where: { id: aggregateId },
          include: { contract: true },
        });
        if (!payment) return null;
        return {
          buyerId: payment.payerUserId,
          sellerId: payment.contract.sellerId,
          contractId: payment.contractId,
          amountTiyin: payment.amount,
          currency: payment.currency,
          title: payment.contract.serviceTitleSnapshot,
          extra,
        };
      }

      case 'REFUND': {
        const refund = await this.prisma.refund.findUnique({
          where: { id: aggregateId },
          include: { contract: true },
        });
        if (!refund) return null;
        return {
          buyerId: refund.contract.buyerId,
          sellerId: refund.contract.sellerId,
          contractId: refund.contractId,
          amountTiyin: refund.amount,
          currency: refund.currency,
          title: refund.contract.serviceTitleSnapshot,
          extra,
        };
      }

      case 'PAYOUT': {
        const payout = await this.prisma.payout.findUnique({ where: { id: aggregateId } });
        if (!payout) return null;
        return {
          sellerId: payout.sellerId,
          amountTiyin: payout.amount,
          currency: payout.currency,
          extra,
        };
      }

      // Bosqich 11, bo'lim 52 — staff admin amallari (USER_BLOCKED va sh.k.).
      case 'USER': {
        const user = await this.prisma.user.findUnique({ where: { id: aggregateId } });
        if (!user) return null;
        return { userId: user.id, extra };
      }

      case 'DISPUTE': {
        const dispute = await this.prisma.dispute.findUnique({
          where: { id: aggregateId },
          include: { contract: true },
        });
        if (!dispute) return null;
        return {
          buyerId: dispute.contract.buyerId,
          sellerId: dispute.contract.sellerId,
          contractId: dispute.contractId,
          amountTiyin: dispute.disputedAmount,
          currency: dispute.currency,
          title: dispute.contract.serviceTitleSnapshot,
          // `openedByUserId` — DISPUTE_OPENED marshrutida "qarshi tomonga
          // xabar ber" hisoblashi uchun (bo'lim 32 — ortiqcha murakkablik
          // kiritmasdan, mavjud maydonni `extra`ga qo'shib qo'yish yetarli).
          extra: { ...extra, openedByUserId: dispute.openedByUserId },
        };
      }

      default:
        return null;
    }
  }
}
