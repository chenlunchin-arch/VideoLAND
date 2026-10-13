# Zeabur 環境變數填寫對照表

專案：`D:\software\影音平台部署\video-platform-full\backend`
產出時間：2026-10-12
依據：`.env.example`、`src/**` 原始碼實際引用情形、`DEPLOY_FIREBASE_ZEABUR.md`

---

## 一、可以直接貼的檔案

**`backend/.env.zeabur.raw`** — 若 Zeabur 的環境變數頁有「Raw / 原始編輯」模式，把這個檔案的內容
整份複製貼上，再把不能用的佔位字串改掉即可。

貼之前必做兩件事：

1. 把 `<你的網域>` 全部換成真正買的網域，例如 `example.com` → `https://api.example.com`。
   **不是照字面打。**
2. 搜尋 `<<<` 找到所有待補項目；沒有對應後台帳號的，先把值留空（**連 `<<<...>>>` 一起刪掉**，
   不要留佔位文字，否則程式會把它當成真值）。

若介面沒有 Raw 模式，就照下面第二節的表，一格一格新增。

---

## 二、變數對照表

「程式實際是否讀取」這一欄是掃描 `backend/src/**/*.ts` 的結果，不是照抄 `.env.example`。

| # | 變數 | 填什麼 | 來源 | 必填 | 程式實際讀取 |
|---|---|---|---|---|---|
| 1 | `DATABASE_URL` | Zeabur Postgres 連線字串 | Zeabur PostgreSQL 服務 → 連線資訊 | **是** | 是（Prisma datasource） |
| 2 | `JWT_SECRET` | ✅ 本次已產生 | 下方第三節，或自行 `openssl rand -hex 32` | **是** | 是（`auth.service`、`auth.guard`、`identity.decorator`） |
| 3 | `API_PUBLIC_URL` | `https://api.<你的網域>` | 你的網域 | **是** | 是（組金流 ReturnURL） |
| 4 | `WEB_PUBLIC_URL` | `https://app.<你的網域>` | 你的網域 | **是** | 是（Stripe success/cancel URL） |
| 5 | `PORT` | `3000` | 固定值 | 建議填 | 是（`main.ts` `process.env.PORT \|\| 3000`） |
| 6 | `AWS_REGION` | `ap-northeast-1`（或你選的區） | AWS | 是（要轉檔時） | 是（S3 / MediaConvert / SES client） |
| 7 | `AWS_ACCESS_KEY_ID` | IAM 存取金鑰 ID | AWS IAM | 是（要轉檔時） | **否**（見第四節 D1） |
| 8 | `AWS_SECRET_ACCESS_KEY` | IAM 存取金鑰 | AWS IAM | 是（要轉檔時） | **否**（見第四節 D1） |
| 9 | `AWS_S3_BUCKET` | bucket 名稱 | AWS S3 | 是（要轉檔時） | 是（`videos/s3.util.ts`） |
| 10 | `CLOUDFRONT_DOMAIN` | `https://dxxxx.cloudfront.net` | AWS CloudFront | 是（要播放時） | 是（`playback/cloudfront-signer.ts`） |
| 11 | `MEDIACONVERT_ENDPOINT` | 帳號專屬端點 | `aws mediaconvert describe-endpoints` | 是（要轉檔時） | 是（`videos/mediaconvert.util.ts`） |
| 12 | `MEDIACONVERT_ROLE_ARN` | IAM 角色 ARN | AWS IAM | 是（要轉檔時） | 是（`videos/mediaconvert.util.ts`） |
| 13 | `MEDIACONVERT_WEBHOOK_SECRET` | ✅ 本次已產生 | 下方第三節，**不可與 JWT_SECRET 共用** | 是（要轉檔時） | 是（`mediaconvert-webhook.controller.ts`） |
| 14 | `SES_FROM_ADDRESS` | `noreply@<你的網域>` | AWS SES 已驗證寄件地址 | 否（寄信會靜默失敗） | 是（`notifications/email.service.ts`） |
| 15 | `ECPAY_MERCHANT_ID` | 綠界測試特店編號 | 綠界測試後台 | 否（不用綠界可空） | 是（`payments/ecpay.util.ts`） |
| 16 | `ECPAY_HASH_KEY` | 綠界測試 HashKey | 綠界測試後台 | 否 | 是 |
| 17 | `ECPAY_HASH_IV` | 綠界測試 HashIV | 綠界測試後台 | 否 | 是 |
| 18 | `ECPAY_ACTION_URL` | 已給測試環境值 | `.env.example` 內建 | 否 | 是 |
| 19 | `ECPAY_PERIODIC_ACTION_URL` | 已給測試環境值 | 同上 | 否 | 是（終止定期定額） |
| 20 | `ECPAY_CREDIT_ACTION_URL` | 已給測試環境值 | 同上 | 否 | 是（信用卡退款） |
| 21 | `STRIPE_SECRET_KEY` | `sk_test_...` | Stripe Dashboard → Test mode → API 金鑰 | 否 | 是（`payments.service.ts`） |
| 22 | `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe Dashboard → Webhook 端點 | 否 | 是（驗簽章） |
| 23 | `SENTRY_DSN` | 留空 | Sentry（選填） | 否 | 是（`main.ts`，留空＝自動停用） |
| 24 | `SENTRY_TRACES_SAMPLE_RATE` | `0` | 選填 | 否 | 是（只在有 DSN 時生效） |
| 25 | `NODE_ENV` | `production` | 固定值 | 建議填 | 是（Sentry environment） |

### 只在前端用到的變數

`VITE_API_BASE_URL` 是**前端**建置期變數，屬於 Firebase Hosting，**不要填進 Zeabur 後端**：

```
VITE_API_BASE_URL=https://api.<你的網域>
```

填在 `frontend/.env.production`（`cp frontend/.env.example frontend/.env.production` 後編輯），
再 `npm run build`。前端程式是 `import.meta.env.VITE_API_BASE_URL`，Zeabur 上的同名變數對它完全無效。

---

## 三、本次已產生的兩組金鑰

以 `openssl rand -hex 32` 產生，各 64 字元十六進位，已驗證為合法 hex 且兩者不同。

> **實際值不寫在這份文件裡。** 這份文件會進 Git（`VideoLAND` 是 public repo），
> 所以金鑰只存放在本地未追蹤的 `backend/.env.zeabur.raw`，該檔已由 `.gitignore` 排除。
> 需要值時直接開那個檔複製。

產生方式（要自己重做一組時）：

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # MEDIACONVERT_WEBHOOK_SECRET（務必另外跑一次，不可共用）
```

