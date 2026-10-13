# 路線 C 完成，請執行推送

狀態：**本地已 commit，待推送。**
commit：`2c42226`「Move backend files to repo root for Zeabur deployment」
（前一版 `d51170f` 已備份在分支 `route-c-backup-d51170f`）

---

## 你要執行的指令

```cmd
cd /d "D:\software\影音平台部署\video-platform-full"
git push --force origin main
```

（記得 `cd /d`，上次 CMD 沒切磁碟機就是漏了這個）

會跳出 Git Credential Manager 要求登入，跟上次一樣。

---

## 為什麼 commit 從 d51170f 換成 87520b8

第一次推送被 GitHub 拒絕：

```
! [remote rejected] main -> main
  (refusing to allow a Personal Access Token to create or update workflow
   `.github/workflows/backend-ci.yml` without `workflow` scope)
```

你的 PAT **沒有 `workflow` 權限**，而本次改動包含
`.github/workflows/backend-ci.yml` 與 `backend-deploy.yml`，
GitHub 一律拒收整筆推送。

**排除法處理**：把這兩個 workflow 檔案從提交中撤出（恢復成遠端版本），
其餘 65 個檔案照推。這樣就不觸發 workflow scope 檢查。

| 版本 | 內容 | 檔案數 |
|---|---|---|
| `d51170f` | 含 workflow 修改 | 67 |
| `87520b8` | **不含 workflow 修改** | 65 |

> workflow 檔案仍停在舊路徑設定（`backend/**`），
> **這對 Zeabur 部署零影響** —— Zeabur 只讀 `Dockerfile`，不看 GitHub Actions。
> 等你有空把 PAT 補上 `workflow` 權限後，再推分支
> `route-c-backup-d51170f` 即可（或用 `git cherry-pick` 那個 commit）。

---

## 這次改了什麼

把 `backend/` 底下 19 個項目、62 個檔案搬到 repo 根目錄，`backend/` 目錄已移除。

```
改動前                          改動後
VideoLAND/                      VideoLAND/
├── backend/                    ├── Dockerfile      ← 搬上來了
│   ├── Dockerfile              ├── package.json
│   ├── src/                    ├── src/
│   └── ...                     ├── prisma/
├── frontend/                   ├── frontend/       ← 不動
├── legal/                      ├── legal/
└── video-platform.jsx          └── video-platform.jsx
```

**目的**：Zeabur 的「任意 Git」模式不支援根目錄設定，只能在 repo 根目錄找
`Dockerfile`。搬上來之後，這個模式（已能正常匿名讀取你的公開 repo、
成功讀到分支 `main`）就能直接部署——**完全繞過 GitHub App 授權那關**。

---

## 為什麼放棄修授權

授權那條路試了四輪都失敗：

| 嘗試 | 錯誤訊息 |
|---|---|
| 任意 Git + 分支填 `backend` | `Dockerfile is required for arbitrary Git sources` |
| 任意 Git + 分支 `main` | 分支對了，但這模式沒有根目錄欄位 |
| 切「GitHub 儲存庫」 | `找不到任何儲存庫。請設定 GitHub 應用程式` |
| 再切一次 | `gitURL is required for arbitrary git service` |

第三、四輪的錯誤顯示 Zeabur 端的前端狀態一直不同步。
而「任意 Git」模式**本來就不需要授權**，所以與其繼續纏鬥，不如讓它變成唯一選項。

---

## 順帶修掉的三件事

### 1. CI 設定（**這部分已撤出本次提交**）

`backend-ci.yml` 的 `paths` 從 `backend/**` 改為**明確列出**後端相關路徑：

```yaml
paths:
  - 'src/**'
  - 'prisma/**'
  - 'test/**'
  - 'scripts/**'
  - 'package.json'
  - 'package-lock.json'
  - 'tsconfig*.json'
  - 'nest-cli.json'
  - 'Dockerfile'
  - 'docker-entrypoint.sh'
```

**刻意不用 `**`** —— 那樣會變成「改任何檔案都跑後端 CI」，包含改前端。
列舉雖然長，但語意精確。

同時刪掉 `working-directory: backend`、修正 `cache-dependency-path`。

`backend-deploy.yml` 的 `context: ./backend` 改成 `.`。

> 注意：workflow 裡 `ghcr.io/.../backend:latest` 的 `backend` **保留沒改** ——
> 那是 image 名稱，不是路徑。

### 2. `.dockerignore` 必須擴充（這個漏了會很浪費）

搬移後 Docker build context 變成**整個 repo**。原本只擋 6 項，現在補上：

```
frontend
legal
video-platform.jsx
*.md
.github
```

不補的話，image 會多打包前端（含 `package-lock.json` 88KB）和其他無關檔案。

### 3. `Dockerfile` 和 `docker-compose.yml` 完全不用改

我檢查過，兩個檔內部**全是相對路徑**（`COPY package*.json ./`、`build: .`、
`env_file: .env`），搬到哪都一樣能跑。這是這次搬移風險低的主因。

---

## 推送前我已完成的驗證

| 檢查項 | 結果 |
|---|---|
| 61 個檔案以 `git mv` 搬移，歷史保留 | ✓ |
| `Dockerfile`、`docker-entrypoint.sh`、`package.json` 在根目錄 | ✓ |
| 行尾（5 個關鍵檔） | 全部 CR=0 ✓ |
| 執行權限 | `docker-entrypoint.sh`、`smoke-test.sh` 皆 100755 ✓ |
| `.env.zeabur.raw` 被 `.gitignore` 擋下 | ✓ |
| 內容掃描有無真實金鑰 | 無 ✓ |
| 本次提交不含 `.github/workflows/**` | ✓（避免 workflow scope 拒收） |
| 4 個 YAML 語法（用 PyYAML 實際解析） | 全部通過 ✓ |

---

## 推送後怎麼驗證

```cmd
curl -s -o NUL -w "%{http_code}\n" https://raw.githubusercontent.com/chenlunchin-arch/VideoLAND/main/Dockerfile
```

**應該回 200**（先前是 404）。

---

## 推送成功後：Zeabur 這邊怎麼做

**不用再碰 GitHub 授權了。** 直接用你現在的「任意 Git」模式：

```
設定分頁 → 來源
├─ 分頁：任意 Git
├─ 儲存庫 URL：https://github.com/chenlunchin-arch/VideoLAND
├─ 分支：main
└─ 認證方式：匿名
```

這三格**你之前就設對了**（分支 `main` 已修正）。現在根目錄有 `Dockerfile` 了，
所以直接按 **「重新部署」** 就會成功。

環境變數也已經填好（27 個）。**理論上按下去就能跑起來。**

---

## 唯一還要確認的事

部署後看「記錄」分頁的 log，預期順序：

```
等待資料庫連線...
資料庫結構同步完成                          ← 這行代表 DATABASE_URL 正確
執行種子資料...
種子資料建立完成。管理員帳號：admin@example.com / ChangeMe123!
啟動伺服器...
[Nest] ... Nest application successfully started
```

把 log 貼給我（**注意先塗掉可能被印出的環境變數值**）。

---

## 附註

- 金鑰檔備份在 `D:\software\_backup_zeabur\env.zeabur.raw.bak`
- 完整計畫文件：`PLAN_ROUTE_C.md`
- 含 workflow 修改的完整版備份：分支 `route-c-backup-d51170f`（= `d51170f`）
- 若要回復原結構：`git reset --hard 39195ff`（本地未推送前有效）
