import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { ManualBankPaymentService } from './manual-bank-payment.service';
import { CompanyBankDetailsResponseDto } from './dto/bank-proof.dto';

@ApiTags('payments')
@Controller('payments')
export class BankDetailsController {
  constructor(private readonly manualBank: ManualBankPaymentService) {}

  @Public()
  @Get('bank-details')
  @ApiOkResponse({ type: CompanyBankDetailsResponseDto })
  getCompanyBankDetails(): CompanyBankDetailsResponseDto {
    return this.manualBank.getCompanyBankDetails();
  }
}
