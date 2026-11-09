import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PaymentService } from '../../payment.service';
import { CLICK_ERROR, CLICK_ACTION } from './click.constants';
import { verifyClickSign } from './click-sign.util';
import type { ClickRequestDto, ClickResponseDto } from './click-rpc.types';

@Injectable()
export class ClickMerchantService {
  private readonly logger = new Logger(ClickMerchantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentService: PaymentService,
  ) {}

  async handleRequest(dto: ClickRequestDto, secretKey: string): Promise<ClickResponseDto> {
    const action = Number(dto.action);

    if (action === CLICK_ACTION.PREPARE) {
      return this.handlePrepare(dto, secretKey);
    }
    if (action === CLICK_ACTION.COMPLETE) {
      return this.handleComplete(dto, secretKey);
    }

    return {
      click_trans_id: dto.click_trans_id,
      merchant_trans_id: dto.merchant_trans_id,
      error: CLICK_ERROR.ACTION_NOT_FOUND,
      error_note: 'Action topilmadi',
    };
  }

  private async handlePrepare(dto: ClickRequestDto, secretKey: string): Promise<ClickResponseDto> {
    const validSign = verifyClickSign({
      clickTransId: dto.click_trans_id,
      serviceId: dto.service_id,
      secretKey,
      merchantTransId: dto.merchant_trans_id,
      amount: dto.amount,
      action: CLICK_ACTION.PREPARE,
      signTime: dto.sign_time,
      signString: dto.sign_string,
    });

    if (!validSign) {
      this.logger.warn(`Click Prepare: Imzo xato (payment: ${dto.merchant_trans_id})`);
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.SIGN_CHECK_FAILED,
        error_note: 'Sign check failed',
      };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.merchant_trans_id },
    });

    if (!payment) {
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.USER_DOES_NOT_EXIST,
        error_note: 'To‘lov topilmadi',
      };
    }

    if (payment.status === 'SUCCEEDED') {
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.ALREADY_PAID,
        error_note: 'Allaqachon to‘langan',
      };
    }

    if (payment.status === 'CANCELLED') {
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.TRANSACTION_CANCELLED,
        error_note: 'To‘lov bekor qilingan',
      };
    }

    // Amount tekshiruvi: 1 UZS = 100 tiyin
    const expectedUzs = Number(payment.amount) / 100;
    const incomingUzs = Number(dto.amount);
    if (Math.abs(expectedUzs - incomingUzs) > 0.01) {
      this.logger.warn(`Click Prepare: Summa nomuvofiq (kutilgan: ${expectedUzs}, kelgan: ${incomingUzs})`);
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.INCORRECT_AMOUNT,
        error_note: 'Incorrect amount',
      };
    }

    return {
      click_trans_id: dto.click_trans_id,
      merchant_trans_id: payment.id,
      merchant_prepare_id: payment.id,
      error: CLICK_ERROR.SUCCESS,
      error_note: 'Success',
    };
  }

  private async handleComplete(dto: ClickRequestDto, secretKey: string): Promise<ClickResponseDto> {
    const validSign = verifyClickSign({
      clickTransId: dto.click_trans_id,
      serviceId: dto.service_id,
      secretKey,
      merchantTransId: dto.merchant_trans_id,
      merchantPrepareId: dto.merchant_prepare_id,
      amount: dto.amount,
      action: CLICK_ACTION.COMPLETE,
      signTime: dto.sign_time,
      signString: dto.sign_string,
    });

    if (!validSign) {
      this.logger.warn(`Click Complete: Imzo xato (payment: ${dto.merchant_trans_id})`);
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.SIGN_CHECK_FAILED,
        error_note: 'Sign check failed',
      };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: dto.merchant_trans_id },
    });

    if (!payment) {
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: dto.merchant_trans_id,
        error: CLICK_ERROR.TRANSACTION_DOES_NOT_EXIST,
        error_note: 'Tranzaksiya topilmadi',
      };
    }

    // Click o'zi xatolik bildirsa
    if (Number(dto.error) < 0) {
      this.logger.warn(`Click Complete: Click tarafida xatolik (${dto.error})`);
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: payment.id,
        error: Number(dto.error),
        error_note: dto.error_note || 'Click xatosi',
      };
    }

    if (payment.status === 'SUCCEEDED') {
      return {
        click_trans_id: dto.click_trans_id,
        merchant_trans_id: payment.id,
        merchant_confirm_id: payment.id,
        error: CLICK_ERROR.SUCCESS,
        error_note: 'Success',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await this.paymentService.applyProviderRpcStatus(tx, payment, 'SUCCEEDED');
    });

    return {
      click_trans_id: dto.click_trans_id,
      merchant_trans_id: payment.id,
      merchant_confirm_id: payment.id,
      error: CLICK_ERROR.SUCCESS,
      error_note: 'Success',
    };
  }
}
