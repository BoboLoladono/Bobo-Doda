import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { SUPPORTED_PAYMENT_CURRENCIES } from '@/common/money/currency.constant';
import { LedgerService } from './ledger.service';
import {
  SellerBalanceBreakdownResponseDto,
  SellerBalanceResponseDto,
} from './dto/seller-balance-response.dto';

@ApiBearerAuth()
@ApiTags('seller-balance')
@Controller('seller/balance')
@UseGuards(RolesGuard)
@Roles(Role.SELLER)
export class SellerBalanceController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @ApiOkResponse({ type: SellerBalanceResponseDto })
  async get(@CurrentUser() user: AccessTokenPayload): Promise<SellerBalanceResponseDto> {
    const currency = SUPPORTED_PAYMENT_CURRENCIES[0];
    const breakdown = await this.ledger.getSellerBalanceBreakdown(user.sub, currency);
    return breakdown.summary;
  }

  @Get('breakdown')
  @ApiOkResponse({ type: SellerBalanceBreakdownResponseDto })
  async getBreakdown(@CurrentUser() user: AccessTokenPayload): Promise<SellerBalanceBreakdownResponseDto> {
    const currency = SUPPORTED_PAYMENT_CURRENCIES[0];
    return this.ledger.getSellerBalanceBreakdown(user.sub, currency);
  }
}
