import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// 搭配 AuthGuard 使用：拿 req.user（AuthGuard 已驗證並查好的完整使用者）
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
