import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

// 必須排在 AuthGuard 之後使用（依賴 req.user 已經被 AuthGuard 附加）
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('僅限管理員操作');
    }
    return true;
  }
}
