import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { GuardsModule } from '@/common/guards/guards.module';
import { AppConfigService } from '@/config/app-config.service';
import { PAYOUT_PROVIDER } from './providers/payout-provider.interface';
import { TestPayoutProvider } from './providers/test/test-payout.provider';
import { DisabledPayoutProvider } from './providers/disabled/disabled-payout.provider';
import { PaymePayoutProvider } from './providers/payme/payme-payout.provider';
import { PayoutService } from './payout.service';
import { SellerPayoutController } from './seller-payout.controller';
import { StaffPayoutController } from './staff-payout.controller';
import { PayoutWebhookController } from './payout-webhook.controller';

/** FAQAT dev/test — production'da hech qachon ishlatilmaydi (pastdagi fail-fast). */
const DEV_ONLY_TEST_SECRET = 'test-only-insecure-payout-secret-change-me';

/**
 * Bosqich 7 — payout domeni. `PaymentModule`'dan MUSTAQIL provider registry
 * (bo'lim 28): real hayotda payout rail'i to'lov gateway'idan butunlay
 * boshqa kompaniya bo'lishi mumkin, shuning uchun ALOHIDA `PAYOUT_PROVIDER`
 * token/factory/webhook route.
 */
@Module({
  imports: [AuthModule, StaffAuthModule, GuardsModule],
  controllers: [SellerPayoutController, StaffPayoutController, PayoutWebhookController],
  providers: [
    PayoutService,
    {
      provide: PAYOUT_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        // Bosqich 13, bo'lim 48 — real payout rail hali rasmiy tanlanmagan.
        // `PAYOUTS_ENABLED=false` bo'lsa `PAYOUT_PROVIDER`/`NODE_ENV`dan
        // qat'i nazar HAR DOIM shu (production'da HAM — bu ATAYLAB
        // production'ni payout'siz ishga tushirish yo'li, "soxta TEST
        // fallback" EMAS: alohida nomlangan, ochiq holat).
        if (!config.payoutsEnabled) {
          return new DisabledPayoutProvider();
        }
        const { provider, testWebhookSecret } = config.payout;
        if (provider === 'TEST') {
          if (config.isProduction) {
            throw new Error("PAYOUT_PROVIDER=TEST production'da ishlatib bo'lmaydi (fail closed)");
          }
          return new TestPayoutProvider(testWebhookSecret ?? DEV_ONLY_TEST_SECRET);
        }
        if (provider === 'PAYME') {
          const { endpoint, login, key, webhookSecret } = config.paymePayout;
          if (!endpoint || !login || !key) {
            throw new Error('PAYOUT_PROVIDER=PAYME uchun PAYME_PAYOUT_ENDPOINT, PAYME_PAYOUT_LOGIN, PAYME_PAYOUT_KEY majburiy');
          }
          return new PaymePayoutProvider({
            endpoint,
            login,
            key,
            webhookSecret,
          });
        }
        throw new Error(`PAYOUT_PROVIDER=${provider} qo'llab-quvvatlanmaydi`);
      },
    },
  ],
  // Bosqich 9 — `PAYOUT_PROVIDER` eksport qilinadi: `ReconciliationModule`
  // shu bitta provider instansiyasini `queryPayout()` uchun qayta ishlatadi
  // (`PaymentModule`ning `PAYMENT_PROVIDER` eksporti bilan bir xil naqsh).
  exports: [PayoutService, PAYOUT_PROVIDER],
})
export class PayoutModule {}
