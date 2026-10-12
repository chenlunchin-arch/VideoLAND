# GitHub Repo 現況檢查報告

Repo：https://github.com/chenlunchin-arch/VideoLAND
檢查時間：2026-10-12 23:11（GMT+8）
檢查方式：GitHub REST API + raw.githubusercontent（唯讀，未做任何修改）

---

## 一、結論摘要

**Repo 已經有程式碼了，但推上去的方式漏掉了所有 dotfile（`.` 開頭的檔案）。**

這不是小問題——`backend/.env.example` 和 `backend/.gitignore` 都不在 repo 裡，
而前者正是你這次要照著填 Zeabur 環境變數的依據，後者沒了會讓金鑰檔有被誤 commit 的風險。

| 項目 | 狀態 |
|---|---|
| Repo 存在、公開 | ✅ |
| 預設分支 | `main` |
| 最後推送 | 2026-10-10 05:34 UTC（三天前） |
| 程式碼完整性 | ⚠️ 主體在，**dotfile 全缺** |
| 機密檔誤傳 | ✅ 沒有（scanned，乾淨） |
| CI 曾經跑過成功 | ❌ Backend CI 被取消；Frontend CI 成功 |

---

## 二、缺了哪些檔案（已用完整檔案樹比對確認）

我做了逐檔比對：本地 84 個檔案、repo 78 個。差異**精確就是 5 個 dotfile**，
沒有其他遺漏：

| 檔案 | 本地 | GitHub | HTTP |
|---|---|---|---|
| `backend/.env.example` | ✅ 有 | ❌ **缺** | 404 |
| `backend/.gitignore` | ✅ 有 | ❌ **缺** | 404 |
| `backend/.dockerignore` | ✅ 有 | ❌ **缺** | 404 |
| `frontend/.env.example` | ✅ 有 | ❌ **缺** | 404 |
| `frontend/.gitignore` | ✅ 有 | ❌ **缺** | 404 |

反過來，**只在 repo、不在本地的有 2 個**（都是好事，代表本地沒有被這些覆蓋）：

- `.github/workflows/readme.txt`（內容 `JUST GO`，無作用）
- `README.md`（repo 版 11 bytes，本地版是空的佔位——不衝突）

**`.github/workflows/` 有正常進去**（4 個 yml 都在）——因為它在子目錄裡，
被當成一般目錄處理，不算「頂層 dotfile 被略過」的情況。

### 為什麼會這樣

提交訊息是決定性證據：

```
c0f93264  2026-10-10T05:34:49Z  Add files via upload      ← 網頁拖曳上傳
8429340c  2026-10-10T05:32:00Z  Delete .github directory   ← 手動刪掉再重傳
76b50359  2026-10-10T04:09:17Z  Add files via upload
17af3f19  2026-10-10T03:24:59Z  Initial commit
```

`Add files via upload` 是 GitHub 網頁介面的拖曳上傳。**該介面在 Windows 上會略過
dotfile**，這是已知行為（不只是 `.gitignore` 被擋，是整個 `.` 開頭的項目在
資料夾拖曳時不被列入）。所以你看到的畫面「檔案都傳上去了」，實際上少了 5 個檔。

---

## 三、CI 執行歷史與判讀

總共只跑過 3 次，全部在 2026-10-10 05:34（同一次 push 觸發）：

| Workflow | 結果 | 判讀 |
|---|---|---|
| Frontend CI | ✅ success | 前端程式碼沒問題 |
| Frontend Deploy (GitHub Pages) | ⚠️ cancelled | 前一個失敗連帶取消／或併發群組取消 |
| Backend CI | ❌ cancelled | **卡在 Initialize containers 就被取消** |

### Backend CI 的細節

```
Set up job                    completed  success
Initialize containers         completed  cancelled   ← 卡在這裡
Run actions/checkout@v4       completed  skipped
Run actions/setup-node@v4     completed  skipped
Install dependencies          completed  skipped
Build                         completed  skipped
Unit tests                    completed  skipped
...
Stop containers               completed  success
```

**`Initialize containers` 失敗＝PostgreSQL service container 起不來。**
`backend-ci.yml` 有設定 `services.postgres`（`postgres:16-alpine` 掛 5432 埠），
不是程式碼錯誤，是 CI runner 的基礎設施層問題——常見於 GitHub 免費 runner 資源調度延遲逾時。

