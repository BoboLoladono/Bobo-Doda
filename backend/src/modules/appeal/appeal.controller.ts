import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AppealService } from './appeal.service';
import { CreateAppealDto } from './dto/create-appeal.dto';
import { AppealResponseDto, toAppealResponseDto } from './dto/appeal-response.dto';

@ApiTags('appeals')
@ApiBearerAuth()
@Controller('appeals')
export class AppealController {
  constructor(private readonly appeal: AppealService) {}

  @Post()
  @ApiOkResponse({ type: AppealResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateAppealDto,
  ): Promise<AppealResponseDto> {
    const res = await this.appeal.createAppeal(user.sub, dto);
    return toAppealResponseDto(res);
  }
}
