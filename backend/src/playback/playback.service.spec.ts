import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlaybackService } from './playback.service';

// playback.service.ts 是全案最容易出現差一錯誤的地方（時數計算、額度扣除、
// 訪客上限），所以優先幫這裡補測試，其餘 CRUD 類的模組風險較低，之後再補。

function makePrismaMock(overrides: Record<string, any> = {}) {
  return {
    video: { findUnique: jest.fn() },
    playbackSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    minuteLedger: {
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    ...overrides,
  } as any;
}

describe('PlaybackService', () => {
  describe('startSession', () => {
    it('訪客在 10 分鐘上限內可以開始播放', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1', status: 'published' });
      prisma.playbackSession.aggregate.mockResolvedValue({ _sum: { minutesConsumed: 3 } });
      prisma.playbackSession.create.mockResolvedValue({ id: 'sess1' });

      const service = new PlaybackService(prisma);
      const result = await service.startSession({ userId: null, guestToken: 'guest-abc' }, 'v1');

      expect(result.sessionId).toBe('sess1');
      expect(prisma.playbackSession.create).toHaveBeenCalled();
    });

    it('訪客超過 10 分鐘上限時應該被拒絕', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1', status: 'published' });
      prisma.playbackSession.aggregate.mockResolvedValue({ _sum: { minutesConsumed: 10 } });

      const service = new PlaybackService(prisma);
      await expect(
        service.startSession({ userId: null, guestToken: 'guest-abc' }, 'v1'),
      ).rejects.toMatchObject({ response: { code: 'guest_limit_reached' } });
    });

    it('會員剩餘時數用完時應該被拒絕', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1', status: 'published' });
      prisma.minuteLedger.aggregate.mockResolvedValue({ _sum: { minutes: 0 } });

      const service = new PlaybackService(prisma);
      await expect(
        service.startSession({ userId: 'user1', guestToken: null }, 'v1'),
      ).rejects.toMatchObject({ response: { code: 'quota_exceeded' } });
    });

    it('影片不存在或未上架時應該回傳 404', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue(null);

      const service = new PlaybackService(prisma);
      await expect(
        service.startSession({ userId: 'user1', guestToken: null }, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('heartbeat', () => {
    it('會員心跳應該依經過時間扣除剩餘時數，且不超過實際剩餘量', async () => {
      const startedAt = new Date(Date.now() - 5 * 60_000); // 5 分鐘前
      const prisma = makePrismaMock();
      prisma.playbackSession.findUnique.mockResolvedValue({
        id: 'sess1',
        userId: 'user1',
        guestToken: null,
        videoId: 'v1',
        status: 'active',
        lastHeartbeatAt: startedAt,
      });
      // 只剩 3 分鐘，即使經過 5 分鐘也只能扣 3 分鐘
      prisma.minuteLedger.aggregate.mockResolvedValue({ _sum: { minutes: 3 } });
      prisma.playbackSession.update.mockResolvedValue({});

      const service = new PlaybackService(prisma);
      await service.heartbeat({ userId: 'user1', guestToken: null }, 'sess1');

      expect(prisma.minuteLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ minutes: -3, source: 'watch' }) }),
      );
    });

    it('會員額度已耗盡時心跳應該擋下並標記 session 為 blocked', async () => {
      const prisma = makePrismaMock();
      prisma.playbackSession.findUnique.mockResolvedValue({
        id: 'sess1',
        userId: 'user1',
        guestToken: null,
        videoId: 'v1',
        status: 'active',
        lastHeartbeatAt: new Date(),
      });
      prisma.minuteLedger.aggregate.mockResolvedValue({ _sum: { minutes: 0 } });
      prisma.playbackSession.update.mockResolvedValue({});

      const service = new PlaybackService(prisma);
      await expect(
        service.heartbeat({ userId: 'user1', guestToken: null }, 'sess1'),
      ).rejects.toMatchObject({ response: { code: 'quota_exceeded' } });

      expect(prisma.playbackSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'blocked' }) }),
      );
    });

    it('心跳時如果 session 不屬於呼叫者應該被拒絕', async () => {
      const prisma = makePrismaMock();
      prisma.playbackSession.findUnique.mockResolvedValue({
        id: 'sess1',
        userId: 'user1',
        guestToken: null,
        videoId: 'v1',
        status: 'active',
        lastHeartbeatAt: new Date(),
      });

      const service = new PlaybackService(prisma);
      await expect(
        service.heartbeat({ userId: 'someone-else', guestToken: null }, 'sess1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('已結束或不存在的 session 心跳應該被拒絕', async () => {
      const prisma = makePrismaMock();
      prisma.playbackSession.findUnique.mockResolvedValue(null);

      const service = new PlaybackService(prisma);
      await expect(
        service.heartbeat({ userId: 'user1', guestToken: null }, 'missing'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('endSession', () => {
    it('結束播放應該回傳本次消耗的分鐘數並更新狀態', async () => {
      const prisma = makePrismaMock();
      prisma.playbackSession.findUnique.mockResolvedValue({
        id: 'sess1',
        userId: 'user1',
        guestToken: null,
        minutesConsumed: 12,
      });
      prisma.playbackSession.update.mockResolvedValue({});

      const service = new PlaybackService(prisma);
      const result = await service.endSession({ userId: 'user1', guestToken: null }, 'sess1');

      expect(result).toEqual({ minutesConsumed: 12 });
      expect(prisma.playbackSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ended' }) }),
      );
    });
  });
});