**這兩串是機密。** 一旦填入 Zeabur 就不要再貼到對話、截圖或 commit 進 Git。
若懷疑外洩，重新產生一組並更新環境變數（`JWT_SECRET` 換掉會讓所有已登入使用者的 token 立即失效，
這是預期行為；`MEDIACONVERT_WEBHOOK_SECRET` 換掉要同步更新 EventBridge 那邊的簽章設定）。

---

## 四、容易出錯的地方（含讀程式碼後發現的實際問題）

### 4.1 `DATABASE_URL` 要用內網連線字串

Zeabur 的 PostgreSQL 通常提供兩種連線字串：內部（`*.zeabur.internal` 之類）與對外公開。
**後端服務請用內部那組**，因為：

- 對外那組可能要求 SSL，而 Prisma 預設連線參數不一定帶 `sslmode`，會出現
  `self signed certificate in certificate chain` 或 `ECONNREFUSED`。
- 走內網延遲較低，且不佔用對外連線數配額。

若一定要用對外字串，網址後面補 `?sslmode=require`（Prisma 對 `sslmode=require` 的處理與 libpq
不同，若仍失敗改用 `?sslmode=no-verify` 測試，但**正式環境不建議關閉驗證**）。

### 4.2 值不要加引號、不要留空白

`API_PUBLIC_URL=https://api.example.com` ✅
`API_PUBLIC_URL="https://api.example.com"` ❌
`API_PUBLIC_URL= https://api.example.com` ❌

後兩者程式讀到的字串會帶引號或前導空白，直接導致：

- 綠界 `ReturnURL` 變成無效網址 → 付款成功但 **webhook 永遠收不到**，訂單卡在 `pending`。
- Stripe `success_url` / `cancel_url` 變成無效網址 → 付款完成後使用者看到 404。

### 4.3 `PORT` 必須與 Zeabur 對外埠一致

`main.ts` 是 `app.listen(process.env.PORT || 3000)`，`Dockerfile` 有 `EXPOSE 3000`。
Zeabur 服務的「對外埠」設定要填 `3000`，否則會出現「部署成功但連不上」。

### 4.4 兩個 secret 絕對不可共用

| 變數 | 外洩後果 |
|---|---|
| `JWT_SECRET` | 任何人可偽造任意使用者的登入 token，等同全站帳號遭接管 |
| `MEDIACONVERT_WEBHOOK_SECRET` | 任何人可偽造轉檔完成通知，任意把未轉檔的影片標成 `published` |

共用會讓任一處外洩的影響半徑直接擴大到另一處。

### 4.5 `SENTRY_DSN` 留空是安全的

`main.ts` 第 11 行是 `if (process.env.SENTRY_DSN) { Sentry.init(...) }`，
空字串會走 falsy 分支不初始化；`SentryExceptionFilter` 在未 init 狀態下呼叫
`captureException` 是安全的 no-op。**留空不會讓啟動失敗**，可以放心空著。

### 4.6 綠界 / Stripe 測試模式的 URL 要成對

