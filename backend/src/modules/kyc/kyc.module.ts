import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { AppConfigService } from '@/config/app-config.service';
import { KycController } from './kyc.controller';
import { StaffKycController } from './staff-kyc.controller';
import { KycService, MALWARE_SCANNER, STORAGE_PROVIDER } from './kyc.service';
import { DisabledStorageProvider } from './storage/disabled-storage.provider';
import { LocalStorageProvider } from './storage/local-storage.provider';
import { S3StorageProvider } from './storage/s3-storage.provider';
import { MockMalwareScanner } from './scanner/mock-malware.scanner';
import { ClamAvScanner } from './scanner/clamav.scanner';

@Module({
  imports: [PrismaModule, IdModule, AuditModule, StaffAuthModule],
  controllers: [KycController, StaffKycController],
  providers: [
    KycService,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (config: AppConfigService) => {
        if (!config.kycSubmissionEnabled) {
          return new DisabledStorageProvider();
        }
        if (process.env.STORAGE_PROVIDER === 'S3' && process.env.KYC_S3_ACCESS_KEY) {
          return new S3StorageProvider();
        }
        return new LocalStorageProvider();
      },
      inject: [AppConfigService],
    },
    {
      provide: MALWARE_SCANNER,
      useFactory: (config: AppConfigService) => {
        if (!config.kycSubmissionEnabled) {
          return new MockMalwareScanner();
        }
        if (process.env.CLAMAV_ENABLED === 'true') {
          return new ClamAvScanner();
        }
        return new MockMalwareScanner();
      },
      inject: [AppConfigService],
    },
  ],
  exports: [KycService, STORAGE_PROVIDER, MALWARE_SCANNER],
})
export class KycModule {}
