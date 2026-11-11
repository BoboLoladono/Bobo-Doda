import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { StaffJwtAuthGuard } from '@/modules/staff-auth/guards/staff-jwt-auth.guard';
import { StaffPermissionGuard } from '@/modules/staff-auth/guards/staff-permission.guard';
import { RequirePermission } from '@/modules/staff-auth/decorators/require-permission.decorator';
import { CurrentStaff } from '@/modules/staff-auth/decorators/current-staff.decorator';
import type { StaffAccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AuditService } from '@/common/audit/audit.service';
import { ReviewService } from './review.service';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { ReviewResponseDto, toReviewResponseDto } from './dto/review-response.dto';
import type { Page } from '@/common/pagination/page-query.dto';

@Public()
@ApiBearerAuth()
@ApiTags('staff-reviews')
@Controller('staff/reviews')
@UseGuards(StaffJwtAuthGuard, StaffPermissionGuard)
@RequirePermission('REVIEWS')
export class StaffReviewController {
  constructor(
    private readonly review: ReviewService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(
    @Query() query: ListReviewsQueryDto,
  ): Promise<Page<ReviewResponseDto> & { facets: Record<string, number> }> {
    const res = await this.review.listForStaff(query);
    return {
      ...res,
      items: res.items.map(toReviewResponseDto),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: ReviewResponseDto })
  async get(@Param('id') id: string): Promise<ReviewResponseDto> {
    const review = await this.review.getByIdOrThrow(id);
    return toReviewResponseDto(review);
  }

  @Post(':id/hide')
  @HttpCode(200)
  @ApiOkResponse({ type: ReviewResponseDto })
  async hide(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ): Promise<ReviewResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.review.hideReviewAsStaff(id, reason || 'Noo‘rin deb topildi', actor);
    return toReviewResponseDto(updated);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOkResponse({ type: ReviewResponseDto })
  async delete(
    @CurrentStaff() staff: StaffAccessTokenPayload,
    @Param('id') id: string,
  ): Promise<ReviewResponseDto> {
    const actor = await this.audit.resolveStaffActor(staff.sub);
    const updated = await this.review.deleteReviewAsStaff(id, actor);
    return toReviewResponseDto(updated);
  }
}
