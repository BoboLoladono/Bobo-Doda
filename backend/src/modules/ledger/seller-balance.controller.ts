import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import { RolesGuard } from '@/modules/auth/guards/roles.guard';
import { CurrentUser } from '@/modules/auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '@/modules/auth/types/token-payload';
import { SUPPORTED_PAYMENT_CURRENCIES } from '@/common/money/currency.constant';
import { LedgerService } from './ledger.service';
import { SellerBalanceResponseDto, toSellerBalanceResponseDto } from './dto/seller-balance-response.dto';

/**
 * Bo'lim 34 — seller FAQAT o'z `SELLER_PAYABLE` balansini ko'radi. v1 bitta
 * valyuta (`SUPPORTED_PAYMENT_CURRENCIES` — Bosqich 5'dan qayta ishlatilgan
 * YAGONA manba), ko'p valyuta ochilsa shu yerga ro'yxat qo'shiladi.
 */
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
    const balance = await this.ledger.getUserAccountBalance('SELLER_PAYABLE', user.sub, currency);
    return toSellerBalanceResponseDto(currency, balance);
  }
}
