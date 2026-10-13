import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Identity } from '../auth/identity.decorator';
import { randomUUID } from 'crypto';
import { getSignedCloudfrontUrl } from './cloudfront-signer';
import { getRemainingMinutes } from '../membership/minutes.util';

const GUEST_CAP_MINUTES = 10;
const SIGNED_URL_TTL_SECONDS = 60; // 每次心跳才延長，過期就必須重新核可

@Injectable()
export class PlaybackService {
  constructor(private prisma: PrismaService) {}

  // ---- 開始播放：核可身份與剩餘額度，核發短效播放網址 ----
  async startSession(identity: Identity, videoId: string) {
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video || video.status !== 'published') {
      throw new NotFoundException('影片不存在或尚未上架');
    }

    const guestToken = identity.userId ? null : identity.guestToken ?? randomUUID();

    if (identity.userId) {
      const remaining = await getRemainingMinutes(this.prisma, identity.userId);
      if (remaining <= 0) {
        throw new ForbiddenException({ code: 'quota_exceeded', remaining: 0 });
      }
    } else {
      const consumed = await this.getGuestConsumedMinutes(guestToken!, videoId);
      if (consumed >= GUEST_CAP_MINUTES) {
        throw new ForbiddenException({ code: 'guest_limit_reached', remaining: 0 });
      }
    }

    const session = await this.prisma.playbackSession.create({
      data: {
        userId: identity.userId,
        guestToken,
        videoId,
        status: 'active',
      },
    });

    return {
      sessionId: session.id,
      guestToken, // 前端需把這個寫回 cookie，讓下次請求辨識同一位訪客
      playbackUrl: getSignedCloudfrontUrl(videoId, SIGNED_URL_TTL_SECONDS),
    };
  }

  // ---- 心跳：這是唯一真正「計時」的地方 ----
  async heartbeat(identity: Identity, sessionId: string) {
    const session = await this.prisma.playbackSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'active') {
      throw new ForbiddenException({ code: 'session_invalid' });
    }
    this.assertOwnsSession(session, identity);

    const now = new Date();
    const elapsedMinutes = Math.max(
      0,
      Math.round((now.getTime() - session.lastHeartbeatAt.getTime()) / 60000),
    );

    if (session.userId) {
      const remaining = await getRemainingMinutes(this.prisma, session.userId);
      if (remaining <= 0) {
        await this.blockSession(session.id);
        throw new ForbiddenException({ code: 'quota_exceeded', remaining: 0 });
      }
      // 只消耗到剩餘額度為止，避免扣成負數
      const toConsume = Math.min(elapsedMinutes, remaining);
      await this.prisma.minuteLedger.create({
        data: {
          userId: session.userId,
          period: currentPeriod(),
          source: 'watch',
          minutes: -toConsume,
        },
      });
    } else {
      const consumedSoFar = await this.getGuestConsumedMinutes(session.guestToken!, session.videoId);
      if (consumedSoFar >= GUEST_CAP_MINUTES) {
        await this.blockSession(session.id);
        throw new ForbiddenException({ code: 'guest_limit_reached', remaining: 0 });
      }
    }

    await this.prisma.playbackSession.update({
      where: { id: session.id },
      data: {
        lastHeartbeatAt: now,
        minutesConsumed: { increment: elapsedMinutes },
      },
    });

    const remaining = session.userId
      ? await getRemainingMinutes(this.prisma, session.userId)
      : GUEST_CAP_MINUTES - (await this.getGuestConsumedMinutes(session.guestToken!, session.videoId));

    return {
      remainingMinutes: Math.max(0, remaining),
      playbackUrl: getSignedCloudfrontUrl(session.videoId, SIGNED_URL_TTL_SECONDS),
    };
  }

  // ---- 結束播放 ----
  async endSession(identity: Identity, sessionId: string) {
    const session = await this.prisma.playbackSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException();
    this.assertOwnsSession(session, identity);

    await this.prisma.playbackSession.update({
      where: { id: sessionId },
      data: { status: 'ended', endedAt: new Date() },
    });
    return { minutesConsumed: session.minutesConsumed };
  }

  // ---- 剩餘時數 = 帳本加總（天然支援跨月累積） ----
  private async getGuestConsumedMinutes(guestToken: string, videoId: string): Promise<number> {
    const result = await this.prisma.playbackSession.aggregate({
      where: { guestToken, videoId },
      _sum: { minutesConsumed: true },
    });
    return result._sum.minutesConsumed ?? 0;
  }

  private async blockSession(sessionId: string) {
    await this.prisma.playbackSession.update({
      where: { id: sessionId },
      data: { status: 'blocked' },
    });
  }

  private assertOwnsSession(session: { userId: string | null; guestToken: string | null }, identity: Identity) {
    const owns = session.userId
      ? session.userId === identity.userId
      : session.guestToken === identity.guestToken;
    if (!owns) throw new ForbiddenException({ code: 'session_not_owned' });
  }
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
