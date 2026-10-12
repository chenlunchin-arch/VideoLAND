import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { s3Uri } from './s3.util';

const mediaConvert = new MediaConvertClient({
  region: process.env.AWS_REGION,
  endpoint: process.env.MEDIACONVERT_ENDPOINT, // 帳號專屬端點，第一次用 DescribeEndpoints 拿到後直接寫死即可
});

// 三種畫質的 HLS 輸出，對應前面架構文件裡的多碼率規劃
const RENDITIONS = [
  { name: '1080p', width: 1920, height: 1080, bitrate: 5_000_000 },
  { name: '720p', width: 1280, height: 720, bitrate: 3_000_000 },
  { name: '480p', width: 854, height: 480, bitrate: 1_200_000 },
];

export async function startTranscodeJob(videoId: string, rawS3Key: string): Promise<string> {
  const input = s3Uri(rawS3Key);
  const outputPrefix = s3Uri(`hls/${videoId}/`);

  const command = new CreateJobCommand({
    Role: process.env.MEDIACONVERT_ROLE_ARN,
    // 帶上 videoId，webhook 收到 job 完成通知時要靠這個關聯回資料庫的影片
    UserMetadata: { videoId },
    Settings: {
      Inputs: [{ FileInput: input }],
      OutputGroups: [
        {
          Name: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: outputPrefix,
              SegmentLength: 6,
              MinSegmentLength: 0,
            },
          },
          Outputs: RENDITIONS.map((r) => ({
            NameModifier: `_${r.name}`,
            ContainerSettings: { Container: 'M3U8' },
            VideoDescription: {
              Width: r.width,
              Height: r.height,
              CodecSettings: {
                Codec: 'H_264',
                H264Settings: { Bitrate: r.bitrate, RateControlMode: 'CBR' },
              },
            },
            AudioDescriptions: [
              { CodecSettings: { Codec: 'AAC', AacSettings: { Bitrate: 128_000, SampleRate: 48_000 } } },
            ],
          })),
        },
      ],
    },
  });

  const result = await mediaConvert.send(command);
  if (!result.Job?.Id) throw new Error('MediaConvert 未回傳 Job ID');
  return result.Job.Id;
}

export const HLS_RENDITION_NAMES = RENDITIONS.map((r) => r.name);
