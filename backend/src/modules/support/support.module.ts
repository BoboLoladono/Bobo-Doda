import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { TokenModule } from '@/modules/auth/token.module';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { StaffSupportController } from './staff-support.controller';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, StaffAuthModule, TokenModule],
  controllers: [SupportController, StaffSupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
