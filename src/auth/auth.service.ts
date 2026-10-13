import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma.service';
import { getRemainingMinutes, getActiveTierLevel } from '../membership/minutes.util';

const ACCESS_TOKEN_TTL = '15m';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async register(email: string, password: string, name: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('這個 Email 已經註冊過了');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, name, role: 'user' },
    });
    return this.buildAuthResponse(user);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('帳號或密碼錯誤');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('帳號或密碼錯誤');

    return this.buildAuthResponse(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toProfile(user);
  }

  private async buildAuthResponse(user: { id: string }) {
    const accessToken = jwt.sign({ sub: user.id }, process.env.JWT_SECRET as string, {
      expiresIn: ACCESS_TOKEN_TTL,
    });
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return { accessToken, user: await this.toProfile(full) };
  }

  private async toProfile(user: { id: string; email: string; name: string; role: string }) {
    const [remainingMinutes, tier] = await Promise.all([
      getRemainingMinutes(this.prisma, user.id),
      getActiveTierLevel(this.prisma, user.id),
    ]);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tier,
      remainingMinutes,
    };
  }
}
