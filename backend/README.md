# 後端骨架說明

依照〈技術架構規劃〉產出的 NestJS 專案骨架。規劃的六大模組、訂閱自動續扣、取消訂閱／退款、
webhook 安全性強化、單元測試、S3 資源清理、續訂提醒信都已經有骨架實作。

## 安裝與啟動

**最快驗證整套系統能不能動**（不需要先裝 Postgres）：

```bash
cp .env.example .env
docker compose up -d --build
./scripts/smoke-test.sh
```

看到 smoke test 全部綠色 `✓` 代表會員系統、後台 CRUD、播放額度、下單建立訂單這些核心流程都是通的。
完整逐項驗收清單（含需要真的 Stripe/綠界/AWS 測試帳號才能測到底的部分）見 `ACCEPTANCE_CHECKLIST.md`。

**本機開發模式**（不用 Docker，接自己的 Postgres）：

```bash
npm install
cp .env.example .env   # 依下方「環境變數」設定
npm run prisma:migrate
npm run prisma:seed     # 建立三個等級的方案、預設加購單價、管理員帳號、示範影片
npm run start:dev
npm test                # 跑播放心跳與金流模組的單元測試
```

種子資料會建立管理員帳號 `admin@example.com` / `ChangeMe123!`（**上線前務必更改**）。

## 模組總覽

### 認證（`src/auth/`）
`POST /auth/register`、`POST /auth/login`、`GET /me`。`AuthGuard` 驗證 JWT 並附加 `req.user`；
`AdminGuard` 檢查 `role === 'admin'`；`identity.decorator.ts` 是播放端點專用、允許訪客通過的身份解析。

### 影片、分類與上架轉檔（`src/videos/`）
前台瀏覽、後台 CRUD、上架三步驟（建立紀錄 → S3 簽章直傳 → 觸發 MediaConvert）、
`POST /webhooks/mediaconvert` 轉檔完成通知、刪除影片時一併清掉 S3 上的原始檔與 HLS 輸出。

### 方案與時數（`src/membership/`）
`GET /membership/tiers`、後台調整方案/加購單價。`minutes.util.ts` 是共用的剩餘時數計算邏輯。

### 播放心跳（`src/playback/`）
開始播放 → 心跳（真正計時與扣除額度）→ 結束播放。`playback.service.spec.ts` 涵蓋訪客上限、
會員額度扣除與耗盡、session 歸屬驗證。

### 金流、訂閱續扣與取消退款（`src/payments/`）
- `POST /payments/orders` 建立訂單（訂閱或加購時數，綠界或 Stripe）
- **自動續扣**：綠界用「定期定額」參數讓綠界自動扣款；Stripe 用真正的 `subscription` 模式。
  兩邊都用「訂單是否已付款過」或 `billing_reason` 區分首次付款與週期續扣，避免重複發放
- **`POST /payments/subscription/cancel`**（已登入）— 關閉自動續扣：Stripe 呼叫 `subscriptions.update(cancel_at_period_end)`；
  綠界呼叫 `terminateEcpayPeriodic()` 終止定期定額委託。本期結束前仍可正常使用
- **`POST /payments/admin/orders/:id/refund`**（管理員）— 對單筆訂單退款：Stripe 呼叫 `refunds.create`，
  綠界呼叫 `refundEcpayCredit()`；退款成功後收回對應權益（加購時數寫入負值帳本 / 訂閱標記 `canceled`）
- **重要 bug 修正**：ECPay 的 `order.gatewayTxnId` 存的是查單用的 `MerchantTradeNo`，`fulfillOrder()`
  絕對不能覆蓋它，實際的 ECPay `TradeNo`（退款要用）改存在 `order.metadata.ecpayTradeNo`
- `payments.service.spec.ts` 涵蓋：金額計算、定期定額參數、首次付款 vs 週期續扣分流、取消訂閱、退款

