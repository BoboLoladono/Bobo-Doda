import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '@/common/audit/audit.service';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { StaffKycQueueQueryDto } from './dto/staff-kyc-queue-query.dto';
import { StaffKycReviewDto } from './dto/staff-kyc-review.dto';
import { KycService } from './kyc.service';

@Public()
@ApiBearerAuth()
@ApiTags('staff-kyc')
@Controller('staff/kyc')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('KYC')
export class StaffKycController {
  constructor(
    private readonly kycService: KycService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Verifikatsiya arizalari navbati (filtr va qidiruv bilan)' })
  async listQueue(@Query() query: StaffKycQueueQueryDto) {
    return this.kycService.listQueue(query);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Foydalanuvchi ID bo‘yicha verifikatsiya ma’lumotlari' })
  async getByUserId(@Param('userId') userId: string) {
    return this.kycService.getVerificationDetails(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ariza ID bo‘yicha to‘liq verifikatsiya ma’lumotlari va hujjat havolalari' })
  async getDetails(@Param('id') id: string) {
    return this.kycService.getVerificationDetails(id);
  }

  @Get(':id/documents/:documentId/view-url')
  @ApiOperation({ summary: 'Hujjatni ko‘rish uchun qisqa umrli (5 daqiqalik) imzolangan havola' })
  async getDocumentViewUrl(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.kycService.getStaffDocumentSignedUrl(staff.sub, id, documentId);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verifikatsiya arizasini ko‘rib chiqish (tasdiqlash, rad etish yoki qayta so‘rash)' })
  async review(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: StaffKycReviewDto,
  ) {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    return this.kycService.review(staff.sub, id, dto, actor);
  }
}
