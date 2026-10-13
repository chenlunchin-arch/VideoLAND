import { Module } from '@nestjs/common';
import { RenewalReminderService } from './renewal-reminder.service';
import { EmailService } from './email.service';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [RenewalReminderService, EmailService, PrismaService],
  exports: [EmailService],
})
export class NotificationsModule {}
