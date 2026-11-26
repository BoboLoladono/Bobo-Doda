import { Module } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { StaffAuthModule } from '@/modules/staff-auth/staff-auth.module';
import { GuardsModule } from '@/common/guards/guards.module';
import { UploadsModule } from '@/modules/uploads/uploads.module';
import { ContractController } from './contract.controller';
import { MeContractController } from './me-contract.controller';
import { SellerContractController } from './seller-contract.controller';
import { StaffContractController } from './staff-contract.controller';
import { ContractService } from './contract.service';

@Module({
  imports: [AuthModule, StaffAuthModule, GuardsModule, UploadsModule],
  controllers: [ContractController, MeContractController, SellerContractController, StaffContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
