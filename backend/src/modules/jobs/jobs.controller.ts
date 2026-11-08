import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { SellerEligibilityGuard } from '@/common/guards/seller-eligibility.guard';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { AccountStatusGuard } from '@/common/guards/account-status.guard';
import { Page } from '@/common/pagination/page-query.dto';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto';
import { JobResponseDto, toJobResponseDto } from './dto/job-response.dto';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Public()
  @Get()
  async list(@Query() query: ListJobsQueryDto): Promise<Page<JobResponseDto>> {
    const page = await this.jobs.listPublic(query);
    return { ...page, items: page.items.map(toJobResponseDto) };
  }

  @ApiBearerAuth()
  @Roles(Role.BUYER)
  @UseGuards(RolesGuard)
  @Get('mine')
  @UseGuards(AccountStatusGuard)
  async listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<Page<JobResponseDto>> {
    const p = page ? Number(page) : 1;
    const pp = perPage ? Number(perPage) : 50;
    const res = await this.jobs.listMine(user.sub, p, pp);
    return { ...res, items: res.items.map(toJobResponseDto) };
  }

  @ApiBearerAuth()
  @Roles(Role.SELLER)
  @UseGuards(RolesGuard)
  @Get('proposals/mine')
  @UseGuards(AccountStatusGuard)
  async listMyProposals(@CurrentUser() user: AccessTokenPayload) {
    return this.jobs.listMyProposals(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AccountStatusGuard)
  @Get('proposals/:proposalId')
  async getProposal(@CurrentUser() user: AccessTokenPayload, @Param('proposalId') proposalId: string) {
    return this.jobs.getProposal(proposalId, user.sub);
  }

  @ApiBearerAuth()
  @Roles(Role.SELLER)
  @UseGuards(RolesGuard)
  @Post('proposals/:proposalId/withdraw')
  @HttpCode(200)
  @UseGuards(AccountStatusGuard)
  async withdrawProposal(
    @CurrentUser() user: AccessTokenPayload,
    @Param('proposalId') proposalId: string,
  ) {
    return this.jobs.withdrawProposal(proposalId, user.sub);
  }

  @ApiBearerAuth()
  @Roles(Role.BUYER)
  @UseGuards(RolesGuard)
  @Post('proposals/:proposalId/hire')
  @HttpCode(200)
  @UseGuards(AccountStatusGuard)
  async hireProposal(@CurrentUser() user: AccessTokenPayload, @Param('proposalId') proposalId: string) {
    return this.jobs.hireProposal(proposalId, user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AccountStatusGuard)
  @Roles(Role.BUYER)
  @UseGuards(RolesGuard)
  @Get(':id/proposals')
  async listProposals(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.jobs.listProposalsForJob(id, user.sub);
  }

  @ApiBearerAuth()
  @Roles(Role.SELLER)
  @UseGuards(RolesGuard, SellerEligibilityGuard)
  @Post(':id/proposals')
  @HttpCode(200)
  @UseGuards(AccountStatusGuard)
  async createProposal(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateProposalDto,
  ) {
    return this.jobs.createProposal(id, user.sub, dto);
  }

  @Public()
  @Get(':id')
  @ApiOkResponse({ type: JobResponseDto })
  async get(@Param('id') id: string): Promise<JobResponseDto> {
    const job = await this.jobs.getByIdOrThrow(id);
    return toJobResponseDto(job);
  }

  @ApiBearerAuth()
  @Roles(Role.BUYER)
  @UseGuards(RolesGuard)
  @Post()
  @HttpCode(200)
  @UseGuards(AccountStatusGuard)
  @ApiOkResponse({ type: JobResponseDto })
  async create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateJobDto,
  ): Promise<JobResponseDto> {
    const job = await this.jobs.create(user.sub, dto);
    return toJobResponseDto(job);
  }

  @ApiBearerAuth()
  @Roles(Role.BUYER)
  @UseGuards(RolesGuard)
  @Patch(':id/close')
  @UseGuards(AccountStatusGuard)
  @ApiOkResponse({ type: JobResponseDto })
  async close(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<JobResponseDto> {
    const job = await this.jobs.close(id, user.sub);
    return toJobResponseDto(job);
  }

  @ApiBearerAuth()
  @Roles(Role.BUYER)
  @UseGuards(RolesGuard)
  @Post(':id/close')
  @HttpCode(200)
  @UseGuards(AccountStatusGuard)
  @ApiOkResponse({ type: JobResponseDto })
  async closePost(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<JobResponseDto> {
    const job = await this.jobs.close(id, user.sub);
    return toJobResponseDto(job);
  }
}
