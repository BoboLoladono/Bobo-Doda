import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { UploadsService } from './uploads.service';
import { UploadFileDto, UploadFileResponseDto } from './dto/upload-file.dto';

@ApiTags('uploads')
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @ApiBearerAuth()
  @Post('me/uploads')
  @HttpCode(200)
  @UseGuards(AccountStatusGuard)
  @ApiOkResponse({ type: UploadFileResponseDto })
  async upload(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UploadFileDto,
  ): Promise<UploadFileResponseDto> {
    return this.uploads.saveUploadedFile(dto, user.sub);
  }

  /**
   * Shaxsiy fayllar (bank cheklari va topshirilgan ish natijalari) uchun
   * autentifikatsiya va alohida ruxsat nazorati (`Authorization: Bearer ...` —
   * foydalanuvchi yoki tegishli staff). `@Public()` faqat global user JWT guard
   * staff tokenlarini rad etmasligi uchun qo‘yilgan; kirish har doim
   * `authenticateDownloadCaller` + `readAuthorizedFile` orqali tekshiriladi.
   */
  @Public()
  @ApiBearerAuth()
  @Get('uploads/:storedName')
  async download(
    @Param('storedName') storedName: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const caller = await this.uploads.authenticateDownloadCaller(authorization);
    const file = await this.uploads.readAuthorizedFile(storedName, caller);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Vary', 'Authorization');
    res.setHeader(
      'Content-Disposition',
      file.inline ? 'inline' : `attachment; filename="${storedName}"`,
    );
    res.send(file.buffer);
  }
}
