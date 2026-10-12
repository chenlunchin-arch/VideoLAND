import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PrismaService],
  exports: [AuthGuard],
})
export class AuthModule {}
