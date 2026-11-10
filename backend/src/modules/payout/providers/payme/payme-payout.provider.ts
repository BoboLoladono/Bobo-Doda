import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DomainError } from '@/common/errors/domain-error';
import type {
  CreatePayoutParams,
  CreatePayoutResult,
  PayoutProvider,
  PayoutWebhookRequest,
  QueryPayoutResult,
  VerifiedPayoutWebhookEvent,
} from '../payout-provider.interface';

export interface PaymePayoutOptions {
  endpoint: string;
  login: string;
  key: string;
  webhookSecret?: string;
}

export class PaymePayoutProvider implements PayoutProvider {
  readonly name = 'PAYME';
  private readonly logger = new Logger(PaymePayoutProvider.name);

  constructor(private readonly options: PaymePayoutOptions) {}

  async createPayout(params: CreatePayoutParams): Promise<CreatePayoutResult> {
    const rawCard = params.destinationReference.replace(/[\s-]/g, '');
    const isUzcard = /^8600\d{12}$/.test(rawCard);
    const isHumo = /^9860\d{12}$/.test(rawCard);
    const isMaskedOrMock = /^(\d{4}[*]{6,8}\d{4})$/.test(rawCard) || rawCard.startsWith('TEST_');

    if (!isUzcard && !isHumo && !isMaskedOrMock) {
      throw new DomainError(
        'PAYOUT_PROVIDER_ERROR',
        'Noto‘g‘ri karta raqami. Faqat Uzcard (8600) va Humo (9860) kartalari qo‘llab-quvvatlanadi.',
      );
    }

    if (params.amountTiyin <= BigInt(0)) {
      throw new DomainError('PAYOUT_PROVIDER_ERROR', 'Yechib olinadigan summa musbat bo‘lishi shart');
    }

    // Dev/Sandbox bypass yoki to'liq RPC chaqiruvi
    const authHeader = `Basic ${Buffer.from(`${this.options.login}:${this.options.key}`).toString('base64')}`;

    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          method: 'receipts.p2c',
          params: {
            id: params.payoutId,
            amount: Number(params.amountTiyin),
            destination: rawCard,
            sellerId: params.sellerId,
          },
          id: params.payoutId,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.logger.error(`Payme Payout: Avtorizatsiya xatosi (HTTP ${response.status})`);
          throw new DomainError('PROVIDER_CONFIG_ERROR', 'Payme Payout avtorizatsiya xatosi');
        }
        if (response.status >= 500) {
          throw new DomainError('PAYOUT_PROVIDER_UNAVAILABLE', `Payme server xatosi: HTTP ${response.status}`);
        }
        const errJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const msg =
          typeof errJson?.message === 'string'
            ? errJson.message
            : typeof errJson?.error === 'string'
              ? errJson.error
              : 'Karta yoki to‘lov rad etildi';
        throw new DomainError('PAYOUT_PROVIDER_ERROR', `Payme rad etdi: ${msg}`);
      }

      const body = (await response.json()) as {
        result?: { receipt?: { _id: string; create_time: number } };
        error?: { code: number; message: string };
      };

      if (body.error) {
        this.logger.warn(`Payme Payout rad etildi: [${body.error.code}] ${body.error.message}`);
        throw new DomainError('PAYOUT_PROVIDER_ERROR', `Payme xatosi: ${body.error.message}`);
      }

      const providerPayoutId = body.result?.receipt?._id ?? `payme_${params.payoutId}`;
      const createTime = body.result?.receipt?.create_time
        ? new Date(body.result.receipt.create_time)
        : new Date();

      return {
        providerPayoutId,
        providerCreatedAt: createTime,
      };
    } catch (err) {
      if (err instanceof DomainError) throw err;
      this.logger.error({ err }, 'Payme Payout tarmoq ulanish xatosi');
      throw new DomainError('PAYOUT_PROVIDER_UNAVAILABLE', 'Payme Payout xizmati bilan aloqa o‘rnatilmadi');
    }
  }

  async queryPayout(providerPayoutId: string): Promise<QueryPayoutResult> {
    const authHeader = `Basic ${Buffer.from(`${this.options.login}:${this.options.key}`).toString('base64')}`;

    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({
          method: 'receipts.check',
          params: { id: providerPayoutId },
          id: providerPayoutId,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new DomainError('PROVIDER_CONFIG_ERROR', 'Payme Payout avtorizatsiya xatosi');
        }
        throw new DomainError('PAYOUT_PROVIDER_UNAVAILABLE', `Payme query HTTP ${response.status}`);
      }

      const body = (await response.json()) as {
        result?: { state?: number };
        error?: { code: number; message: string };
      };

      if (body.error) {
        if (body.error.code === -31003 || body.error.code === -31050) {
          return { state: 'NOT_FOUND', providerReference: null };
        }
        return { state: 'UNKNOWN', providerReference: providerPayoutId };
      }

      const state = body.result?.state;
      // Payme receipt state: 4 = SUCCEEDED, -1 / -2 = FAILED, 1 / 2 = PENDING
      if (state === 4) {
        return { state: 'SUCCEEDED', providerReference: providerPayoutId };
      }
      if (state === -1 || state === -2) {
        return { state: 'FAILED', providerReference: providerPayoutId };
      }
      if (state === 1 || state === 2) {
        return { state: 'PENDING', providerReference: providerPayoutId };
      }

      return { state: 'UNKNOWN', providerReference: providerPayoutId };
    } catch (err) {
      if (err instanceof DomainError) throw err;
      return { state: 'UNKNOWN', providerReference: providerPayoutId };
    }
  }

  verifyWebhook(req: PayoutWebhookRequest): VerifiedPayoutWebhookEvent {
    // 1. Basic auth yoki imzo tekshiruvi
    const authHeader = req.headers['authorization'];
    const authVal = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    const signatureHeader = req.headers['x-payme-signature'] ?? req.headers['x-signature'];
    const sigVal = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    let authenticated = false;

    if (authVal && authVal.startsWith('Basic ')) {
      const expected = Buffer.from(`${this.options.login}:${this.options.key}`).toString('base64');
      const provided = authVal.replace(/^Basic\s+/, '');
      if (provided === expected) {
        authenticated = true;
      }
    }

    if (!authenticated && sigVal && this.options.webhookSecret) {
      authenticated = this.verifyHmac(req.rawBody, sigVal, this.options.webhookSecret);
    }

    if (!authenticated) {
      this.logger.warn('Payme Payout webhook avtorizatsiyadan o‘tmadi');
      throw new DomainError('PAYOUT_WEBHOOK_INVALID', 'Payme payout webhook avtorizatsiyasi xato');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(req.rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new DomainError('PAYOUT_WEBHOOK_INVALID', 'Yaroqsiz JSON formati');
    }

    const eventId =
      typeof body.eventId === 'string'
        ? body.eventId
        : typeof body.id === 'string'
          ? body.id
          : '';
    const providerPayoutId =
      typeof body.providerPayoutId === 'string'
        ? body.providerPayoutId
        : typeof body.receipt_id === 'string'
          ? body.receipt_id
          : typeof body.id === 'string'
            ? body.id
            : '';
    const statusVal =
      typeof body.status === 'string'
        ? body.status
        : typeof body.state === 'string'
          ? body.state
          : '';
    const statusRaw = statusVal.toUpperCase();
    const isSuccess = statusRaw === 'SUCCEEDED' || statusRaw === 'PAID' || statusRaw === '4';
    const isFailed = statusRaw === 'FAILED' || statusRaw === 'CANCELLED' || statusRaw === '-1' || statusRaw === '-2';

    if (!isSuccess && !isFailed) {
      throw new DomainError('PAYOUT_WEBHOOK_INVALID', `Noma’lum status: ${statusRaw}`);
    }

    const amountNum =
      typeof body.amountTiyin === 'number'
        ? body.amountTiyin
        : typeof body.amount === 'number'
          ? body.amount
          : 0;
    const currency = typeof body.currency === 'string' ? body.currency : 'UZS';

    return {
      providerEventId: eventId || `evt_${Date.now()}`,
      providerPayoutId,
      eventType: isSuccess ? 'PAYOUT.SUCCEEDED' : 'PAYOUT.FAILED',
      status: isSuccess ? 'SUCCEEDED' : 'FAILED',
      amountTiyin: BigInt(amountNum),
      currency,
    };
  }

  private verifyHmac(rawBody: Buffer, signatureHex: string, secret: string): boolean {
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      const providedBuf = Buffer.from(signatureHex, 'hex');
      const computedBuf = Buffer.from(computed, 'hex');
      return providedBuf.length === computedBuf.length && timingSafeEqual(providedBuf, computedBuf);
    } catch {
      return false;
    }
  }
}
