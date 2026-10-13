import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

// 播放相關 API 不強制要求登入（訪客也能試看），
// 所以用這個 decorator 統一解析「登入會員」或「訪客 token」兩種身份，
// 而不是用一般的 JWT-only Guard 擋掉未登入的請求。
export interface Identity {
  userId: string | null;
  guestToken: string | null;
}

export const CurrentIdentity = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Identity => {
    const req = ctx.switchToHttp().getRequest();

    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(
          authHeader.slice(7),
          process.env.JWT_SECRET as string,
        ) as { sub: string };
        return { userId: payload.sub, guestToken: null };
      } catch {
        // token 失效就當作訪客處理，交給後續邏輯判斷是否需要重新登入
      }
    }

    // 訪客身份：用 cookie 綁定的長效亂數 token 辨識同一裝置，
    // 若前端還沒帶 cookie，由呼叫端（playback controller）產生並回傳一個新的
    const guestToken = req.cookies?.['guest_token'] ?? null;
    return { userId: null, guestToken };
  },
);
