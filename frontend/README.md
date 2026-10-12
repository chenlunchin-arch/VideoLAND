# 影窩 StreamNest — 前端

Vite + React 專案，接前面 `backend/` 那組 API。

## 開發

```bash
npm install
cp .env.example .env   # 指向你的後端網址
npm run dev
```

打開 http://localhost:5173

## 建置

```bash
npm run build
```

輸出在 `dist/`，是純靜態檔案，丟到任何靜態網站託管（Vercel、Netlify、GitHub Pages、S3+CloudFront 都可以）就能上線。

## 播放器

`src/App.jsx` 裡的 `PlayerModal` 已經接上真的 [hls.js](https://github.com/video-dev/hls.js)：
- 拿到後端回傳的 `playbackUrl`（一段 HLS manifest 網址）後，用 `hls.js` 載入播放
- Safari 原生支援 HLS，會自動走原生播放，不特別載入 hls.js
- 播放器用瀏覽器原生 `<video controls>`，不是自己刻的假播放器

## 環境變數

```
VITE_API_BASE_URL=https://api.yourdomain.com
```

部署到 Vercel/Netlify 時，記得在它們的後台設定同樣的環境變數（Vite 會在建置時把它烤進靜態檔案裡，所以改了要重新建置）。
