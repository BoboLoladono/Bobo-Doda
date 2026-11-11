import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { ReportService } from './report.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto, toReportResponseDto } from './dto/report-response.dto';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(AccountStatusGuard)
export class ReportController {
  constructor(private readonly report: ReportService) {}

  @Post()
  @ApiOkResponse({ type: ReportResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateReportDto,
  ): Promise<ReportResponseDto> {
    const report = await this.report.createReport(user.sub, dto);
    return toReportResponseDto(report);
  }
}
