import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PlaybackModule } from './playback/playback.module';
import { AuthModule } from './auth/auth.module';
import { VideosModule } from './videos/videos.module';
import { MembershipModule } from './membership/membership.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // 全站預設速率限制：每個 IP 每分鐘最多 100 次請求。
    // 個別端點（例如登入/註冊）可用 @Throttle() 覆寫更嚴格的限制，
    // 金流/轉檔的伺服器對伺服器 webhook 則用 @SkipThrottle() 排除，
    // 避免付款商或 AWS 的回調因為單一 IP 高頻率請求被誤擋。
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    VideosModule,
    MembershipModule,
    PlaybackModule,
    PaymentsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
