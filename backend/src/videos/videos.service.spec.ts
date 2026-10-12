import { BadRequestException, NotFoundException } from '@nestjs/common';

jest.mock('./s3.util', () => ({
  getPresignedUploadUrl: jest.fn().mockResolvedValue({ uploadUrl: 'https://s3.example/put', s3Key: 'raw/v1/movie.mp4' }),
  s3Uri: jest.fn((key: string) => `s3://bucket/${key}`),
  deleteVideoAssets: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./mediaconvert.util', () => ({
  startTranscodeJob: jest.fn().mockResolvedValue('job-123'),
  HLS_RENDITION_NAMES: ['1080p', '720p', '480p'],
}));

import { VideosService } from './videos.service';
import * as s3Util from './s3.util';
import * as mcUtil from './mediaconvert.util';

function makePrismaMock(overrides: Record<string, any> = {}) {
  return {
    category: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    video: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    videoRendition: { deleteMany: jest.fn(), createMany: jest.fn() },
    ...overrides,
  } as any;
}

beforeEach(() => jest.clearAllMocks());

describe('VideosService', () => {
  describe('getUploadUrl', () => {
    it('影片不存在時應該回 404，且不呼叫 S3', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue(null);
      const service = new VideosService(prisma);
      await expect(service.getUploadUrl('missing', 'a.mp4')).rejects.toBeInstanceOf(NotFoundException);
      expect(s3Util.getPresignedUploadUrl).not.toHaveBeenCalled();
    });

    it('成功時應該把 s3Key 寫回影片紀錄', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1' });
      prisma.video.update.mockResolvedValue({});

      const service = new VideosService(prisma);
      const result = await service.getUploadUrl('v1', 'movie.mp4');

      expect(result.s3Key).toBe('raw/v1/movie.mp4');
      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { rawS3Key: 'raw/v1/movie.mp4' },
      });
    });
  });

  describe('startTranscode', () => {
    it('尚未上傳過原始檔時應該拒絕觸發轉檔', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1', rawS3Key: null });
      const service = new VideosService(prisma);
      await expect(service.startTranscode('v1')).rejects.toBeInstanceOf(BadRequestException);
      expect(mcUtil.startTranscodeJob).not.toHaveBeenCalled();
    });

    it('成功時應該把狀態改成 processing 並記錄 jobId', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1', rawS3Key: 'raw/v1/movie.mp4' });
      prisma.video.update.mockResolvedValue({});

      const service = new VideosService(prisma);
      await service.startTranscode('v1');

      expect(mcUtil.startTranscodeJob).toHaveBeenCalledWith('v1', 'raw/v1/movie.mp4');
      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { status: 'processing', transcodeJobId: 'job-123' },
      });
    });
  });

  describe('completeTranscode', () => {
    it('找不到對應 jobId 的影片時應該安靜忽略', async () => {
      const prisma = makePrismaMock();
      prisma.video.findFirst.mockResolvedValue(null);
      const service = new VideosService(prisma);
      await service.completeTranscode('job-unknown', true);
      expect(prisma.video.update).not.toHaveBeenCalled();
    });

    it('轉檔失敗時應該把狀態退回 draft，且不寫入畫質資料', async () => {
      const prisma = makePrismaMock();
      prisma.video.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.video.update.mockResolvedValue({});

      const service = new VideosService(prisma);
      await service.completeTranscode('job-123', false);

      expect(prisma.video.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'draft' } });
      expect(prisma.videoRendition.createMany).not.toHaveBeenCalled();
    });

    it('轉檔成功時應該寫入三種畫質並把狀態改成 published', async () => {
      const prisma = makePrismaMock();
      prisma.video.findFirst.mockResolvedValue({ id: 'v1' });
      prisma.videoRendition.deleteMany.mockResolvedValue({});
      prisma.videoRendition.createMany.mockResolvedValue({});
      prisma.video.update.mockResolvedValue({});

      const service = new VideosService(prisma);
      await service.completeTranscode('job-123', true);

      const createManyArg = prisma.videoRendition.createMany.mock.calls[0][0];
      expect(createManyArg.data).toHaveLength(3);
      expect(createManyArg.data.map((r: any) => r.quality)).toEqual(['1080p', '720p', '480p']);
      expect(prisma.video.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'published' } });
    });
  });

  describe('deleteVideo', () => {
    it('刪除影片前應該先清掉 S3 資源', async () => {
      const prisma = makePrismaMock();
      prisma.video.findUnique.mockResolvedValue({ id: 'v1' });
      prisma.video.delete.mockResolvedValue({});

      const service = new VideosService(prisma);
      await service.deleteVideo('v1');

      expect(s3Util.deleteVideoAssets).toHaveBeenCalledWith('v1');
      expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
    });
  });
});
