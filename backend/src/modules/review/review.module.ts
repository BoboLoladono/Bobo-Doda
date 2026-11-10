import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { StaffReviewController } from './staff-review.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, StaffAuthModule],
  controllers: [ReviewController, StaffReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
