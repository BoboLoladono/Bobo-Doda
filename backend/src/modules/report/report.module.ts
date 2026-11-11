import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { StaffReportController } from './staff-report.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, StaffAuthModule],
  controllers: [ReportController, StaffReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