`.env.example` 內建的 `ECPAY_ACTION_URL` 是 `payment-stage.ecpay.com.tw`（測試環境）。
**不要只改 `ECPAY_MERCHANT_ID` 成正式特店、卻忘了換 `ECPAY_ACTION_URL`**，
否則會把正式特店編號送到測試環境，回傳 `MerchantID 錯誤`。
正式上線時三個 `ECPAY_*_ACTION_URL` 都要改成 `payment.ecpay.com.tw`。

### 4.7 ⚠ 讀程式碼發現：AWS 金鑰變數目前是無效的

`.env.example` 列了 `AWS_ACCESS_KEY_ID` 與 `AWS_SECRET_ACCESS_KEY`，
但掃描 `src/**/*.ts` 的結果是 **0 次引用**。

原因是三個 AWS 客戶端都只傳了 `region`（與 `endpoint`），憑證走 SDK 預設的環境變數鏈，
而 SDK 只認得 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` **確實是這兩個名字**——
所以填了在語法上是對的，只是程式碼沒有明確讀取，屬於「靠 SDK 隱式生效」。

這代表兩件事：

1. 填這兩個變數**不是錯的**，SDK 會自動撿起來用。
2. 但如果 Zeabur 上沒填，SDK 也找不到其他憑證來源，**執行期才會在呼叫 S3 時拋錯**
   （`CredentialsProviderError: Could not load credentials from any providers`），
   而不是啟動時就擋下來。這種錯要等到管理員上傳第一支影片時才會發現。

**更好的做法**：正式環境掛 IAM 角色／執行個體設定檔，而不是把長期金鑰放進環境變數。
若 Zeabur 不支援，退而求其次至少用 IAM 子帳號並只授予 S3 + MediaConvert + SES 最小權限。

### 4.8 ⚠ 程式碼發現：CloudFront 網址簽章是 TODO 佔位

`src/playback/cloudfront-signer.ts` 目前是：

```ts
return `${base}/hls/${videoId}/master.m3u8?expires=${expires}&signature=TODO`;
```

**`signature=TODO` 是寫死的佔位字串**，不是真的 CloudFront 簽章。意思是：

- 播放網址的權限控制目前**沒有實際生效**。
- 若 CloudFront 有開啟「限制檢視者存取」，這個網址會直接被拒絕（403）。
- 若沒開啟，那任何拿到網址的人都能無限期觀看，付費會員制度形同虛設。

檔頭註解已經寫明「實際部署時改用 `@aws-sdk/cloudfront-signer` 套件，用
`CLOUDFRONT_PRIVATE_KEY` 對 HLS manifest 網址簽章」——但 `CLOUDFRONT_PRIVATE_KEY`
**沒有出現在 `.env.example` 裡**，所以未來補上時記得也要新增這個變數（多行 PEM，
貼進 Zeabur 時要保留換行，通常需要 base64 編碼後存放再在程式裡解碼）。

**這件事不影響本次部署能不能啟動**，但會影響「影片能不能真的被限制觀看」。
建議在真的開始收費前處理。

---

## 五、部署後驗證步驟

1. 存檔後 Zeabur 會自動重新部署。
2. 到服務頁的 Log 看啟動訊息，正確順序應為：

```
等待資料庫連線...
資料庫結構同步完成
執行種子資料...
種子資料建立完成。管理員帳號：admin@example.com / ChangeMe123!（請上線前務必更改）
啟動伺服器...
[Nest] ... Nest application successfully started
```

3. 若卡在「等待資料庫還沒 ready，3 秒後重試」，代表 `DATABASE_URL` 有問題
   （見 4.1）。`docker-entrypoint.sh` 是無限重試迴圈，**不會失敗退出，只會一直轉**，
   所以「部署中」卡住超過 2 分鐘基本上就是這個原因。
4. 驗證 API：

```bash
curl -s https://api.<你的網域>/categories
curl -s https://api.<你的網域>/membership/tiers
```

應回傳 JSON 陣列。

5. **立刻登入後台改掉預設管理員密碼** `admin@example.com` / `ChangeMe123!`。
   種子資料的 `upsert` 是 `update: {}`，**重啟不會重置密碼**，但只要還沒改，這就是公開的後門。

---

## 六、貼 Log 時的建議

把 Log 整段貼出來（或截圖）比只貼錯誤那行好判斷，特別是要看：

- 有沒有 `資料庫結構同步完成`
- 有沒有 `Nest application successfully started`
- 錯誤是 `Prisma` 拋的（資料庫）還是 `Nest` 拋的（程式）還是完全沒訊息（網路／埠）

**注意**：Zeabur Log 有時會把環境變數值印出來。貼之前請確認沒有把
`JWT_SECRET`、`DATABASE_URL`（含密碼）、`STRIPE_SECRET_KEY` 的實際值一起貼出來。
