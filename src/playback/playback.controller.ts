import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { PlaybackService } from './playback.service';
import { StartSessionDto } from './dto';
import { CurrentIdentity, Identity } from '../auth/identity.decorator';

// 心跳每 20-30 秒打一次，同一個出口 IP 底下可能同時有多位使用者在看片，
// 全站預設的每分鐘 100 次很容易被正常使用撞到，這裡放寬到 300 次/分鐘。
@Throttle({ default: { limit: 300, ttl: 60000 } })
@Controller('playback/sessions')
export class PlaybackController {
  constructor(private playback: PlaybackService) {}

  @Post()
  async start(
    @CurrentIdentity() identity: Identity,
    @Body() dto: StartSessionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.playback.startSession(identity, dto.videoId);
    if (result.guestToken) {
      // 訪客身份寫回 cookie，讓下一支影片／下一次心跳能認出同一位訪客
      res.cookie('guest_token', result.guestToken, {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 365,
      });
    }
    return result;
  }

  @Post(':id/heartbeat')
  heartbeat(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.playback.heartbeat(identity, id);
  }

  @Post(':id/end')
  end(@CurrentIdentity() identity: Identity, @Param('id') id: string) {
    return this.playback.endSession(identity, id);
  }
}
