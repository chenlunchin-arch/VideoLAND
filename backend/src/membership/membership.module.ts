import { Module } from '@nestjs/common';
import { MembershipController } from './membership.controller';
import { MembershipService } from './membership.service';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';

@Module({
  controllers: [MembershipController],
  providers: [MembershipService, PrismaService, AuthGuard],
})
export class MembershipModule {}
