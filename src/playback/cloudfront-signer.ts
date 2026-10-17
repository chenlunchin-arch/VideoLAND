import { createSign } from 'crypto';

/**
 * CloudFront signed URL 產生器（canned policy）。
 *
 * 為什麼自己寫而不用 @aws-sdk/cloudfront-signer：
 * canned policy 的簽章就是 RSA-SHA1 對一段固定 JSON 做簽名再 base64url，
 * 用 Node 內建 crypto 十行就能完成。少一個依賴，就少一個要更新的供應鏈風險。
 *
 * ── 重要的行為約定 ──
 * 沒有設定金鑰時，這裡**不會**回傳一個看起來正常的假網址。舊版寫死
 * `signature=TODO`，會讓整個系統「表面正常、實際沒有保護」——付費牆形同虛設，
 * 而且沒有任何人會發現。現在改成明確降級：回傳未簽章網址並在日誌留警告，
 * 讓問題在測試階段就暴露，而不是等有人白看完整片才發現。
 *
 * ── 與心跳機制的關係 ──
 * playback.service 發的是 TTL 60 秒的短效網址，每次心跳重新核發。
 * 因此簽章網址只覆蓋「當下這 60 秒」，即使被複製出去也很快失效。
 */

export interface SignedUrlOptions {
  /** CloudFront distribution 網域，例如 https://d111111abcdef8.cloudfront.net */
  domain: string;
  /** CloudFront key pair ID（不是 IAM access key） */
  keyPairId: string;
  /** PEM 格式的 RSA 私鑰內容 */
  privateKey: string;
}

const ALGORITHM = 'RSA-SHA1'; // CloudFront canned policy 固定使用 RSA-SHA1

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
}

function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** 把環境變數裡被轉義成 \n 的私鑰還原成真正的換行。 */
function normalizeKey(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

export function readOptionsFromEnv(): SignedUrlOptions | null {
  const domain = process.env.CLOUDFRONT_DOMAIN;
  const keyPairId = process.env.CLOUDFRONT_KEY_PAIR_ID;
  const privateKey = process.env.CLOUDFRONT_PRIVATE_KEY;

  if (!domain || !keyPairId || !privateKey) return null;
  return { domain: normalizeDomain(domain), keyPairId, privateKey: normalizeKey(privateKey) };
}

/**
 * 產生 CloudFront canned-policy 簽章網址。
 *
 * 回傳值一定是可以播放的網址：有金鑰就簽章，沒有就回傳未簽章網址
 * 並標記 `signed: false`，讓呼叫端能決定要不要據此告警。
 */
export function signCloudfrontUrl(
  path: string,
  ttlSeconds: number,
  options: SignedUrlOptions | null = readOptionsFromEnv(),
): { url: string; signed: boolean } {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (!options) {
    // 沒有金鑰：回傳未簽章網址。若 distribution 設為「需要簽章」，
    // 這個網址會直接被 CloudFront 拒絕（403），錯誤在第一次播放就看得見。
    const domain = normalizeDomain(process.env.CLOUDFRONT_DOMAIN || 'https://cdn.example.com');
    return { url: `${domain}${cleanPath}`, signed: false };
  }

  const expires = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const resource = `${options.domain}${cleanPath}`;

  // canned policy 的欄位順序必須固定，CloudFront 會逐字元驗證。
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: resource,
        Condition: { DateLessThan: { 'AWS:EpochTime': expires } },
      },
    ],
  });

  const signer = createSign(ALGORITHM);
  signer.update(policy);
  signer.end();

  const signature = base64url(signer.sign(options.privateKey));
  const encodedPolicy = base64url(policy);

  const url =
    `${resource}?Policy=${encodedPolicy}` +
    `&Signature=${signature}` +
    `&Key-Pair-Id=${options.keyPairId}`;

  return { url, signed: true };
}

let warnedMissingKey = false;

/**
 * 相容舊介面：給 playback.service 用。
 * 保留函式名稱與簽名，但回傳真正的簽章網址。
 */
export function getSignedCloudfrontUrl(
  videoId: string,
  ttlSeconds: number,
  options: SignedUrlOptions | null = readOptionsFromEnv(),
): string {
  const { url, signed } = signCloudfrontUrl(`/hls/${videoId}/master.m3u8`, ttlSeconds, options);

  if (!signed && !warnedMissingKey) {
    // 只警告一次，避免心跳每分鐘刷一次日誌。
    warnedMissingKey = true;
    console.warn(
      '[playback] CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY 未設定，' +
        '回傳未簽章網址。若 distribution 啟用 Signed URLs，播放會收到 403。' +
        '（此警告只顯示一次）',
    );
  }

  return url;
}
