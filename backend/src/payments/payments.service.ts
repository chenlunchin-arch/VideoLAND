import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma.service';
import { CreateOrderDto } from './dto';
import { buildEcpayCheckMacValue, verifyEcpayCheckMacValue, terminateEcpayPeriodic, refundEcpayCredit } from './ecpay.util';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2024-06-20',
});

const ECPAY_ACTION_URL =
  process.env.ECPAY_ACTION_URL || 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  // ---- 建立訂單，回傳前端要跳轉/送出的資訊 ----
  async createOrder(userId: string, dto: CreateOrderDto) {
    const { amount, metadata, description } = await this.resolveAmount(dto);

    const order = await this.prisma.order.create({
      data: {
        userId,
        type: dto.type,
        amount,
        currency: 'TWD',
        gateway: dto.gateway,
        status: 'pending',
        metadata,
      },
    });

    if (dto.gateway === 'ecpay') {
      return this.buildEcpayCheckout(order.id, amount, description, dto.type === 'subscription');
    }
    return this.buildStripeCheckout(order.id, amount, description, dto.type === 'subscription');
  }

  private async resolveAmount(dto: CreateOrderDto) {
    if (dto.type === 'subscription') {
      if (!dto.tierId) throw new BadRequestException('缺少 tierId');
      const tier = await this.prisma.membershipTier.findUnique({ where: { id: dto.tierId } });
      if (!tier) throw new NotFoundException('方案不存在');
      return {
        amount: tier.monthlyPrice,
        metadata: { tierId: tier.id, level: tier.level },
        description: `會員方案 第${tier.level}級`,
      };
    }
    if (!dto.hours) throw new BadRequestException('缺少 hours');
    const pricing = await this.prisma.extraHourPricing.findFirst({ orderBy: { updatedAt: 'desc' } });
    const unitPrice = pricing?.price ?? 0;
    return {
      amount: unitPrice * dto.hours,
      metadata: { hours: dto.hours },
      description: `加購時數 ${dto.hours} 小時`,
    };
  }

  // ---- 綠界：組出前端要用來自動送出的表單參數 ----
  // isSubscription 時加上「定期定額」參數：ECPay 之後每月會自動扣款並打同一個 ReturnURL 通知，
  // 不需要我們自己排程去請款。
  private async buildEcpayCheckout(orderId: string, amount: number, description: string, isSubscription: boolean) {
    const merchantTradeNo = `ORD${orderId.replace(/-/g, '').slice(0, 16)}`;
    // 先把交易編號存回訂單，webhook 進來時用這欄位查單，
    // 不要試圖從 merchantTradeNo 反推 orderId（截斷後不可逆）。
    await this.prisma.order.update({ where: { id: orderId }, data: { gatewayTxnId: merchantTradeNo } });

    const params: Record<string, string | number> = {
      MerchantID: process.env.ECPAY_MERCHANT_ID as string,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: formatEcpayDate(new Date()),
      PaymentType: 'aio',
      TotalAmount: amount,
      TradeDesc: encodeURIComponent(description),
      ItemName: description,
      ReturnURL: `${process.env.API_PUBLIC_URL}/payments/ecpay/webhook`,
      ChoosePayment: isSubscription ? 'Credit' : 'ALL', // 定期定額僅支援信用卡，一次性訂單則開放所有付款方式
      EncryptType: 1,
    };

    if (isSubscription) {
      params.PeriodAmount = amount;
      params.PeriodType = 'M'; // 每月
      params.Frequency = 1;
      params.ExecTimes = 999; // 綠界上限，等同「持續扣款直到取消」
      params.PeriodReturnURL = `${process.env.API_PUBLIC_URL}/payments/ecpay/webhook`;
    }

    params.CheckMacValue = buildEcpayCheckMacValue(params);
    return { type: 'ecpay_form' as const, action: ECPAY_ACTION_URL, params };
  }

  // ---- Stripe：訂閱走真正的 recurring price，讓 Stripe 自己處理每期扣款 ----
  private async buildStripeCheckout(orderId: string, amount: number, description: string, isSubscription: boolean) {
    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? 'subscription' : 'payment',
      line_items: [
        {
          price_data: {
            currency: 'twd',
            unit_amount: amount * 100, // Stripe 以最小貨幣單位計價
            product_data: { name: description },
            ...(isSubscription ? { recurring: { interval: 'month' as const } } : {}),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEB_PUBLIC_URL}/payment/success`,
      cancel_url: `${process.env.WEB_PUBLIC_URL}/payment/cancel`,
      metadata: { orderId },
    });
    return { type: 'redirect' as const, url: session.url };
  }

  // ---- 綠界 webhook：初次付款走 fulfillOrder，之後每期自動扣款的通知走 renewSubscription ----
  async handleEcpayWebhook(body: Record<string, string>) {
    if (!verifyEcpayCheckMacValue(body)) {
      throw new ForbiddenException('CheckMacValue 驗證失敗');
    }
    const order = await this.prisma.order.findFirst({ where: { gatewayTxnId: body.MerchantTradeNo } });
    if (!order) throw new NotFoundException('找不到對應訂單');

    if (body.RtnCode !== '1') {
      if (order.status === 'pending') {
        await this.prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } });
      }
      return '1|OK';
    }

    if (order.status !== 'paid') {
      await this.fulfillOrder(order.id, { ecpayTradeNo: body.TradeNo });
    } else if (order.type === 'subscription') {
      // 同一張訂單再次收到成功通知＝定期定額的下一期扣款成功
      await this.renewSubscription(order.userId, (order.metadata as any).tierId, order.id);
    }
    // 綠界要求回應純文字 1|OK 代表已收到通知
    return '1|OK';
  }

  // ---- Stripe webhook ----
  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        await this.fulfillOrder(orderId, {
          stripePaymentIntent: session.payment_intent as string,
          stripeSubscriptionId: session.subscription as string,
        });
      }
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      // subscription_create 這期已經由 checkout.session.completed 發放過了，
      // 只有 subscription_cycle（之後每期自動續訂）才要在這裡發放
      if (invoice.billing_reason === 'subscription_cycle' && invoice.subscription) {
        const sub = await this.prisma.userSubscription.findFirst({
          where: { gatewaySubscriptionId: invoice.subscription as string },
        });
        if (sub) await this.renewSubscription(sub.userId, sub.tierId);
      }
    }

    return { received: true };
  }

  // ---- 付款成功後真正發放權益：加購時數寫入帳本 / 訂閱寫入 UserSubscription ----
  // 注意：ECPay 的 order.gatewayTxnId 存的是 MerchantTradeNo，webhook 靠它查單，
  // 絕對不能在這裡被覆蓋掉，所以 ECPay 的實際交易編號（TradeNo）另外存在 metadata 裡。
  private async fulfillOrder(
    orderId: string,
    ref: { ecpayTradeNo?: string; stripePaymentIntent?: string; stripeSubscriptionId?: string } = {},
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'paid') return; // 避免 webhook 重送造成重複發放

    const existingMetadata = (order.metadata as any) ?? {};
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'paid',
        ...(ref.stripePaymentIntent ? { gatewayTxnId: ref.stripePaymentIntent } : {}),
        ...(ref.ecpayTradeNo ? { metadata: { ...existingMetadata, ecpayTradeNo: ref.ecpayTradeNo } } : {}),
      },
    });

    const metadata = existingMetadata;

    if (order.type === 'extra_hours') {
      await this.prisma.minuteLedger.create({
        data: {
          userId: order.userId,
          period: currentPeriod(),
          source: 'purchase',
          minutes: metadata.hours * 60,
          relatedOrderId: order.id,
        },
      });
      return;
    }

    // subscription：結束舊訂閱、開新的一期，並發放當期時數
    const tier = await this.prisma.membershipTier.findUnique({ where: { id: metadata.tierId } });
    if (!tier) return;

    await this.prisma.userSubscription.updateMany({
      where: { userId: order.userId, status: 'active' },
      data: { status: 'expired' },
    });

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await this.prisma.userSubscription.create({
      data: {
        userId: order.userId,
        tierId: tier.id,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        autoRenew: true,
        gatewaySubscriptionId: ref.stripeSubscriptionId,
        // ECPay 的 gatewayTxnId 沒被覆蓋掉，此時仍然是建立訂單時存入的 MerchantTradeNo
        ecpayMerchantTradeNo: order.gateway === 'ecpay' ? order.gatewayTxnId : null,
      },
    });

    await this.prisma.minuteLedger.create({
      data: {
        userId: order.userId,
        period: currentPeriod(),
        source: 'monthly_grant',
        minutes: tier.monthlyMinutes,
        relatedOrderId: order.id,
      },
    });
  }

  // ---- 續訂：金流那邊自動扣款成功後呼叫，只延長期間＋發放這期時數，不動訂單狀態 ----
  private async renewSubscription(userId: string, tierId: string, relatedOrderId?: string) {
    const tier = await this.prisma.membershipTier.findUnique({ where: { id: tierId } });
    const sub = await this.prisma.userSubscription.findFirst({ where: { userId, tierId, status: 'active' } });
    if (!tier || !sub) return;

    const periodEnd = new Date(sub.currentPeriodEnd);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await this.prisma.userSubscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: periodEnd },
    });

    await this.prisma.minuteLedger.create({
      data: {
        userId,
        period: currentPeriod(),
        source: 'monthly_grant',
        minutes: tier.monthlyMinutes,
        relatedOrderId,
      },
    });
  }

  // ---- 取消訂閱：關掉自動續扣，本期結束前仍可正常使用 ----
  async cancelSubscription(userId: string) {
    const sub = await this.prisma.userSubscription.findFirst({ where: { userId, status: 'active' } });
    if (!sub) throw new NotFoundException('目前沒有進行中的訂閱');

    if (sub.gatewaySubscriptionId) {
      // Stripe：設定 cancel_at_period_end，本期結束後才真正停止，不會立刻斷訂閱
      await stripe.subscriptions.update(sub.gatewaySubscriptionId, { cancel_at_period_end: true });
    } else if (sub.ecpayMerchantTradeNo) {
      const ok = await terminateEcpayPeriodic(sub.ecpayMerchantTradeNo);
      if (!ok) throw new BadRequestException('向綠界終止定期定額委託失敗，請稍後再試');
    }

    return this.prisma.userSubscription.update({
      where: { id: sub.id },
      data: { autoRenew: false },
    });
  }

  // ---- 退款：僅處理單筆訂單的金流退款 + 收回對應權益，不影響歷史已消耗的時數 ----
  async refundOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('訂單不存在');
    if (order.status !== 'paid') throw new BadRequestException('只有已付款的訂單可以退款');

    const metadata = (order.metadata as any) ?? {};

    if (order.gateway === 'stripe' && order.gatewayTxnId) {
      await stripe.refunds.create({ payment_intent: order.gatewayTxnId });
    } else if (order.gateway === 'ecpay' && metadata.ecpayTradeNo) {
      const ok = await refundEcpayCredit(metadata.ecpayTradeNo, order.amount);
      if (!ok) throw new BadRequestException('向綠界申請退款失敗，請稍後再試或至後台手動處理');
    }

    await this.prisma.order.update({ where: { id: orderId }, data: { status: 'refunded' } });

    if (order.type === 'extra_hours') {
      // 收回這筆加購的時數（如果已經看完，剩餘量最低就是 0，不會扣成負的體驗上很奇怪，
      // 但帳務上仍誠實記錄扣除，UI 顯示剩餘時數時本來就是取總和後夾在 0 以上）
      await this.prisma.minuteLedger.create({
        data: {
          userId: order.userId,
          period: currentPeriod(),
          source: 'purchase',
          minutes: -metadata.hours * 60,
          relatedOrderId: order.id,
        },
      });
    } else {
      await this.prisma.userSubscription.updateMany({
        where: { userId: order.userId, status: 'active' },
        data: { status: 'canceled', autoRenew: false },
      });
    }

    return { refunded: true };
  }
}

function formatEcpayDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
