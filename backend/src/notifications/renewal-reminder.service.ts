import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { EmailService } from './email.service';

// 訂閱本身的續扣由金流那邊自動處理（見 payments.service.ts 的 renewSubscription），
// 這個排程只負責「到期前提醒」，跟實際扣款邏輯無關，就算沒跑也不影響續訂是否成功。
@Injectable()
export class RenewalReminderService {
  private readonly logger = new Logger(RenewalReminderService.name);

  constructor(private prisma: PrismaService, private email: EmailService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendUpcomingRenewalReminders() {
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const upcoming = await this.prisma.userSubscription.findMany({
      where: {
        status: 'active',
        autoRenew: true,
        currentPeriodEnd: { gte: now, lte: threeDaysLater },
      },
      include: { user: true, tier: true },
    });

    for (const sub of upcoming) {
      await this.email.send(
        sub.user.email,
        '您的會員方案即將續訂',
        `${sub.user.name} 您好，您的第${sub.tier.level}級方案將於 ${sub.currentPeriodEnd.toLocaleDateString('zh-TW')} 自動續訂並扣款 NT$${sub.tier.monthlyPrice}。如不需要續訂，請至會員中心取消自動續訂。`,
      );
    }

    this.logger.log(`已寄出 ${upcoming.length} 封續訂提醒信`);
    return { reminded: upcoming.length };
  }
}
