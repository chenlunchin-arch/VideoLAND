#!/bin/sh
set -e

echo "等待資料庫連線..."
until npx prisma db push --accept-data-loss --skip-generate 2>/tmp/migrate.log; do
  echo "資料庫還沒 ready，3 秒後重試..."
  cat /tmp/migrate.log
  sleep 3
done
echo "資料庫結構同步完成"

# 只在第一次啟動（還沒有任何方案資料）時 seed，避免每次重啟都重複建立
SEED_MARKER=/app/.seeded
if [ ! -f "$SEED_MARKER" ]; then
  echo "執行種子資料..."
  node dist-seed/seed.js || echo "seed 失敗或已經 seed 過，略過"
  touch "$SEED_MARKER"
fi

echo "啟動伺服器..."
exec node dist/main.js
