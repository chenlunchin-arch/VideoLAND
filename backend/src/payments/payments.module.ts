import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PrismaService, AuthGuard],
})
export class PaymentsModule {}
