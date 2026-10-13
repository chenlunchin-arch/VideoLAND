# 路線 C 執行計畫：把後端檔案搬到 repo 根目錄

**目的**：讓 Zeabur 的「任意 Git」模式能在**根目錄**直接找到 `Dockerfile`，
繞過 GitHub App 授權與 Root Directory 設定反覆失敗的問題。

**執行前狀態**：`git` 乾淨，HEAD = `39195ff`，與遠端同步。

---

## 為什麼要這樣做（問題根源）

| 模式 | 支援 Root Directory | 你的狀況 |
|---|---|---|
| 任意 Git | ❌ 不支援 | 已能讀到 repo（分支 `main` 有顯示），但只在根目錄找 Dockerfile |
| GitHub 儲存庫 | ✅ 支援 | Zeabur 端持續顯示「找不到任何儲存庫」／`gitURL is required` |

「任意 Git」模式**不需要 GitHub 授權**——它用匿名讀取公開 repo，這條路已經通了。
唯一障礙是 `Dockerfile` 在 `backend/` 子目錄。

→ 把檔案搬到根目錄，這條路就完全打通。

---

## 改動計畫

### 步驟 1：搬移檔案（用 `git mv` 保留歷史）

把 `backend/` 底下**所有項目**搬到 repo 根目錄：

```
backend/Dockerfile            → Dockerfile
backend/package.json          → package.json
backend/src/                  → src/
backend/prisma/               → prisma/
backend/test/                 → test/
backend/scripts/              → scripts/
backend/.env.example          → .env.example
backend/.gitignore            → .gitignore（需合併，見步驟 3）
backend/.dockerignore         → .dockerignore
backend/nest-cli.json         → nest-cli.json
backend/tsconfig.json         → tsconfig.json
backend/tsconfig.build.json   → tsconfig.build.json
backend/docker-compose.yml    → docker-compose.yml
backend/docker-compose.test.yml → docker-compose.test.yml
backend/docker-entrypoint.sh  → docker-entrypoint.sh
backend/package-lock.json     → package-lock.json
backend/ACCEPTANCE_CHECKLIST.md → ACCEPTANCE_CHECKLIST.md
backend/README.md             → README.md（會與現有根目錄 README.md 衝突）
backend/ZEABUR_ENV_GUIDE.md   → ZEABUR_ENV_GUIDE.md
```

**已確認無檔名衝突**（除了 `README.md`，見下方注意事項）。

### 步驟 2：修正 CI（6 處）

**`.github/workflows/backend-ci.yml`**

| 行 | 現在 | 改成 |
|---|---|---|
| 7 | `- 'backend/**'` | `- '**'` |
| 11 | `- 'backend/**'` | `- '**'` |
| 19 | `working-directory: backend` | **整行刪除** |
| 41 | `cache-dependency-path: backend/package-lock.json` | `cache-dependency-path: package-lock.json` |

**`.github/workflows/backend-deploy.yml`**

| 行 | 現在 | 改成 |
|---|---|---|
| 12 | `- 'backend/**'` | `- '**'` |
| 34 | `context: ./backend` | `context: .` |

（第 36、47 行的 `backend` 是 image 名稱與註解，**不用改**。）

### 步驟 3：處理 `.gitignore`

根目錄目前**沒有** `.gitignore`。搬過來的 `backend/.gitignore` 內容為：

```
node_modules
dist
dist-seed
.env
.env.*
!.env.example
*.log
```

**這份規則移到根目錄後仍然全部適用**（`frontend/` 底下也有自己的 `.gitignore`，不受影響）。

⚠️ **關鍵**：搬移後 `.env.zeabur.raw` 的忽略規則必須繼續生效。
目前規則是 `backend/.gitignore` 的 `.env.*`，搬到根目錄後變成全域 `.env.*`，
**仍然會擋下** `backend/.env.zeabur.raw`（如果它還在）以及新的 `/.env.zeabur.raw`。
**我會在步驟 6 逐項驗證，確保金鑰檔不會被推到公開 repo。**

### 步驟 4：`.dockerignore` 需擴充

搬移到根目錄後，Docker build context 變成**整個 repo**，
原本的 `.dockerignore` 只擋 6 項，**現在必須把 `frontend/`、`legal/` 及其他非後端內容排除**，
否則 image 會多打包幾十 MB 的無關檔案。

新的 `.dockerignore`：

```
node_modules
dist
dist-seed
.env
.env.*
!.env.example
*.log
.git
.github
frontend
legal
video-platform.jsx
*.md
```

### 步驟 5：commit + push

- commit 訊息說明結構調整與原因
- **push 需要你的憑證**（與上次相同，我無法代輸入）

### 步驟 6：驗證（逐項確認）

推送後我會驗證：

1. `https://raw.githubusercontent.com/.../main/Dockerfile` → **200**
2. `.../main/package.json` → **200**
3. `.../main/src/main.ts` → **200**
4. CI workflow 的 `backend/**` 引用已全部清除
5. **`.env.zeabur.raw` 未被推送**（最重要）
6. `frontend/` 保持原狀、內容未變

---

## 需要你知道的代價

### 1. 目錄結構變得不對稱

```
VideoLAND/
├── Dockerfile          ← 後端在根目錄
├── src/
├── prisma/
├── package.json
├── frontend/           ← 前端在子目錄
├── legal/
└── video-platform.jsx
```

前後端混在同一層，**視覺上不整齊，但功能完全正常**。這是為了配合 Zeabur「任意 Git」模式的限制。

### 2. `README.md` 衝突處理

根目錄已有一個 `README.md`（11 bytes，內容是佔位），`backend/README.md`（6650 bytes，是真文件）。

**處理方式**：把 `backend/README.md` 的內容**覆蓋**根目錄的佔位版。理由：佔位版沒有保留價值，真文件有。

### 3. Git 歷史

用 `git mv` 搬移，檔案的修改歷史會保留（GitHub 能追蹤 rename）。
但這仍是一次大規模結構變動，**之後如果要改回 `backend/` 結構會很麻煩**。

### 4. CI 行為改變

`backend-ci.yml` 的 `paths` 從 `backend/**` 改成 `**` 後，
**任何 push 都會觸發後端 CI**（包含改前端檔案）。

**影響**：CI 跑得比較頻繁。若在意，可以改成明確列出後端相關路徑，
但那會讓設定變得複雜且容易漏。**建議先接受，之後有需要再優化。**

---

## 執行順序

```
1. git mv 搬移所有檔案
2. 修正 backend-ci.yml（4 處）
3. 修正 backend-deploy.yml（2 處）
4. 處理 .gitignore（搬到根目錄）
5. 擴充 .dockerignore
6. 覆蓋 README.md
7. 完整稽核（金鑰、路徑、行尾、權限）
8. commit
9. push（需你輸入憑證）
10. 遠端驗證
```

---

## 風險與回復方式

**風險**：搬移後若發現問題，回復成本較高。

**回復方式**：本地 commit 在 `39195ff`。
若需退回，`git reset --hard 39195ff` 即可完全還原（但已修改的未 commit 內容會遺失）。

**最壞情況**：遠端已被 force push 覆蓋。
遠端舊版 commit 是 `c0f9326`，仍可從 GitHub 的 reflog 或 commit 頁面找到，不會永久消失。

---

## 核准

使用者已於 2026-10-13 07:48 指示「執行 C」。
本計畫在執行前完整列出，若有任何一項要調整，我停下來等指示。
