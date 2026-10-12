#!/bin/bash
# 自動化驗收：涵蓋不需要真的 AWS/Stripe/綠界帳號就能測到的部分
# （會員系統、瀏覽、播放額度扣除、後台 CRUD、下單建立訂單本身）。
# 用法：docker compose up -d --build 之後，等 backend 啟動完成再執行：
#   ./scripts/smoke-test.sh
set -e
BASE="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0
COOKIE_JAR=$(mktemp)

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $desc"
    PASS=$((PASS+1))
  else
    echo "  ✗ $desc（預期 $expected，實際 $actual）"
    FAIL=$((FAIL+1))
  fi
}

echo "== 1. 基本健康檢查 =="
CODE=$(curl -s -o /tmp/categories.json -w "%{http_code}" "$BASE/categories")
check "GET /categories 回 200" 200 "$CODE"
cat /tmp/categories.json | head -c 200; echo

echo
echo "== 2. 註冊 + 登入 =="
EMAIL="smoke-$(date +%s)@example.com"
PASSWORD="Password123!"
CODE=$(curl -s -o /tmp/register.json -w "%{http_code}" -X POST "$BASE/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"煙霧測試\"}")
check "POST /auth/register 回 201" 201 "$CODE"

CODE=$(curl -s -o /tmp/login.json -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
check "POST /auth/login 回 201" 201 "$CODE"
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/login.json')).accessToken)" 2>/dev/null || \
  python3 -c "import json; print(json.load(open('/tmp/login.json'))['accessToken'])")
USER_ID=$(python3 -c "import json; print(json.load(open('/tmp/login.json'))['user']['id'])")
echo "  取得 accessToken：${TOKEN:0:20}..."

CODE=$(curl -s -o /tmp/me.json -w "%{http_code}" "$BASE/me" -H "Authorization: Bearer $TOKEN")
check "GET /me 回 200" 200 "$CODE"

echo
echo "== 3. 管理員登入 + 後台建立分類/影片（用 prisma seed 建立的帳號）=="
CODE=$(curl -s -o /tmp/admin-login.json -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}')
check "管理員登入回 201" 201 "$CODE"
ADMIN_TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/admin-login.json'))['accessToken'])")

CODE=$(curl -s -o /tmp/new-cat.json -w "%{http_code}" -X POST "$BASE/admin/categories" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"煙霧測試分類"}')
check "POST /admin/categories 回 201" 201 "$CODE"
CAT_ID=$(python3 -c "import json; print(json.load(open('/tmp/new-cat.json'))['id'])")

CODE=$(curl -s -o /tmp/new-video.json -w "%{http_code}" -X POST "$BASE/admin/videos" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d "{\"title\":\"煙霧測試影片\",\"categoryId\":\"$CAT_ID\",\"durationMinutes\":10}")
check "POST /admin/videos 回 201" 201 "$CODE"
VIDEO_ID=$(python3 -c "import json; print(json.load(open('/tmp/new-video.json'))['id'])")
echo "  （這部影片 status=draft，因為沒有真的接 S3/MediaConvert，不會自動轉成 published——見下方清單）"

echo
echo "== 4. 方案列表（需要 seed 過的三個等級）=="
CODE=$(curl -s -o /tmp/tiers.json -w "%{http_code}" "$BASE/membership/tiers")
check "GET /membership/tiers 回 200" 200 "$CODE"
cat /tmp/tiers.json | head -c 300; echo

echo
echo "== 5. 訪客播放流程（用一個 status=published 的影片才測得出上限；請把種子資料裡的示範影片 ID 貼進來手動測，或看下方清單）=="
echo "  （略過自動測試：需要一個真的 published 影片，seed 資料裡有一部「深夜食堂」可以用）"

echo
echo "== 6. 建立加購時數訂單（走綠界，不需要真的完成付款也能建立訂單本身）=="
CODE=$(curl -s -o /tmp/order.json -w "%{http_code}" -X POST "$BASE/payments/orders" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"extra_hours","hours":10,"gateway":"ecpay"}')
check "POST /payments/orders 回 201" 201 "$CODE"
cat /tmp/order.json | python3 -m json.tool | head -20

echo
echo "=================================="
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
