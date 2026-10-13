import * as crypto from 'crypto';

// 綠界 CheckMacValue 標準演算法：
// 1. 參數依 key 字母排序
// 2. 前後補上 HashKey / HashIV，組成查詢字串
// 3. 依 .NET UrlEncode 規則轉小寫並取代特定符號
// 4. SHA256 雜湊後轉大寫
// 官方文件：https://developers.ecpay.com.tw/?p=2902
export function buildEcpayCheckMacValue(params: Record<string, string | number>): string {
  const hashKey = process.env.ECPAY_HASH_KEY as string;
  const hashIV = process.env.ECPAY_HASH_IV as string;

  const sorted = Object.keys(params)
    .filter((k) => k !== 'CheckMacValue')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`;

  let encoded = encodeURIComponent(raw).toLowerCase();
  encoded = encoded
    .replace(/%20/g, '+')
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');

  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

export function verifyEcpayCheckMacValue(params: Record<string, string>): boolean {
  const { CheckMacValue, ...rest } = params;
  return buildEcpayCheckMacValue(rest) === CheckMacValue;
}

// 終止「定期定額」委託，之後綠界就不會再自動扣款。
// 欄位名稱請對照當時的綠界最新文件（信用卡定期定額 API）再確認一次，這裡先用文件記載的慣例欄位示意流程。
export async function terminateEcpayPeriodic(merchantTradeNo: string): Promise<boolean> {
  const params: Record<string, string> = {
    MerchantID: process.env.ECPAY_MERCHANT_ID as string,
    MerchantTradeNo: merchantTradeNo,
    Action: 'Terminate',
  };
  const checkMacValue = buildEcpayCheckMacValue(params);
  const body = new URLSearchParams({ ...params, CheckMacValue: checkMacValue });

  const res = await fetch(
    process.env.ECPAY_PERIODIC_ACTION_URL || 'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction',
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const text = await res.text();
  return text.startsWith('1|');
}

// 信用卡單筆請款的退款／取消，用建立訂單時拿到的 TradeNo（不是 MerchantTradeNo）
export async function refundEcpayCredit(tradeNo: string, totalAmount: number): Promise<boolean> {
  const params: Record<string, string | number> = {
    MerchantID: process.env.ECPAY_MERCHANT_ID as string,
    TradeNo: tradeNo,
    Action: 'R', // R = 退款
    TotalAmount: totalAmount,
  };
  const checkMacValue = buildEcpayCheckMacValue(params);
  const body = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    CheckMacValue: checkMacValue,
  });

  const res = await fetch(
    process.env.ECPAY_CREDIT_ACTION_URL || 'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction',
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const text = await res.text();
  return text.startsWith('1|');
}
