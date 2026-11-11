import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { GuardsModule } from '@/common/guards/guards.module';
import { AppConfigService } from '@/config/app-config.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider.interface';
import { TestPaymentProvider } from './providers/test/test-payment.provider';
import { DisabledPaymentProvider } from './providers/disabled/disabled-payment.provider';
import { PaymeProvider } from './providers/payme/payme.provider';
import { PaymeMerchantService } from './providers/payme/payme-merchant.service';
import { PaymeMerchantController } from './providers/payme/payme-merchant.controller';
import { PAYME_MERCHANT_CONFIG, type PaymeMerchantConfig } from './providers/payme/payme-rpc.types';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { MePaymentController } from './me-payment.controller';
import { StaffPaymentController } from './staff-payment.controller';

/** FAQAT dev/test — production'da hech qachon ishlatilmaydi (pastdagi fail-fast). */
const DEV_ONLY_TEST_SECRET = 'test-only-insecure-secret-change-me';

/**
 * Bosqich 5 — payment domeni. Provider registry SHU YERDA, BITTA joyda:
 * real Payme ulanganda faqat shu factory'ga yangi `case` qo'shiladi —
 * `PaymentService`/controller'lar TEGILMAYDI.
 *
 * Click provayderi bilan shartnoma mavjud emasligi sababli ushbu relizdan
 * to'liq chiqarilgan va uning o'rniga faqat Payme ishlatiladi.
 */
@Module({
  imports: [AuthModule, StaffAuthModule, GuardsModule],
  controllers: [
    PaymentController,
    MePaymentController,
    StaffPaymentController,
    PaymeMerchantController,
  ],
  providers: [
    PaymentService,
    PaymeMerchantService,
    {
      provide: PAYME_MERCHANT_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): PaymeMerchantConfig | null => {
        if (!config.paymentsEnabled) return null;
        if (config.payment.provider !== 'PAYME') return null;
        const { merchantId, login, key, checkoutUrl } = config.payme;
        if (!merchantId || !login || !key || !checkoutUrl) return null;
        return { merchantId, login, key, checkoutUrl };
      },
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        if (!config.paymentsEnabled) {
          return new DisabledPaymentProvider();
        }
        const { provider, testWebhookSecret } = config.payment;
        if (provider === 'TEST') {
          if (config.isProduction) {
            throw new Error("PAYMENT_PROVIDER=TEST production'da ishlatib bo'lmaydi (fail closed)");
          }
          return new TestPaymentProvider(testWebhookSecret ?? DEV_ONLY_TEST_SECRET);
        }
        if (provider === 'PAYME') {
          const { merchantId, checkoutUrl } = config.payme;
          if (!merchantId || !checkoutUrl) {
            throw new Error('PAYMENT_PROVIDER=PAYME uchun PAYME_MERCHANT_ID/PAYME_CHECKOUT_URL majburiy');
          }
          return new PaymeProvider({ merchantId, checkoutUrl });
        }
        if (provider === 'CLICK') {
          throw new Error("PAYMENT_PROVIDER=CLICK hozircha qo‘llab-quvvatlanmaydi: Click bilan shartnoma mavjud emas");
        }
        const unsupported: string = provider;
        throw new Error(`PAYMENT_PROVIDER=${unsupported} qo'llab-quvvatlanmaydi`);
      },
    },
  ],
  exports: [PaymentService, PAYMENT_PROVIDER],
})
export class PaymentModule {}
