import { Module } from '@nestjs/common';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [PlaybackController],
  providers: [PlaybackService, PrismaService],
})
export class PlaybackModule {}
