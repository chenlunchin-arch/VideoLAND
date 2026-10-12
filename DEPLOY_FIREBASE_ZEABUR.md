# 部署指南：Firebase Hosting（前端）+ Zeabur（後端 + Postgres）

## 架構

```
使用者 → app.你的網域  (Firebase Hosting，靜態前端)
              ↓ API 請求
        api.你的網域  (Zeabur：NestJS 容器 + PostgreSQL)
              ↓
        AWS S3 / MediaConvert / CloudFront（影片，仍需 AWS）
        綠界 / Stripe（金流 webhook 打回 api.你的網域）
```

前後端必須是**同一個主網域的子網域**，訪客試看用的 `guest_token` cookie 才不會被瀏覽器當第三方 cookie 擋掉。

## 一、後端（Zeabur）

1. 把專案推到 GitHub（`backend/` 與 `frontend/` 同一個 repo 即可）。
2. Zeabur 建立專案 → 新增服務 → **PostgreSQL**。
3. 同專案再新增服務 → 從 GitHub 選此 repo，**Root Directory 設為 `backend`**，Zeabur 會偵測 `Dockerfile` 建置。
4. 在後端服務的「環境變數」填入 `backend/.env.example` 列的項目：
   - `DATABASE_URL`：用 Zeabur Postgres 服務提供的連線字串（可在變數中引用該服務的變數）。
   - `JWT_SECRET`、`MEDIACONVERT_WEBHOOK_SECRET`：各產生一組隨機長字串（例如 `openssl rand -hex 32`）。
   - `API_PUBLIC_URL=https://api.你的網域`、`WEB_PUBLIC_URL=https://app.你的網域`。
5. 網路設定：對外埠 `3000`，綁定自訂網域 `api.你的網域`（照 Zeabur 指示在 DNS 加 CNAME）。
6. 部署後看 log，應出現「資料庫結構同步完成 → 種子資料建立完成 → Nest application successfully started」。
7. **立刻登入後台改掉預設管理員密碼**（`admin@example.com` / `ChangeMe123!`）。

驗證：`curl https://api.你的網域/categories` 應回傳 JSON。

## 二、前端（Firebase Hosting）

```bash
cd frontend
cp .env.example .env.production
# 編輯 .env.production：VITE_API_BASE_URL=https://api.你的網域
npm install
npm run build

npm i -g firebase-tools
firebase login
firebase init hosting     # 選現有或新 project；public 填 dist；SPA 選 Yes；不要覆蓋 index.html
firebase deploy --only hosting
```

`firebase.json` 已附在 `frontend/`。部署後到 Firebase Console → Hosting → 新增自訂網域 `app.你的網域`，照指示加 DNS 紀錄。

## 三、串接第三方（上線後）

| 項目 | 設定 |
| --- | --- |
| 綠界 | 後台付款完成通知網址 → `https://api.你的網域/payments/ecpay/webhook` |
| Stripe | Webhook endpoint → `https://api.你的網域/payments/stripe/webhook`，把 signing secret 填進 `STRIPE_WEBHOOK_SECRET` |
| MediaConvert | EventBridge API destination → `https://api.你的網域/webhooks/mediaconvert`（HMAC 簽章用 `MEDIACONVERT_WEBHOOK_SECRET`） |

## 四、注意事項

- **反向代理與限流**：`main.ts` 已設定 `trust proxy`，限流才會以真實使用者 IP 計算。
- **資料庫結構**：目前啟動時用 `prisma db push`。正式營運前請先在本機對開發資料庫跑 `npx prisma migrate dev --name init` 產生 `prisma/migrations/`，並把 `docker-entrypoint.sh` 改成 `prisma migrate deploy`，避免日後改欄位造成資料遺失。
- **跨網站 cookie**：若暫時用預設網域（`*.web.app` 對 `*.zeabur.app`），訪客 10 分鐘限制在 Safari 等瀏覽器可能失效，請盡快綁自訂網域。
- **Zeabur 介面名稱**可能與上述略有出入，以其當前介面為準。
