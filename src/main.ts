import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
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

/**
 * CORS 白名單。
 *
 * 舊版是 `origin: true`，等於「反射任何來源」。搭配 `credentials: true`，
 * 任何網站都能帶著使用者的 cookie 呼叫本 API 並讀取回應——這是最經典的
 * CORS 誤設定，等於把登入狀態開放給全網路。
 *
 * 現在改成明確白名單：來源取自 WEB_PUBLIC_URL（可逗號分隔多個），
 * 開發環境額外放行 localhost。沒有設定時退回「不允許跨來源」，
 * 而不是「允許全部」——預設要安全，開放要明示。
 */
function buildCorsOptions(): CorsOptions {
  const configured = (process.env.WEB_PUBLIC_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const devOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ];

  const allowed = isDev ? [...new Set([...configured, ...devOrigins])] : configured;

  // 逃生開關：明確設定 CORS_ALLOW_ALL=1 才會退回舊行為（反射任意來源）。
  // 保留它是因為首次部署時可能還不知道前端網址，需要先讓系統跑起來；
  // 但這必須是「有人主動打開」而不是預設值。
  if (process.env.CORS_ALLOW_ALL === '1') {
    console.warn(
      '[CORS] CORS_ALLOW_ALL=1：允許任何來源，且 credentials 開啟。' +
        '這僅適用於短期測試，正式環境務必關閉並改設 WEB_PUBLIC_URL。',
    );
    return { origin: true, credentials: true };
  }

  if (allowed.length === 0) {
    console.warn(
      '[CORS] WEB_PUBLIC_URL 未設定，所有跨來源請求都會被拒絕。' +
        '請設定前端網址（例如 https://app.example.com），' +
        '或暫時設定 CORS_ALLOW_ALL=1 讓前端先能連上。',
    );
  }

  return {
    origin(origin, callback) {
      // 同源請求與伺服器對伺服器呼叫（無 Origin 標頭）一律放行。
      if (!origin) return callback(null, true);

      const normalized = origin.replace(/\/$/, '');
      if (allowed.includes(normalized)) {
        return callback(null, true);
      }

      // 不准的時候不要丟錯，回 false 讓瀏覽器自行阻擋即可——
      // 丟錯會在伺服器日誌留下噪音，且對攻擊者毫無嚇阻效果。
      return callback(null, false);
    },
    credentials: true,
  };
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
  app.enableCors(buildCorsOptions());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
