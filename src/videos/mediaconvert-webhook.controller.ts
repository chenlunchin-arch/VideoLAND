import { BadRequestException, Controller, ForbiddenException, Headers, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import * as crypto from 'crypto';
import { VideosService } from '../videos/videos.service';

// MediaConvert 本身不會直接呼叫 webhook；標準作法是設定 EventBridge 規則監聽
// "MediaConvert Job State Change"，用 API destination 打到這支端點。
// 這裡用 HMAC-SHA256 對原始 body 簽章驗證，而不是單純比對明文密鑰字串，
// 避免密鑰在傳輸/紀錄過程中被直接看到就能重放請求；正式環境如果 EventBridge
// 改用 SigV4 簽章（透過 IAM 角色呼叫），可以把這段換成驗證 AWS 簽章。
@Controller('webhooks/mediaconvert')
export class MediaConvertWebhookController {
  constructor(private videos: VideosService) {}

  @SkipThrottle()
  @Post()
  async handle(
    @Req() req: Request & { rawBody: Buffer },
    @Headers('x-webhook-signature') signature: string,
  ) {
    if (!signature || !this.verifySignature(req.rawBody, signature)) {
      throw new ForbiddenException('webhook 簽章驗證失敗');
    }

    let body: any;
    try {
      body = JSON.parse(req.rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('無法解析 webhook 內容');
    }

    const detail = body.detail;
    const jobId = detail?.jobId;
    const status = detail?.status; // 'COMPLETE' | 'ERROR'
    if (!jobId || !status) return { ignored: true };

    await this.videos.completeTranscode(jobId, status === 'COMPLETE');
    return { received: true };
  }

  private verifySignature(rawBody: Buffer, signature: string): boolean {
    const secret = process.env.MEDIACONVERT_WEBHOOK_SECRET as string;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const signatureBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  }
}
