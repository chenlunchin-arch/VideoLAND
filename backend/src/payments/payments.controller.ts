import { Body, Controller, Headers, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { PaymentsService } from './payments.service';
import { CreateOrderDto } from './dto';
import { AuthGuard } from '../auth/auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // ---- 已登入使用者建立訂單（訂閱或加購時數）----
  @UseGuards(AuthGuard)
  @Post('orders')
  createOrder(@CurrentUser() user: { id: string }, @Body() dto: CreateOrderDto) {
    return this.payments.createOrder(user.id, dto);
  }

  // ---- 取消訂閱：關掉自動續扣，本期結束前仍可正常使用 ----
  @UseGuards(AuthGuard)
  @Post('subscription/cancel')
  cancelSubscription(@CurrentUser() user: { id: string }) {
    return this.payments.cancelSubscription(user.id);
  }

  // ---- 後台：對單筆訂單退款 ----
  @UseGuards(AuthGuard, AdminGuard)
  @Post('admin/orders/:id/refund')
  refundOrder(@Param('id') id: string) {
    return this.payments.refundOrder(id);
  }

  // ---- 綠界回調：表單格式（application/x-www-form-urlencoded），由 main.ts 的預設 body parser 處理即可 ----
  // 綠界/Stripe 是伺服器對伺服器回調，簽章本身就是驗證機制，跳過速率限制
  // 避免同一個出口 IP 短時間內大量回調時被誤擋，導致訂單無法完成。
  @SkipThrottle()
  @Post('ecpay/webhook')
  async ecpayWebhook(@Body() body: Record<string, string>, @Res() res: Response) {
    const result = await this.payments.handleEcpayWebhook(body);
    res.type('text/plain').send(result);
  }

  // ---- Stripe 回調：必須用原始 body 驗證簽章，見 main.ts 的 rawBody 設定 ----
  @SkipThrottle()
  @Post('stripe/webhook')
  async stripeWebhook(@Req() req: Request & { rawBody: Buffer }, @Headers('stripe-signature') signature: string) {
    return this.payments.handleStripeWebhook(req.rawBody, signature);
  }
}
