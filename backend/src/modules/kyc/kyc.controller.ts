import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { KycService } from './kyc.service';

@ApiTags('KYC')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @ApiBearerAuth()
  @UseGuards(AccountStatusGuard)
  @Get('me')
  @ApiOperation({ summary: 'Joriy foydalanuvchining KYC verifikatsiya holati' })
  async getMine(@CurrentUser() user: AccessTokenPayload) {
    return this.kycService.getMine(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AccountStatusGuard)
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'KYC hujjatlarini topshirish (verifikatsiyaga yuborish)' })
  async submit(@CurrentUser() user: AccessTokenPayload, @Body() dto: SubmitKycDto) {
    return this.kycService.submit(user.sub, dto, {
      id: user.sub,
      type: 'USER',
      name: user.sub,
    });
  }

  @Public()
  @Get('documents/stream')
  @ApiOperation({ summary: 'Qisqa umrli imzolangan token bilan hujjatni xavfsiz ko‘rish' })
  async streamDocument(@Query('token') token: string, @Res() res: Response) {
    const object = await this.kycService.streamDocumentWithToken(token);
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Content-Length', object.contentLength);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Content-Disposition', 'inline');
    res.send(object.buffer);
  }
}
