import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { AppealService } from './appeal.service';
import { AppealController } from './appeal.controller';
import { StaffAppealController } from './staff-appeal.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, StaffAuthModule],
  controllers: [AppealController, StaffAppealController],
  providers: [AppealService],
  exports: [AppealService],
})
export class AppealModule {}
