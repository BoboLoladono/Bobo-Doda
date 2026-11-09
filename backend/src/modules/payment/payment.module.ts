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
import { ClickProvider } from './providers/click/click.provider';
import { ClickMerchantService } from './providers/click/click-merchant.service';
import { ClickMerchantController } from './providers/click/click-merchant.controller';
import { CLICK_MERCHANT_CONFIG, type ClickMerchantConfig } from './providers/click/click-rpc.types';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { MePaymentController } from './me-payment.controller';
import { StaffPaymentController } from './staff-payment.controller';

/** FAQAT dev/test — production'da hech qachon ishlatilmaydi (pastdagi fail-fast). */
const DEV_ONLY_TEST_SECRET = 'test-only-insecure-secret-change-me';

/**
 * Bosqich 5 — payment domeni. Provider registry SHU YERDA, BITTA joyda
 * (bo'lim 6/7): real Payme/Click ulanganda faqat shu factory'ga yangi
 * `case` qo'shiladi — `PaymentService`/controller'lar TEGILMAYDI.
 *
 * `PaymentWebhookController` Bosqich 7'dan boshlab SHU modulda EMAS —
 * `RefundModule`da (bo'lim 4): bitta webhook route endi Payment VA Refund
 * hodisalarini ham qabul qiladi, uni shu ikki servisga bog'liq bo'lgan
 * modulga qo'yish `PaymentModule`↔`RefundModule` orasida circular import
 * yaratmaydi (`RefundModule` `PaymentModule`ni import qiladi, aksincha EMAS).
 */
@Module({
  imports: [AuthModule, StaffAuthModule, GuardsModule],
  controllers: [
    PaymentController,
    MePaymentController,
    StaffPaymentController,
    PaymeMerchantController,
    ClickMerchantController,
  ],
  providers: [
    PaymentService,
    PaymeMerchantService,
    ClickMerchantService,
    {
      // Bo'lim 32 — `PaymeMerchantController` shu orqali "Payme faolmi +
      // to'liq credential bormi"ni bir joydan biladi (`AppConfigService`ga
      // to'g'ridan-to'g'ri bog'lanmaydi — test'da osongina override qilinadi).
      provide: PAYME_MERCHANT_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): PaymeMerchantConfig | null => {
        // Bosqich 23 — `PAYMENTS_ENABLED=false` bo'lsa Payme JSON-RPC
        // endpoint ham "mavjud emas" ko'rsatishi kerak (butun to'lov
        // gateway'i o'chirilgan holatda).
        if (!config.paymentsEnabled) return null;
        if (config.payment.provider !== 'PAYME') return null;
        const { merchantId, login, key, checkoutUrl } = config.payme;
        if (!merchantId || !login || !key || !checkoutUrl) return null;
        return { merchantId, login, key, checkoutUrl };
      },
    },
    {
      provide: CLICK_MERCHANT_CONFIG,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): ClickMerchantConfig | null => {
        if (!config.paymentsEnabled) return null;
        if (config.payment.provider !== 'CLICK') return null;
        const { merchantId, serviceId, secretKey, checkoutUrl } = config.click;
        if (!merchantId || !serviceId || !secretKey) return null;
        return { merchantId, serviceId, secretKey, checkoutUrl };
      },
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        // Bosqich 23 — real Payme/Click credential hali tanlanmagan bo'lsa,
        // feature to'liq o'chiriladi (`PAYOUTS_ENABLED` bilan bir xil
        // falsafa) — `PAYMENT_PROVIDER`/`NODE_ENV`dan qat'i nazar.
        if (!config.paymentsEnabled) {
          return new DisabledPaymentProvider();
        }
        const { provider, testWebhookSecret } = config.payment;
        if (provider === 'TEST') {
          // Ikkinchi qatlam himoya (birinchisi — `env.schema.ts` Zod
          // `superRefine`, boot'dan OLDIN ishlaydi). F1/ADR-03 bilan bir
          // xil falsafa: kritik fail-closed tekshiruv bitta joyga ishonib
          // qolmaydi.
          if (config.isProduction) {
            throw new Error("PAYMENT_PROVIDER=TEST production'da ishlatib bo'lmaydi (fail closed)");
          }
          return new TestPaymentProvider(testWebhookSecret ?? DEV_ONLY_TEST_SECRET);
        }
        if (provider === 'PAYME') {
          // Bosqich 12 — rasmiy Payme Merchant API protokoli implement
          // qilindi (developer.help.paycom.uz). Ikkinchi qatlam himoya —
          // `env.schema.ts` Zod `superRefine` bu 4 maydonni ALLAQACHON
          // majburiy qilgan, lekin kritik fail-closed tekshiruv bitta
          // joyga ishonib qolmaydi (F1/ADR-03 bilan bir xil falsafa).
          const { merchantId, checkoutUrl } = config.payme;
          if (!merchantId || !checkoutUrl) {
            throw new Error('PAYMENT_PROVIDER=PAYME uchun PAYME_MERCHANT_ID/PAYME_CHECKOUT_URL majburiy');
          }
          return new PaymeProvider({ merchantId, checkoutUrl });
        }
        if (provider === 'CLICK') {
          const { merchantId, serviceId, secretKey, checkoutUrl } = config.click;
          if (!merchantId || !serviceId || !secretKey) {
            throw new Error('PAYMENT_PROVIDER=CLICK uchun CLICK_MERCHANT_ID/CLICK_SERVICE_ID/CLICK_SECRET_KEY majburiy');
          }
          return new ClickProvider({ merchantId, serviceId, secretKey, checkoutUrl });
        }
        const unsupported: string = provider;
        throw new Error(`PAYMENT_PROVIDER=${unsupported} qo'llab-quvvatlanmaydi`);
      },
    },
  ],
  // `PAYMENT_PROVIDER` export qilinadi — `RefundModule` shu bitta provider
  // instansiyasini (Refund HAM shu orqali provider'ga murojaat qiladi,
  // bo'lim 4/12) qayta ishlatadi, ikkinchi registry YARATMAYDI.
  exports: [PaymentService, PAYMENT_PROVIDER],
})
export class PaymentModule {}