### 通知（`src/notifications/`）
- `email.service.ts` 用 AWS SES 寄信（換其他服務商只需要改這個 class 內部實作）
- `renewal-reminder.service.ts` 每天早上 9 點掃描 3 天內到期的訂閱並寄出續訂提醒信

### Webhook 安全性
`mediaconvert-webhook.controller.ts` 用 HMAC-SHA256 對原始 body 簽章驗證（`timingSafeEqual` 比對）。

## 環境變數

```
DATABASE_URL=postgresql://user:pass@localhost:5432/video_platform
JWT_SECRET=請改成隨機字串
CLOUDFRONT_DOMAIN=https://your-cdn-domain.com

# AWS：S3 上傳、MediaConvert 轉檔、SES 寄信
AWS_REGION=ap-northeast-1
AWS_S3_BUCKET=your-video-bucket
MEDIACONVERT_ENDPOINT=https://xxxxxxx.mediaconvert.ap-northeast-1.amazonaws.com
MEDIACONVERT_ROLE_ARN=arn:aws:iam::123456789012:role/MediaConvertRole
MEDIACONVERT_WEBHOOK_SECRET=請改成隨機字串（用來做 HMAC 簽章，不是明文比對）
SES_FROM_ADDRESS=noreply@yourdomain.com

# 綠界
ECPAY_MERCHANT_ID=你的特店編號
ECPAY_HASH_KEY=你的 HashKey
ECPAY_HASH_IV=你的 HashIV
ECPAY_ACTION_URL=https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5
ECPAY_PERIODIC_ACTION_URL=https://payment-stage.ecpay.com.tw/CreditDetail/DoAction
ECPAY_CREDIT_ACTION_URL=https://payment-stage.ecpay.com.tw/CreditDetail/DoAction

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# 給金流 callback 組網址用
API_PUBLIC_URL=https://api.yourdomain.com
WEB_PUBLIC_URL=https://yourdomain.com
```

## 測試

- **單元測試**（mock Prisma，不需要資料庫）：`npm test`，涵蓋 `playback.service.ts`（訪客上限、額度扣除）、
  `payments.service.ts`（金額計算、定期定額參數、續扣分流、取消訂閱、退款）、`videos.service.ts`（上架三步驟、刪除時清理 S3）
- **整合測試**（真正的 HTTP + Postgres）：`test/app.e2e-spec.ts`，涵蓋註冊登入、會員播放額度扣除、訪客 10 分鐘上限
  ```bash
  docker compose -f docker-compose.test.yml up -d
  DATABASE_URL=postgresql://test:test@localhost:5433/video_platform_test npx prisma db push --accept-data-loss
  DATABASE_URL=postgresql://test:test@localhost:5433/video_platform_test npm run test:e2e
  ```

## 仍建議之後補上（非阻塞性）

1. 綠界定期定額終止 API 與退款 API 的實際欄位名稱請對照當時最新官方文件再核對一次（`ecpay.util.ts` 裡有註明）
2. CI 上自動跑 `test:e2e`（目前只寫了本機手動執行的方式）
3. **正式上線前要補上真的 migration 檔案**：目前 `docker-entrypoint.sh` 用 `prisma db push` 直接把 `schema.prisma` 同步到資料庫，方便本機/測試環境快速啟動，但沒有版本化的 migration 歷史紀錄。正式環境應該對一個真的資料庫跑一次 `npx prisma migrate dev --name init` 產生 `prisma/migrations/`，之後上線流程改用 `prisma migrate deploy`

## 前端串接狀態

`video-platform.jsx` 已串接：登入、瀏覽影片、播放心跳、後台影片/分類/方案 CRUD、上傳原始檔並觸發轉檔、
訂閱方案下單、取消自動續訂、加購時數的金流下單（會員登入下拉選單裡可以直接選方案訂閱或取消續訂）。
偵測不到後端時會自動退回本機示範資料。
