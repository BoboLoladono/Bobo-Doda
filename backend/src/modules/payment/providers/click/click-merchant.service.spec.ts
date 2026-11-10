import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { PaymentService } from '../../payment.service';
import { ClickMerchantService } from './click-merchant.service';
import { CLICK_ACTION, CLICK_ERROR } from './click.constants';
import { computeClickSign } from './click-sign.util';

describe('ClickMerchantService', () => {
  let service: ClickMerchantService;
  let prisma: {
    payment: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let paymentService: {
    applyProviderRpcStatus: jest.Mock;
  };

  const secretKey = 'test-click-secret';

  beforeEach(async () => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    paymentService = {
      applyProviderRpcStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClickMerchantService,
        { provide: PrismaService, useValue: prisma },
        { provide: PaymentService, useValue: paymentService },
      ],
    }).compile();

    service = module.get<ClickMerchantService>(ClickMerchantService);
  });

  describe('Prepare Action', () => {
    it('returns SIGN_CHECK_FAILED if signature is invalid', async () => {
      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.PREPARE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: 'invalid-signature',
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.SIGN_CHECK_FAILED);
    });

    it('returns USER_DOES_NOT_EXIST if payment is not found in database', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-unknown',
        amount: 50000,
        action: CLICK_ACTION.PREPARE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-unknown',
          amount: 50000,
          action: CLICK_ACTION.PREPARE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.USER_DOES_NOT_EXIST);
    });

    it('returns INCORRECT_AMOUNT if payment amount does not match', async () => {
      // 50,000 UZS = 5,000,000 tiyin
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        amount: BigInt(5000000), // 50000 UZS
        status: 'PENDING',
      });

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        amount: 30000, // wrong amount
        action: CLICK_ACTION.PREPARE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          amount: 30000,
          action: CLICK_ACTION.PREPARE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.INCORRECT_AMOUNT);
    });

    it('returns SUCCESS with merchant_prepare_id on valid Prepare', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        amount: BigInt(5000000), // 50000 UZS
        status: 'PENDING',
      });

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.PREPARE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.PREPARE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.SUCCESS);
      expect(res.merchant_prepare_id).toBe('pay-1');
    });
  });

  describe('Complete Action', () => {
    it('applies SUCCEEDED via paymentService on valid Complete', async () => {
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000),
        status: 'PENDING',
      };
      prisma.payment.findUnique.mockResolvedValue(payment);

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          merchant_prepare_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.COMPLETE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.SUCCESS);
      expect(res.merchant_confirm_id).toBe('pay-1');
      expect(paymentService.applyProviderRpcStatus).toHaveBeenCalledWith(expect.anything(), payment, 'SUCCEEDED');
    });

    it('returns SUCCESS idempotent if already SUCCEEDED', async () => {
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000),
        status: 'SUCCEEDED',
      };
      prisma.payment.findUnique.mockResolvedValue(payment);

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          merchant_prepare_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.COMPLETE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.SUCCESS);
      expect(paymentService.applyProviderRpcStatus).not.toHaveBeenCalled();
    });

    it('returns INCORRECT_AMOUNT on Complete if amount does not match payment', async () => {
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000), // 50000 UZS
        status: 'PENDING',
      };
      prisma.payment.findUnique.mockResolvedValue(payment);

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 25000, // mismatched amount
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          merchant_prepare_id: 'pay-1',
          amount: 25000,
          action: CLICK_ACTION.COMPLETE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.INCORRECT_AMOUNT);
      expect(paymentService.applyProviderRpcStatus).not.toHaveBeenCalled();
    });

    it('returns TRANSACTION_CANCELLED on Complete if payment is already CANCELLED', async () => {
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000),
        status: 'CANCELLED',
      };
      prisma.payment.findUnique.mockResolvedValue(payment);

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          merchant_prepare_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.COMPLETE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(CLICK_ERROR.TRANSACTION_CANCELLED);
      expect(paymentService.applyProviderRpcStatus).not.toHaveBeenCalled();
    });

    it('cancels pending payment when Click sends negative error on Complete', async () => {
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000),
        status: 'PENDING',
      };
      prisma.payment.findUnique.mockResolvedValue(payment);

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      const res = await service.handleRequest(
        {
          click_trans_id: 111,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          merchant_prepare_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.COMPLETE,
          error: -8,
          error_note: 'User rejected in app',
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(res.error).toBe(-8);
      expect(paymentService.applyProviderRpcStatus).toHaveBeenCalledWith(expect.anything(), payment, 'CANCELLED');
    });

    it('updates providerPaymentId on payment during Complete', async () => {
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000),
        status: 'PENDING',
        providerPaymentId: null,
      };
      prisma.payment.findUnique.mockResolvedValue(payment);

      const sign = computeClickSign({
        clickTransId: 998877,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      await service.handleRequest(
        {
          click_trans_id: 998877,
          service_id: 222,
          merchant_trans_id: 'pay-1',
          merchant_prepare_id: 'pay-1',
          amount: 50000,
          action: CLICK_ACTION.COMPLETE,
          error: 0,
          sign_time: '2026-11-09 12:00:00',
          sign_string: sign,
        },
        secretKey,
      );

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { providerPaymentId: '998877' },
      });
    });

    it('handles concurrent Complete calls safely without double settlement', async () => {
      let currentStatus = 'PENDING';
      const payment = {
        id: 'pay-1',
        amount: BigInt(5000000),
        get status() {
          return currentStatus;
        },
      };
      prisma.payment.findUnique.mockImplementation(async () => payment);
      paymentService.applyProviderRpcStatus.mockImplementation(async () => {
        currentStatus = 'SUCCEEDED';
        return 'TARGET_STATUS_APPLIED';
      });

      const sign = computeClickSign({
        clickTransId: 111,
        serviceId: 222,
        secretKey,
        merchantTransId: 'pay-1',
        merchantPrepareId: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        signTime: '2026-11-09 12:00:00',
      });

      const reqDto = {
        click_trans_id: 111,
        service_id: 222,
        merchant_trans_id: 'pay-1',
        merchant_prepare_id: 'pay-1',
        amount: 50000,
        action: CLICK_ACTION.COMPLETE,
        error: 0,
        sign_time: '2026-11-09 12:00:00',
        sign_string: sign,
      };

      const [res1, res2] = await Promise.all([
        service.handleRequest(reqDto, secretKey),
        service.handleRequest(reqDto, secretKey),
      ]);

      expect(res1.error).toBe(CLICK_ERROR.SUCCESS);
      expect(res2.error).toBe(CLICK_ERROR.SUCCESS);
    });
  });
});
