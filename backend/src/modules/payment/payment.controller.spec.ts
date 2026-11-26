import { PaymentController } from './payment.controller';
import type { PaymentService } from './payment.service';
import type { ManualBankPaymentService } from './manual-bank-payment.service';
import type { IdempotencyService } from '@/common/idempotency/idempotency.service';
import type { AuditService } from '@/common/audit/audit.service';
import type { AppConfigService } from '@/config/app-config.service';
import { DomainError } from '@/common/errors/domain-error';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';

describe('PaymentController — PAYMENTS_ENABLED gate', () => {
  const user = { sub: 'buyer-1' } as AccessTokenPayload;

  function build(paymentsEnabled: boolean) {
    const payments = { create: jest.fn() } as unknown as PaymentService;
    const manualBank = {} as unknown as ManualBankPaymentService;
    const idempotency = { run: jest.fn() } as unknown as IdempotencyService;
    const audit = { resolveUserActor: jest.fn() } as unknown as AuditService;
    const config = { paymentsEnabled } as AppConfigService;
    return { controller: new PaymentController(payments, manualBank, idempotency, audit, config), payments, idempotency };
  }

  it('PAYMENTS_ENABLED=false — FEATURE_DISABLED, payments.create/idempotency.run HECH QACHON chaqirilmaydi', async () => {
    const { controller, payments, idempotency } = build(false);
    await expect(controller.create(user, 'contract-1', 'idem-1')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    } satisfies Partial<DomainError>);
    expect(payments.create).not.toHaveBeenCalled();
    expect(idempotency.run).not.toHaveBeenCalled();
  });

  it('PAYMENTS_ENABLED=true — Idempotency-Key tekshiruviga o‘tadi (gate to‘smaydi)', async () => {
    const { controller } = build(true);
    await expect(controller.create(user, 'contract-1', undefined)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    } satisfies Partial<DomainError>);
  });
});
