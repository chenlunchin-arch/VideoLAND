import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION });
const BUCKET = process.env.AWS_S3_BUCKET as string;
const UPLOAD_URL_TTL_SECONDS = 60 * 10; // 10 分鐘內要完成上傳

// 前端直接 PUT 到這個網址，檔案不會經過應用伺服器，避免大檔案拖垮 API 主機
export async function getPresignedUploadUrl(videoId: string, filename: string) {
  const key = `raw/${videoId}/${filename}`;
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: key });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  return { uploadUrl, s3Key: key };
}

// 影片下架/刪除時一併清掉原始檔與所有轉檔輸出，避免 S3 留下孤兒檔案持續計費
export async function deleteVideoAssets(videoId: string) {
  await deletePrefix(`raw/${videoId}/`);
  await deletePrefix(`hls/${videoId}/`);
}

async function deletePrefix(prefix: string) {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    const keys = (listed.Contents ?? []).map((obj) => ({ Key: obj.Key! })).filter((o) => o.Key);
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys } }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

export function s3Uri(key: string): string {
  return `s3://${BUCKET}/${key}`;
}

export function s3HttpUrl(key: string): string {
  return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}
