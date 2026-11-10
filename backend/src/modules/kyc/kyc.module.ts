import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infra/prisma/prisma.module';
import { IdModule } from '@/common/id/id.module';
import { AuditModule } from '@/common/audit/audit.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { KycController } from './kyc.controller';
import { StaffKycController } from './staff-kyc.controller';
import { KycService, MALWARE_SCANNER, STORAGE_PROVIDER } from './kyc.service';
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
      provide: LocalStorageProvider,
      useFactory: () => new LocalStorageProvider(),
    },
    S3StorageProvider,
    MockMalwareScanner,
    {
      provide: ClamAvScanner,
      useFactory: () => new ClamAvScanner(),
    },
    {
      provide: STORAGE_PROVIDER,
      useFactory: (local: LocalStorageProvider, s3: S3StorageProvider) => {
        if (process.env.STORAGE_PROVIDER === 'S3' && process.env.KYC_S3_ACCESS_KEY) {
          return s3;
        }
        return local;
      },
      inject: [LocalStorageProvider, S3StorageProvider],
    },
    {
      provide: MALWARE_SCANNER,
      useFactory: (mock: MockMalwareScanner, clamav: ClamAvScanner) => {
        if (process.env.CLAMAV_ENABLED === 'true') {
          return clamav;
        }
        return mock;
      },
      inject: [MockMalwareScanner, ClamAvScanner],
    },
  ],
  exports: [KycService, STORAGE_PROVIDER, MALWARE_SCANNER],
})
export class KycModule {}
