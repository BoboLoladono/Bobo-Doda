import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@/modules/auth/decorators/public.decorator';
import { ClickMerchantService } from './click-merchant.service';
import { CLICK_ACTION, CLICK_ERROR } from './click.constants';
import {
  CLICK_MERCHANT_CONFIG,
  type ClickMerchantConfig,
  type ClickRequestDto,
  type ClickResponseDto,
} from './click-rpc.types';

@Public()
@ApiExcludeController()
@Controller('payments/click')
export class ClickMerchantController {
  private readonly logger = new Logger(ClickMerchantController.name);

  constructor(
    @Inject(CLICK_MERCHANT_CONFIG) private readonly clickConfig: ClickMerchantConfig | null,
    private readonly service: ClickMerchantService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleGeneral(@Body() body: Record<string, unknown>): Promise<ClickResponseDto> {
    return this.process(body);
  }

  @Post('prepare')
  @HttpCode(200)
  async handlePrepare(@Body() body: Record<string, unknown>): Promise<ClickResponseDto> {
    const enriched = { ...body, action: CLICK_ACTION.PREPARE };
    return this.process(enriched);
  }

  @Post('complete')
  @HttpCode(200)
  async handleComplete(@Body() body: Record<string, unknown>): Promise<ClickResponseDto> {
    const enriched = { ...body, action: CLICK_ACTION.COMPLETE };
    return this.process(enriched);
  }

  private async process(body: Record<string, unknown>): Promise<ClickResponseDto> {
    const clickTransId = typeof body.click_trans_id === 'number' || typeof body.click_trans_id === 'string' ? body.click_trans_id : '';
    const merchantTransId = typeof body.merchant_trans_id === 'string' ? body.merchant_trans_id : '';

    if (!this.clickConfig || !this.clickConfig.secretKey) {
      this.logger.warn('Click Merchant so‘rovi rad etildi: CLICK_MERCHANT_CONFIG sozlanmagan');
      return {
        click_trans_id: clickTransId,
        merchant_trans_id: merchantTransId,
        error: CLICK_ERROR.SIGN_CHECK_FAILED,
        error_note: 'Click shlyuzi faol emas yoki sozlanmagan',
      };
    }

    const dto = this.parseDto(body);
    if (!dto) {
      return {
        click_trans_id: clickTransId,
        merchant_trans_id: merchantTransId,
        error: CLICK_ERROR.ACTION_NOT_FOUND,
        error_note: 'Yaroqsiz so‘rov tanasi',
      };
    }

    this.logger.log(`[Click RPC] action=${dto.action} clickTransId=${dto.click_trans_id} payment=${dto.merchant_trans_id} amount=${dto.amount}`);
    try {
      const response: ClickResponseDto = await this.service.handleRequest(dto, this.clickConfig.secretKey);
      this.logger.log(`[Click RPC] Result: error=${response.error} note=${response.error_note}`);
      return response;
    } catch (err: unknown) {
      this.logger.error({ err }, '[Click RPC] Kutilmagan ichki xatolik');
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.ERROR_IN_REQUEST,
        error_note: 'Ichki server xatosi',
      };
    }
  }

  private parseDto(body: Record<string, unknown>): ClickRequestDto | null {
    if (!body || typeof body !== 'object') return null;

    const action = Number(body.action);
    if (isNaN(action)) return null;

    const clickTransId = typeof body.click_trans_id === 'number' || typeof body.click_trans_id === 'string' ? body.click_trans_id : '';
    const serviceId = typeof body.service_id === 'number' || typeof body.service_id === 'string' ? body.service_id : '';
    const merchantTransId = typeof body.merchant_trans_id === 'string' ? body.merchant_trans_id : '';
    const signTime = typeof body.sign_time === 'string' ? body.sign_time : '';
    const signString = typeof body.sign_string === 'string' ? body.sign_string : '';

    return {
      click_trans_id: clickTransId,
      service_id: serviceId,
      click_paydoc_id: typeof body.click_paydoc_id === 'number' || typeof body.click_paydoc_id === 'string' ? body.click_paydoc_id : undefined,
      merchant_trans_id: merchantTransId,
      amount: typeof body.amount === 'number' || typeof body.amount === 'string' ? body.amount : 0,
      action,
      error: typeof body.error === 'number' || typeof body.error === 'string' ? body.error : 0,
      error_note: typeof body.error_note === 'string' ? body.error_note : undefined,
      sign_time: signTime,
      sign_string: signString,
      merchant_prepare_id: typeof body.merchant_prepare_id === 'number' || typeof body.merchant_prepare_id === 'string' ? body.merchant_prepare_id : undefined,
    };
  }
}
