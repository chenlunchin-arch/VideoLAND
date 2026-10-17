import { generateKeyPairSync } from 'crypto';
import {
  signCloudfrontUrl,
  getSignedCloudfrontUrl,
  readOptionsFromEnv,
  SignedUrlOptions,
} from './cloudfront-signer';

/**
 * 這些測試的價值：CloudFront 簽章錯在任何地方（欄位順序、base64 變體、
 * 時間格式）都只會得到一個 403，而 CloudFront 不會告訴你錯在哪。
 * 用金鑰對簽名做「本機驗證」是唯一能在部署前抓到錯的方法。
 */
describe('cloudfront-signer', () => {
  // 產生一組測試用 RSA 金鑰（2048 位元，與 CloudFront 要求的規格一致）
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const options: SignedUrlOptions = {
    domain: 'https://d111111abcdef8.cloudfront.net',
    keyPairId: 'K2JCJMDEHXQW5F',
    privateKey,
  };

  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function b64urlDecode(input: string): Buffer {
    const b64 = input.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/');
    return Buffer.from(b64, 'base64');
  }

  function parseUrl(url: string) {
    const parsed = new URL(url);
    return {
      resource: `${parsed.origin}${parsed.pathname}`,
      policy: parsed.searchParams.get('Policy')!,
      signature: parsed.searchParams.get('Signature')!,
      keyPairId: parsed.searchParams.get('Key-Pair-Id')!,
      expires: parsed.searchParams.get('Expires'),
    };
  }

  it('產生含 Policy / Signature / Key-Pair-Id 三個參數的網址', () => {
    const { url, signed } = signCloudfrontUrl('/hls/abc/master.m3u8', 60, options);
    const parts = parseUrl(url);

    expect(signed).toBe(true);
    expect(parts.policy).toBeTruthy();
    expect(parts.signature).toBeTruthy();
    expect(parts.keyPairId).toBe('K2JCJMDEHXQW5F');
    // canned policy 不使用 Expires 查詢參數，時間寫在 Policy 內
    expect(parts.expires).toBeNull();
  });

  it('base64url 不使用 + / = 這三個字元（否則 URL 會壞掉）', () => {
    const { url } = signCloudfrontUrl('/hls/abc/master.m3u8', 60, options);
    const parts = parseUrl(url);

    expect(parts.signature).not.toMatch(/[+/=]/);
    expect(parts.policy).not.toMatch(/[+/=]/);
  });

  it('Policy 內容包含正確的 Resource 與未來的 EpochTime', () => {
    const before = Math.floor(Date.now() / 1000);
    const { url } = signCloudfrontUrl('/hls/abc/master.m3u8', 60, options);
    const { policy } = parseUrl(url);

    const decoded = JSON.parse(b64urlDecode(policy).toString('utf8'));
    const statement = decoded.Statement[0];

    expect(statement.Resource).toBe(
      'https://d111111abcdef8.cloudfront.net/hls/abc/master.m3u8',
    );
    const expiry = statement.Condition.DateLessThan['AWS:EpochTime'];
    expect(expiry).toBeGreaterThanOrEqual(before + 60);
    expect(expiry).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 61);
  });

  it('簽章可用對應的公鑰驗證通過（真正證明簽章有效）', () => {
    const { verify } = require('crypto');
    const { url } = signCloudfrontUrl('/hls/abc/master.m3u8', 60, options);
    const { policy, signature } = parseUrl(url);

    const ok = verify(
      'RSA-SHA1',
      Buffer.from(b64urlDecode(policy).toString('utf8')),
      publicKey,
      b64urlDecode(signature),
    );

    expect(ok).toBe(true);
  });

  it('TTL 越大，EpochTime 越晚', () => {
    const short = parseUrl(signCloudfrontUrl('/x', 60, options).url);
    const long = parseUrl(signCloudfrontUrl('/x', 600, options).url);

    const getExpiry = (p: string) =>
      JSON.parse(b64urlDecode(p).toString('utf8')).Statement[0].Condition.DateLessThan[
        'AWS:EpochTime'
      ];

    expect(getExpiry(long.policy) - getExpiry(short.policy)).toBeGreaterThanOrEqual(539);
  });

  it('沒有金鑰時回傳未簽章網址，且不偽造 signature 參數', () => {
    const { url, signed } = signCloudfrontUrl('/hls/abc/master.m3u8', 60, null);

    expect(signed).toBe(false);
    expect(url).toBe('https://cdn.example.com/hls/abc/master.m3u8');
    expect(url).not.toContain('signature=TODO');
    expect(url).not.toContain('Signature=');
  });

  describe('readOptionsFromEnv', () => {
    it('三個變數齊全時回傳設定', () => {
      process.env.CLOUDFRONT_DOMAIN = 'd111111abcdef8.cloudfront.net';
      process.env.CLOUDFRONT_KEY_PAIR_ID = 'K123';
      process.env.CLOUDFRONT_PRIVATE_KEY = privateKey;

      const result = readOptionsFromEnv();
      expect(result).not.toBeNull();
      // 沒有 scheme 時自動補 https
      expect(result!.domain).toBe('https://d111111abcdef8.cloudfront.net');
      expect(result!.keyPairId).toBe('K123');
    });

    it('把 \\n 轉義還原成真正的換行（環境變數常見情況）', () => {
      process.env.CLOUDFRONT_DOMAIN = 'https://cdn.example.com';
      process.env.CLOUDFRONT_KEY_PAIR_ID = 'K123';
      process.env.CLOUDFRONT_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');

      const result = readOptionsFromEnv();
      expect(result!.privateKey).toContain('\n');
      expect(result!.privateKey).not.toContain('\\n');

      // 還原後必須真的能簽章
      const { signed } = signCloudfrontUrl('/x', 60, result);
      expect(signed).toBe(true);
    });

    it('缺任何一個就回傳 null', () => {
      process.env.CLOUDFRONT_DOMAIN = 'https://cdn.example.com';
      delete process.env.CLOUDFRONT_KEY_PAIR_ID;
      delete process.env.CLOUDFRONT_PRIVATE_KEY;

      expect(readOptionsFromEnv()).toBeNull();
    });
  });

  describe('getSignedCloudfrontUrl（相容介面）', () => {
    it('組出 HLS manifest 路徑並帶簽章', () => {
      const url = getSignedCloudfrontUrl('video-123', 60, options);
      expect(url).toContain('/hls/video-123/master.m3u8');
      expect(url).toContain('Signature=');
    });
  });
});
