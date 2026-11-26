import { Module } from '@nestjs/common';
import { TokenModule } from '@/modules/auth/token.module';
import { GuardsModule } from '@/common/guards/guards.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [TokenModule, GuardsModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