而因為 `Initialize containers` 卡住，後面的 `checkout` 直接 `skipped`，
這代表**後端程式碼從來沒有在 CI 上被真正編譯或測試過**。

> 附帶一提：`.github/workflows/readme.txt` 的內容是 `JUST GO`。如果那是你留下的記號，
> 它目前沒有任何作用——GitHub Actions 只讀 `.yml` / `.yaml`。

---

## 四、這件事對 Zeabur 部署的實際影響

這是重點：**缺少 `backend/.env.example` 不影響 Zeabur 能不能部署**，因為
`Dockerfile` 的建置流程（`COPY package*.json` → `npm install` → `COPY . .` →
`prisma generate` → `npm run build`）完全不依賴任何 `.env` 檔案。
Zeabur 的環境變數是執行期從平台注入容器，不從檔案讀。

**但缺 `.gitignore` 是實質風險。** 如果之後有人（或你自己）改用 `git push` 推送、
且不小心把 `.env` 加進去，沒有 `.gitignore` 的 repo 會直接把它公開——
而 `VideoLAND` 是 **public repo**。

**我上一輪已經幫你在本地的 `backend/.gitignore` 補上正確規則了**，但那份修正
還沒進到 GitHub（因為本地這個資料夾根本不是 git repo）。這件事需要處理。

---

## 五、建議的下一步（依優先序）

### 步驟 1：換掉網頁上傳，改用真正的 git

網頁拖曳上傳會一直漏 dotfile。要在本地這個資料夾建立 git repo 並推送：

```bash
cd "D:/software/影音平台部署/video-platform-full"
git init
git add -A
git status          # 確認 .env.example / .gitignore 都在清單裡、且沒有真實 .env
git commit -m "Add missing dotfiles and sync full project"
git branch -M main
git remote add origin https://github.com/chenlunchin-arch/VideoLAND.git
git push -u origin main --force
```

> **`--force` 請先確認**：它會用本地內容覆蓋遠端歷史。若你不想覆蓋，改成
> `git pull --rebase origin main` 後再 push。這件事我可以幫你執行，但需要你先確認。

**推送前務必確認 `git status` 裡沒有真實的 `.env`**（本地目前只有 `.env.example`
和 `.env.zeabur.raw`，後者已被我加的 `.gitignore` 規則擋掉，但我會再驗一次）。

### 步驟 2：在 Zeabur 建立服務

1. 建專案，名稱用 **`videoland`**
2. 新增 **PostgreSQL** 服務
3. 新增應用服務 → 連 GitHub → 選 `chenlunchin-arch/VideoLAND`
4. **Root Directory 填 `backend`** ← 這格最常漏，漏了會找不到 `Dockerfile`
5. 環境變數照 `backend/ZEABUR_ENV_GUIDE.md` 填（或直接貼 `.env.zeabur.raw`）
6. 對外埠設 `3000`

### 步驟 3：讓我看到 log

部署後貼 log，我判斷 `Nest application successfully started` 有沒有出現。

---

## 六、附註：三個非阻塞但遲早要處理的問題

1. **Backend CI 從未真正通過**——但這**不是**因為缺檔案。
   我原本以為 `backend/test/` 沒上去，實際查證後：`backend/test/app.e2e-spec.ts`、
   `jest-e2e.json`、`rate-limit.e2e-spec.ts`、`sentry-filter.e2e-spec.ts` **四個都在 repo 裡**。
   所以檔案是齊的，純粹是 CI runner 的 `Initialize containers` 問題。
   重跑一次 workflow 很可能就過了（Actions 頁面右上角 Re-run jobs）。

2. **`frontend-deploy.yml` 依賴 `vars.VITE_API_BASE_URL`**（repo 層級變數）。
   若沒在 Settings → Secrets and variables → Actions → Variables 設定，
   建置出來的前端會指向 `http://localhost:3000`，等於上線後完全連不到後端。

3. **CloudFront 播放簽章仍是 `signature=TODO` 佔位**（我上一輪已標記）。
   不影響部署，但影響付費內容的實際保護。
