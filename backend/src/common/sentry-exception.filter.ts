import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

// 全站例外過濾器：把非預期的伺服器錯誤（500 以上，或非 HttpException 的
// 原生 JS Error）回報給 Sentry，再交回 Nest 內建的處理邏輯產生一樣的
// HTTP 回應，前端行為完全不受影響。像 400/401/404 這類正常的業務邏輯
// 錯誤（驗證失敗、找不到資源等）不會回報，避免把 Sentry 灌爆。
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!isHttpException || status >= 500) {
      Sentry.captureException(exception);
    }

    super.catch(exception, host);
  }
}
