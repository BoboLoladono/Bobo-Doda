import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { PageQueryDto, type Page } from '@/common/pagination/page-query.dto';
import { ReviewService } from './review.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewResponseDto, toReviewResponseDto } from './dto/review-response.dto';

@ApiTags('reviews')
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @ApiBearerAuth()
  @Post('contracts/:id/review')
  @UseGuards(AccountStatusGuard)
  @ApiOkResponse({ type: ReviewResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') contractId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const res = await this.review.createReview(user.sub, contractId, dto);
    return toReviewResponseDto(res);
  }

  @Public()
  @Get('sellers/:id/reviews')
  async listForSeller(
    @Param('id') sellerId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<ReviewResponseDto>> {
    const page = await this.review.listForSeller(sellerId, query.page ?? 1, query.perPage ?? 20);
    return { ...page, items: page.items.map(toReviewResponseDto) };
  }
}
