import { BadRequestException, NotFoundException } from '@nestjs/common';

const stripeMock = {
  checkout: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
  subscriptions: { update: jest.fn() },
  refunds: { create: jest.fn() },
};
jest.mock('stripe', () => jest.fn().mockImplementation(() => stripeMock));

jest.mock('./ecpay.util', () => ({
  buildEcpayCheckMacValue: jest.fn().mockReturnValue('MOCKED_MAC'),
  verifyEcpayCheckMacValue: jest.fn().mockReturnValue(true),
  terminateEcpayPeriodic: jest.fn().mockResolvedValue(true),
  refundEcpayCredit: jest.fn().mockResolvedValue(true),
}));

import { PaymentsService } from './payments.service';
import * as ecpayUtil from './ecpay.util';

function makePrismaMock(overrides: Record<string, any> = {}) {
  return {
    order: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    membershipTier: { findUnique: jest.fn() },
    extraHourPricing: { findFirst: jest.fn() },
    userSubscription: { updateMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    minuteLedger: { create: jest.fn() },
    ...overrides,
  } as any;
}

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV_BACKUP, API_PUBLIC_URL: 'https://api.example.com' };
});

describe('PaymentsService', () => {
  describe('createOrder', () => {
    it('加購時數的訂單金額 = 單價 x 小時數', async () => {
      const prisma = makePrismaMock();
      prisma.extraHourPricing.findFirst.mockResolvedValue({ price: 39 });
      prisma.order.create.mockResolvedValue({ id: 'order1' });
      prisma.order.update.mockResolvedValue({});

      const service = new PaymentsService(prisma);
      const result = await service.createOrder('user1', { type: 'extra_hours', hours: 10, gateway: 'ecpay' });

      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 390 }) }),
      );
      expect(result.type).toBe('ecpay_form');
    });

    it('訂閱訂單走綠界時應該帶上定期定額參數', async () => {
      const prisma = makePrismaMock();
      prisma.membershipTier.findUnique.mockResolvedValue({ id: 'tier1', level: 2, monthlyPrice: 499 });
      prisma.order.create.mockResolvedValue({ id: 'order1' });
      prisma.order.update.mockResolvedValue({});

      const service = new PaymentsService(prisma);
      const result: any = await service.createOrder('user1', {
        type: 'subscription',
        tierId: 'tier1',
        gateway: 'ecpay',
      });

      expect(result.params.PeriodType).toBe('M');
      expect(result.params.ExecTimes).toBe(999);
    });

    it('訂閱訂單走 Stripe 時應該用 subscription 模式', async () => {
      const prisma = makePrismaMock();
      prisma.membershipTier.findUnique.mockResolvedValue({ id: 'tier1', level: 2, monthlyPrice: 499 });
      prisma.order.create.mockResolvedValue({ id: 'order1' });
      stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://stripe.example/checkout' });

      const service = new PaymentsService(prisma);
      await service.createOrder('user1', { type: 'subscription', tierId: 'tier1', gateway: 'stripe' });

      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'subscription' }),
      );
    });
  });

  describe('handleEcpayWebhook', () => {
    it('MerchantTradeNo 找不到對應訂單時應該回 404', async () => {
      const prisma = makePrismaMock();
      prisma.order.findFirst.mockResolvedValue(null);
      const service = new PaymentsService(prisma);
      await expect(service.handleEcpayWebhook({ MerchantTradeNo: 'X', RtnCode: '1' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('首次付款成功應該發放加購時數，且保留 MerchantTradeNo 供之後查單', async () => {
      const prisma = makePrismaMock();
      prisma.order.findFirst.mockResolvedValue({
        id: 'order1',
        status: 'pending',
        type: 'extra_hours',
        gateway: 'ecpay',
        userId: 'user1',
        gatewayTxnId: 'ORDabc',
        metadata: { hours: 10 },
      });
      prisma.order.findUnique.mockResolvedValue({
        id: 'order1',
        status: 'pending',
        type: 'extra_hours',
        gateway: 'ecpay',
        userId: 'user1',
        gatewayTxnId: 'ORDabc',
        metadata: { hours: 10 },
      });
      prisma.order.update.mockResolvedValue({});

      const service = new PaymentsService(prisma);
      await service.handleEcpayWebhook({ MerchantTradeNo: 'ORDabc', RtnCode: '1', TradeNo: 'TN123' });

      // gatewayTxnId 不應該被覆蓋成 TradeNo（否則之後續扣通知就查不到單了）
      const updateCall = prisma.order.update.mock.calls[0][0];
      expect(updateCall.data.gatewayTxnId).toBeUndefined();
      expect(updateCall.data.metadata.ecpayTradeNo).toBe('TN123');
      expect(prisma.minuteLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ minutes: 600, source: 'purchase' }) }),
      );
    });

    it('已付款訂閱訂單再次收到成功通知應視為週期續扣', async () => {
      const prisma = makePrismaMock();
      const paidOrder = {
        id: 'order1',
        status: 'paid',
        type: 'subscription',
        gateway: 'ecpay',
        userId: 'user1',
        gatewayTxnId: 'ORDabc',
        metadata: { tierId: 'tier1' },
      };
      prisma.order.findFirst.mockResolvedValue(paidOrder);
      prisma.membershipTier.findUnique.mockResolvedValue({ id: 'tier1', monthlyMinutes: 7200 });
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub1',
        currentPeriodEnd: new Date('2026-01-01'),
      });
      prisma.userSubscription.update.mockResolvedValue({});

      const service = new PaymentsService(prisma);
      await service.handleEcpayWebhook({ MerchantTradeNo: 'ORDabc', RtnCode: '1', TradeNo: 'TN456' });

      expect(prisma.userSubscription.update).toHaveBeenCalled();
      expect(prisma.minuteLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ minutes: 7200, source: 'monthly_grant' }) }),
      );
    });
  });

  describe('cancelSubscription', () => {
    it('沒有進行中的訂閱時應該回 404', async () => {
      const prisma = makePrismaMock();
      prisma.userSubscription.findFirst.mockResolvedValue(null);
      const service = new PaymentsService(prisma);
      await expect(service.cancelSubscription('user1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('Stripe 訂閱取消時呼叫 subscriptions.update 並關閉 autoRenew', async () => {
      const prisma = makePrismaMock();
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub1',
        gatewaySubscriptionId: 'sub_stripe_1',
        ecpayMerchantTradeNo: null,
      });
      prisma.userSubscription.update.mockResolvedValue({ autoRenew: false });

      const service = new PaymentsService(prisma);
      await service.cancelSubscription('user1');

      expect(stripeMock.subscriptions.update).toHaveBeenCalledWith('sub_stripe_1', { cancel_at_period_end: true });
      expect(prisma.userSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { autoRenew: false } }),
      );
    });

    it('綠界訂閱取消時呼叫終止定期定額 API', async () => {
      const prisma = makePrismaMock();
      prisma.userSubscription.findFirst.mockResolvedValue({
        id: 'sub1',
        gatewaySubscriptionId: null,
        ecpayMerchantTradeNo: 'ORDabc',
      });
      prisma.userSubscription.update.mockResolvedValue({ autoRenew: false });

      const service = new PaymentsService(prisma);
      await service.cancelSubscription('user1');

      expect(ecpayUtil.terminateEcpayPeriodic).toHaveBeenCalledWith('ORDabc');
    });
  });

  describe('refundOrder', () => {
    it('未付款的訂單不能退款', async () => {
      const prisma = makePrismaMock();
      prisma.order.findUnique.mockResolvedValue({ id: 'order1', status: 'pending' });
      const service = new PaymentsService(prisma);
      await expect(service.refundOrder('order1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('Stripe 訂單退款會呼叫 refunds.create 並收回加購時數', async () => {
      const prisma = makePrismaMock();
      prisma.order.findUnique.mockResolvedValue({
        id: 'order1',
        status: 'paid',
        type: 'extra_hours',
        gateway: 'stripe',
        gatewayTxnId: 'pi_123',
        userId: 'user1',
        amount: 390,
        metadata: { hours: 10 },
      });
      prisma.order.update.mockResolvedValue({});

      const service = new PaymentsService(prisma);
      await service.refundOrder('order1');

      expect(stripeMock.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_123' });
      expect(prisma.minuteLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ minutes: -600 }) }),
      );
    });

    it('訂閱退款會把訂閱標記為 canceled', async () => {
      const prisma = makePrismaMock();
      prisma.order.findUnique.mockResolvedValue({
        id: 'order1',
        status: 'paid',
        type: 'subscription',
        gateway: 'stripe',
        gatewayTxnId: 'pi_123',
        userId: 'user1',
        amount: 499,
        metadata: { tierId: 'tier1' },
      });
      prisma.order.update.mockResolvedValue({});
      prisma.userSubscription.updateMany.mockResolvedValue({});

      const service = new PaymentsService(prisma);
      await service.refundOrder('order1');

      expect(prisma.userSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'canceled', autoRenew: false } }),
      );
    });
  });
});
