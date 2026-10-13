# 完整驗收清單

分成兩塊：**A. 一個指令 + 自動化腳本就能測**（不需要任何第三方帳號），
**B. 需要真的（但免費的）測試帳號才能測到底**（付款完成、影片轉檔、寄信）。

---

## A. 自動化部分（不需要 AWS/Stripe/綠界帳號）

```bash
cd backend
cp .env.example .env
# .env 裡 AWS/STRIPE/ECPAY 那些先留假值即可，不影響下面這些測試
docker compose up -d --build
# 等大約 10~20 秒讓 migration/seed 跑完，可以用這個確認：
docker compose logs -f backend   # 看到「啟動伺服器...」代表準備好了，Ctrl+C 離開 log

./scripts/smoke-test.sh
```

這個腳本會自動驗證：
- 分類/影片瀏覽 API 正常回應
- 註冊、登入、`/me` 正常運作
- 種子資料建立的管理員帳號可以登入，後台建立分類/影片正常（`POST /admin/categories`、`POST /admin/videos`）
- 三個等級的方案資料存在（`GET /membership/tiers`）
- 建立加購時數訂單本身可以成功（`POST /payments/orders`，回傳綠界表單參數）

全部綠色 `✓` 代表核心會員系統、資料庫層、播放額度的資料模型都是通的。

**額外手動測一項（不需要第三方帳號，但腳本沒自動化）**：訪客播放上限。

```bash
# 種子資料裡有一部「深夜食堂」，先查出它的 id：
curl -s http://localhost:3000/videos | python3 -m json.tool | grep -A2 深夜食堂

# 開始播放（記得帶 -c/-b 存取 cookie，模擬同一個訪客裝置）
curl -s -c /tmp/guest.txt -X POST http://localhost:3000/playback/sessions \
  -H "Content-Type: application/json" -d '{"videoId":"<上面查到的 id>"}'
# 回傳的 sessionId 記下來，然後每隔幾秒送一次心跳，觀察 remainingMinutes 遞減：
curl -s -b /tmp/guest.txt -X POST http://localhost:3000/playback/sessions/<sessionId>/heartbeat
```

---

## B. 需要真的測試帳號的部分

這幾項各自獨立，缺哪個就只有那個功能測不到，不影響其他部分。

### B1. Stripe（完整付款流程，5 分鐘可以拿到測試金鑰）

1. 免費註冊 https://dashboard.stripe.com/register（不用真的營業資料，測試模式不需要審核）
2. 左上角切到 **Test mode**，「開發人員」→「API 金鑰」複製 `sk_test_...` 填進 `.env` 的 `STRIPE_SECRET_KEY`
3. 「開發人員」→「Webhook」，新增端點指向 `https://<你的公開網址>/payments/stripe/webhook`（本機測試可以用 `stripe listen --forward-to localhost:3000/payments/stripe/webhook`，Stripe CLI 免費下載），拿到的 `whsec_...` 填進 `STRIPE_WEBHOOK_SECRET`
4. 重啟 `docker compose restart backend`
5. 呼叫 `POST /payments/orders`，`gateway` 填 `stripe`，用回傳的 `url` 開瀏覽器完成付款，測試卡號固定是 `4242 4242 4242 4242`（任何未來日期、任何 CVC）
6. 付款完成後檢查資料庫：`docker compose exec postgres psql -U video_platform -c "select * from \"Order\";"`，應該看到該筆訂單 `status = paid`

### B2. 綠界（ECPay）

綠界公開提供測試特店資料，不用申請正式商店就能測：
1. 到 https://developers.ecpay.com.tw/ 註冊測試（廠商）後台帳號，登入拿到你自己的測試用 `MerchantID`、`HashKey`、`HashIV`（每個測試帳號拿到的值不同，官方文件的頁面上會顯示）
2. 填進 `.env` 的 `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV`
3. `POST /payments/orders`，`gateway` 填 `ecpay`，把回傳的 `action` + `params` 組成表單送出（前端 `video-platform.jsx` 已經有 `submitEcpayForm` 會自動做這件事）
4. 測試信用卡卡號綠界文件上有公告（測試環境專用，不是真卡）
5. 完成付款後，`docker compose logs backend` 應該看到 webhook 進來的紀錄，資料庫訂單狀態變成 `paid`

### B3. AWS（S3 上傳 + MediaConvert 轉檔 + SES 寄信）

這三個都在同一個 AWS 帳號底下，會員資格內有 12 個月免費額度：
1. 建一個 S3 bucket，填進 `AWS_S3_BUCKET`
2. IAM 建一個有 S3 + MediaConvert 權限的角色，ARN 填進 `MEDIACONVERT_ROLE_ARN`
3. 執行一次 `aws mediaconvert describe-endpoints`（裝 AWS CLI 並設定好 access key）拿到你帳號專屬的 MediaConvert endpoint，填進 `MEDIACONVERT_ENDPOINT`
4. SES 預設在 Sandbox 模式，寄件地址跟收件地址都要先各自驗證過（Console 裡「Verified identities」），才收得到 `SES_FROM_ADDRESS` 寄出的信
5. 用管理員帳號呼叫 `GET /admin/videos/:id/upload-url?filename=test.mp4`，把回傳的 `uploadUrl` 拿去 `curl -X PUT --data-binary @test.mp4 "<uploadUrl>"` 上傳一個小測試影片
6. `POST /admin/videos/:id/start-transcode` 觸發轉檔，MediaConvert 主控台可以看到 Job 在跑，跑完後要另外設定 EventBridge 規則把 Job 完成通知打到 `/webhooks/mediaconvert`（見 README「尚待補上」那段，這條 EventBridge 規則需要你自己在 AWS 主控台設定，程式碼只寫了接收端）

---

## 如果你只想先驗證「這個東西到底能不能跑起來」

只做 A 段落就足夠：五分鐘裝好 Docker，一個指令，全綠燈就代表整個後端骨架（會員、影片管理、播放計時、下單建立訂單）是通的。B 段落是「產品要正式上線」才需要逐一接通的外部服務，不影響你判斷程式碼本身的完整性。
