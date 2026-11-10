import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ConfigModule } from '@/config/config.module';
import { IdModule } from '@/common/id/id.module';
import { LoggerModule } from '@/infra/logger/logger.module';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { QueueModule } from '@/infra/queue/queue.module';
import { SecurityModule } from '@/common/security/security.module';
import { AuditModule } from '@/common/audit/audit.module';
import { IdempotencyModule } from '@/common/idempotency/idempotency.module';

import { AllExceptionsFilter } from '@/common/http/all-exceptions.filter';
import { LoggingInterceptor } from '@/common/http/logging.interceptor';
import { RequestIdMiddleware } from '@/common/http/request-id.middleware';

import { HealthModule } from '@/modules/health/health.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { TokenModule } from '@/modules/auth/token.module';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { MeModule } from '@/modules/me/me.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { CategoryModule } from '@/modules/category/category.module';
import { SellerApplicationModule } from '@/modules/seller-application/seller-application.module';
import { ServiceModule } from '@/modules/service/service.module';
import { StaffUserModule } from '@/modules/staff-user/staff-user.module';
import { ContractModule } from '@/modules/contract/contract.module';
import { PaymentModule } from '@/modules/payment/payment.module';
import { LedgerModule } from '@/modules/ledger/ledger.module';
import { RefundModule } from '@/modules/refund/refund.module';
import { PayoutModule } from '@/modules/payout/payout.module';
import { DisputeModule } from '@/modules/dispute/dispute.module';
import { ReconciliationModule } from '@/modules/reconciliation/reconciliation.module';
import { NotificationModule } from '@/modules/notification/notification.module';
import { StaffAdminModule } from '@/modules/staff-admin/staff-admin.module';
import { StaffAuditModule } from '@/modules/staff-audit/staff-audit.module';
import { JobsModule } from '@/modules/jobs/jobs.module';
import { KycModule } from '@/modules/kyc/kyc.module';
import { SupportModule } from '@/modules/support/support.module';
import { ReportModule } from '@/modules/report/report.module';
import { AppealModule } from '@/modules/appeal/appeal.module';
import { ReviewModule } from '@/modules/review/review.module';

/**
 * Ildiz modul. Domen modullari (`users`, `catalog`, `contracts`,
 * `ledger`, `disputes`, `admin` …) o'z bosqichlarida shu yerga qo'shiladi.
 *
 * `JwtAuthGuard` — GLOBAL (`APP_GUARD`): sukut bo'yicha HAR bir marshrut
 * autentifikatsiya talab qiladi ("fail closed"), ochiq marshrutlar
 * `@Public()` bilan aniq belgilanadi. Staff marshrutlari bu zanjirda YO'Q —
 * `StaffAuthModule` o'z alohida guard'larini controller darajasida qo'shadi.
 */
@Module({
  imports: [
    ConfigModule,
    IdModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    SecurityModule,
    AuditModule,
    IdempotencyModule,
    HealthModule,
    // `TokenModule` alohida ham import qilinadi: quyidagi `APP_GUARD`
    // (`JwtAuthGuard`) shu modul darajasida ro'yxatdan o'tadi, shuning
    // uchun `TokenService`ni O'ZI ORQALI ko'rishi kerak — `AuthModule`
    // orqali TRANZITIV emas (Nest DI moduli chegarasi: provayder faqat
    // o'z modulining bevosita import'laridan ko'radi).
    TokenModule,
    AuthModule,
    MeModule,
    StaffAuthModule,
    CategoryModule,
    SellerApplicationModule,
    ServiceModule,
    StaffUserModule,
    ContractModule,
    PaymentModule,
    LedgerModule,
    RefundModule,
    PayoutModule,
    DisputeModule,
    ReconciliationModule,
    NotificationModule,
    StaffAdminModule,
    StaffAuditModule,
    JobsModule,
    KycModule,
    SupportModule,
    ReportModule,
    AppealModule,
    ReviewModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
