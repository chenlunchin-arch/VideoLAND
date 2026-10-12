import { Module } from '@nestjs/common';
import { VideosController } from './videos.controller';
import { MediaConvertWebhookController } from './mediaconvert-webhook.controller';
import { VideosService } from './videos.service';
import { PrismaService } from '../prisma.service';
import { AuthGuard } from '../auth/auth.guard';

@Module({
  controllers: [VideosController, MediaConvertWebhookController],
  providers: [VideosService, PrismaService, AuthGuard],
})
export class VideosModule {}
