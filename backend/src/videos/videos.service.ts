import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateVideoDto, UpdateVideoDto, CreateCategoryDto } from './dto';
import { getPresignedUploadUrl, s3Uri, deleteVideoAssets } from './s3.util';
import { startTranscodeJob, HLS_RENDITION_NAMES } from './mediaconvert.util';

@Injectable()
export class VideosService {
  constructor(private prisma: PrismaService) {}

  // ---- 前台公開查詢：只回傳已上架的影片 ----
  listCategories() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  listVideos(categoryId?: string) {
    return this.prisma.video.findMany({
      where: { status: 'published', ...(categoryId ? { categoryId } : {}) },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVideo(id: string) {
    const video = await this.prisma.video.findUnique({ where: { id }, include: { category: true } });
    if (!video) throw new NotFoundException('影片不存在');
    return video;
  }

  // ---- 後台管理：上架時預設為 draft，等 MediaConvert 轉檔完成的 webhook
  //      再把 status 改成 published（此骨架先簡化成建立時就直接可設定狀態）----
  createVideo(dto: CreateVideoDto) {
    return this.prisma.video.create({
      data: {
        title: dto.title,
        categoryId: dto.categoryId,
        durationMinutes: dto.durationMinutes,
        description: dto.description,
        status: 'draft',
      },
    });
  }

  async updateVideo(id: string, dto: UpdateVideoDto) {
    await this.getVideo(id);
    return this.prisma.video.update({ where: { id }, data: dto });
  }

  async deleteVideo(id: string) {
    await this.getVideo(id);
    await deleteVideoAssets(id); // 清掉 S3 上的原始檔與所有轉檔輸出，避免留下孤兒檔案持續計費
    await this.prisma.video.delete({ where: { id } });
    return { deleted: true };
  }

  createCategory(dto: CreateCategoryDto) {
    return this.prisma.category.create({ data: { name: dto.name } });
  }

  async deleteCategory(id: string) {
    await this.prisma.category.delete({ where: { id } });
    return { deleted: true };
  }

  // ---- 上架流程 1：後台先建立影片紀錄，取得可以直接 PUT 上傳原始檔的簽章網址 ----
  async getUploadUrl(videoId: string, filename: string) {
    await this.getVideo(videoId);
    const { uploadUrl, s3Key } = await getPresignedUploadUrl(videoId, filename);
    await this.prisma.video.update({ where: { id: videoId }, data: { rawS3Key: s3Key } });
    return { uploadUrl, s3Key };
  }

  // ---- 上架流程 2：前端確認檔案已上傳完成，後端觸發轉檔 ----
  async startTranscode(videoId: string) {
    const video = await this.getVideo(videoId);
    if (!video.rawS3Key) {
      throw new BadRequestException('尚未取得上傳網址，請先呼叫 upload-url');
    }
    const jobId = await startTranscodeJob(videoId, video.rawS3Key);
    return this.prisma.video.update({
      where: { id: videoId },
      data: { status: 'processing', transcodeJobId: jobId },
    });
  }

  // ---- 上架流程 3：MediaConvert 完成通知（webhook）呼叫這裡，寫入各畫質位置並正式上架 ----
  async completeTranscode(jobId: string, succeeded: boolean) {
    const video = await this.prisma.video.findFirst({ where: { transcodeJobId: jobId } });
    if (!video) return; // 找不到對應影片就忽略，避免不明來源的通知造成錯誤

    if (!succeeded) {
      await this.prisma.video.update({ where: { id: video.id }, data: { status: 'draft' } });
      return;
    }

    await this.prisma.videoRendition.deleteMany({ where: { videoId: video.id } });
    await this.prisma.videoRendition.createMany({
      data: HLS_RENDITION_NAMES.map((quality) => ({
        videoId: video.id,
        quality,
        s3Path: s3Uri(`hls/${video.id}/master_${quality}.m3u8`),
      })),
    });

    await this.prisma.video.update({ where: { id: video.id }, data: { status: 'published' } });
  }
}
