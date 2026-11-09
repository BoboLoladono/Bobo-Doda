import { DomainError } from '@/common/errors/domain-error';
import type {
  CheckoutInitiationResult,
  CreatePaymentParams,
  CreateRefundParams,
  CreateRefundResult,
  PaymentProvider,
  QueryPaymentResult,
  QueryRefundResult,
  WebhookRequest,
  VerifiedProviderEvent,
} from '../payment-provider.interface';
import { buildClickCheckoutUrl } from './click-checkout-url.util';

export interface ClickProviderOptions {
  serviceId: string;
  merchantId: string;
  secretKey: string;
  checkoutUrl?: string;
  returnUrl?: string;
}

export class ClickProvider implements PaymentProvider {
  readonly name = 'CLICK';

  constructor(private readonly options: ClickProviderOptions) {}

  buildCheckoutUrl(params: CreatePaymentParams): CheckoutInitiationResult {
    // 1 UZS = 100 tiyin
    const amountUzs = Number(params.amountTiyin) / 100;
    const checkoutUrl = buildClickCheckoutUrl({
      checkoutUrl: this.options.checkoutUrl,
      serviceId: this.options.serviceId,
      merchantId: this.options.merchantId,
      paymentId: params.paymentId,
      amountUzs,
      returnUrl: this.options.returnUrl,
    });
    return { checkoutUrl };
  }

  async queryPayment(providerPaymentId: string): Promise<QueryPaymentResult> {
    return { state: 'UNKNOWN', providerReference: providerPaymentId };
  }

  async queryRefund(providerRefundId: string): Promise<QueryRefundResult> {
    return { state: 'UNKNOWN', providerReference: providerRefundId };
  }

  async refundPayment(_params: CreateRefundParams): Promise<CreateRefundResult> {
    throw new DomainError('PAYMENT_PROVIDER_ERROR', 'Click avtomatik refund (API) qo‘llab-quvvatlamaydi — merchant cabinet orqali bajariladi');
  }

  verifyWebhook(_req: WebhookRequest): VerifiedProviderEvent {
    throw new DomainError('PAYMENT_WEBHOOK_INVALID', 'Click oqimi /payments/click (Prepare/Complete) JSON-RPC controller orqali boshqariladi');
  }
}
