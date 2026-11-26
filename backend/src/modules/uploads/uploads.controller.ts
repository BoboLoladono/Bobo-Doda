import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '@/modules/auth/decorators/public.decorator';
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
  async upload(@Body() dto: UploadFileDto): Promise<UploadFileResponseDto> {
    return this.uploads.saveUploadedFile(dto);
  }

  @Public()
  @Get('uploads/:storedName')
  async download(@Param('storedName') storedName: string, @Res() res: Response): Promise<void> {
    const file = await this.uploads.readUploadedFile(storedName);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.buffer.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader(
      'Content-Disposition',
      file.inline ? 'inline' : `attachment; filename="${storedName}"`,
    );
    res.send(file.buffer);
  }
}
