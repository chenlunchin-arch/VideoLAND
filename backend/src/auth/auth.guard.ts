import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma.service';

// 用在「一定要登入」的端點（例如 /me、/admin/*），
// 和 identity.decorator.ts 不同：那個允許訪客通過，這個會直接擋掉未登入請求。
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('請先登入');
    }
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET as string) as {
        sub: string;
      };
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException();
      req.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('登入已過期，請重新登入');
    }
  }
}
