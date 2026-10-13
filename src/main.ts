import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { AppModule } from './app.module';
import { SentryExceptionFilter } from './common/sentry-exception.filter';

// 沒設定 SENTRY_DSN 時（例如本機開發）就不啟用，Sentry SDK 在未 init
// 的狀態下呼叫 captureException 是安全的 no-op，不會噴錯。
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // 部署在 Zeabur / Cloud Run 這類反向代理後面時，要信任一層 proxy，
  // 否則 req.ip 永遠是代理的內網 IP，所有人會共用同一個速率限制額度
  // （登入 5 次/分鐘會變成「全站」5 次/分鐘）。
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(cookieParser());
  // Stripe webhook 一定要拿到未被解析過的原始 body 才能驗證簽章，
  // 其餘路由照常用 express.json() 解析。
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true })); // 綠界回調是表單格式
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
