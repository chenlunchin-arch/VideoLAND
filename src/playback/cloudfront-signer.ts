// 實際部署時改用 aws-cloudfront-sign 或 @aws-sdk/cloudfront-signer 套件，
// 用 CLOUDFRONT_PRIVATE_KEY 對 HLS manifest 網址簽章。
// 這裡先用可運作的介面示意，方便先接通前後端流程。
export function getSignedCloudfrontUrl(videoId: string, ttlSeconds: number): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const base = process.env.CLOUDFRONT_DOMAIN || 'https://cdn.example.com';
  return `${base}/hls/${videoId}/master.m3u8?expires=${expires}&signature=TODO`;
}
