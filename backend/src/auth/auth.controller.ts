import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  // 註冊/登入是暴力破解與帳號枚舉的主要目標，限制在全站預設值之上再收緊：
  // 同一 IP 每分鐘最多 5 次。
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.name);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.auth.me(user.id);
  }
}
