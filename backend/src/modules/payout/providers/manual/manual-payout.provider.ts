import { Injectable } from '@nestjs/common';
import { DomainError } from '@/common/errors/domain-error';
import type {
  CreatePayoutParams,
  CreatePayoutResult,
  PayoutProvider,
  PayoutWebhookRequest,
  VerifiedPayoutWebhookEvent,
} from '../payout-provider.interface';

/**
 * Birinchi reliz — qo‘lda bank o‘tkazmasi provayderi (`PAYOUT_PROVIDER=MANUAL`).
 *
 * Hech qanday tashqi HTTP/Payme/Click adapterini CHAQRMAYDI — ariza yaratilgach
 * `Payout.status = PENDING` holatida turadi va balans `PAYOUT_CLEARING`da
 * band qilinadi; vakolatli admin bank o‘tkazmasini bajargach qayd etadi.
 */
@Injectable()
export class ManualPayoutProvider implements PayoutProvider {
  readonly name = 'MANUAL';

  async createPayout(params: CreatePayoutParams): Promise<CreatePayoutResult> {
    return {
      providerPayoutId: `manual-${params.payoutId}`,
      providerCreatedAt: new Date(),
    };
  }

  verifyWebhook(_req: PayoutWebhookRequest): VerifiedPayoutWebhookEvent {
    throw new DomainError(
      'PAYOUT_WEBHOOK_INVALID',
      'MANUAL payout provayderi tashqi webhook qabul qilmaydi',
    );
  }
}
