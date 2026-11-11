import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { JobsController } from './jobs.controller';
import { StaffJobController } from './staff-job.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, StaffAuthModule],
  controllers: [JobsController, StaffJobController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}

