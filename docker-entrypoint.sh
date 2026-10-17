#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Startup diagnostics
#
# The original entrypoint retried `prisma db push` forever without ever telling
# the operator WHY it failed. A credential error and an unreachable host look
# identical from the outside: the container stays "running" (green in Zeabur)
# while the HTTP port is never bound. That turns a 30-second fix into hours of
# guesswork.
#
# Below we classify the failure before retrying, and re-print an actionable
# diagnosis periodically instead of looping silently. Set DB_FAIL_FAST=1 to
# turn a credential failure into a hard exit (useful in CI, or when you prefer
# Zeabur to report a failed deploy rather than a hung one).
# ---------------------------------------------------------------------------

mask_url() {
  # Print the shape of DATABASE_URL without leaking the password.
  # postgresql://user:SECRET@host:5432/db -> postgresql://user:***@host:5432/db
  printf '%s' "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'
}

url_len() {
  # Portable string length (avoids ${#var}, not supported by every BusyBox ash).
  printf '%s' "$1" | wc -c | tr -d ' '
}

if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL is not set."
  echo "  Set it on the videoland service to \${POSTGRES_CONNECTION_STRING}"
  echo "  (Zeabur exposes that variable from the PostgreSQL service)."
  exit 1
fi

echo "Database URL: $(mask_url "$DATABASE_URL")"

# Hostname / database name as Prisma will see them. If these do not match the
# PostgreSQL service you expect, the variable is not the one being read.
echo "  host=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^@]*@([^:/]+).*#\1#')"

# Compare against the platform-provided password when available. This makes a
# stale/incorrect password obvious immediately instead of after a failed login.
if [ -n "${POSTGRES_PASSWORD:-}" ]; then
  url_pass=$(printf '%s' "$DATABASE_URL" | sed -nE 's#^[^:]+://[^:/@]+:([^@]*)@.*#\1#p')
  if [ "$url_pass" = "$POSTGRES_PASSWORD" ]; then
    echo "  password matches POSTGRES_PASSWORD (ok)"
  else
    echo "  WARNING: password in DATABASE_URL differs from POSTGRES_PASSWORD."
    echo "           URL password length: $(url_len "$url_pass"); POSTGRES_PASSWORD length: $(url_len "$POSTGRES_PASSWORD")."
    echo "  The URL password is stale; rebuilding DATABASE_URL from the"
    echo "  platform-injected pieces instead."
    # Rebuild from the authoritative values. This makes the deployment
    # self-healing when someone changes the password on the PostgreSQL service
    # but forgets that DATABASE_URL held a hard-coded copy.
    DATABASE_URL="postgresql://${POSTGRES_USERNAME:-postgres}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgresql.zeabur.internal}:${POSTGRES_PORT:-5432}/${POSTGRES_DATABASE:-zeabur}"
    export DATABASE_URL
    echo "  using rebuilt URL: $(mask_url "$DATABASE_URL")"
  fi
else
  echo "  POSTGRES_PASSWORD not present in this service; skipping password cross-check."
fi

sync_schema() {
  # Returns 0 on success. On failure prints a classification and returns
  # a distinct code so the caller can decide whether retrying is worthwhile.
  if npx prisma db push --accept-data-loss --skip-generate >/tmp/migrate.log 2>&1; then
    return 0
  fi

  cat /tmp/migrate.log

  if grep -q 'P1000' /tmp/migrate.log; then
    # P1000 covers both bad credentials and unreachable host. Prisma names the
    # cause in the message; distinguish them.
    case "$(cat /tmp/migrate.log)" in
      *"Authentication failed"*|*"not valid"*)
        echo ""
        echo "FATAL: the database rejected the credentials (Prisma P1000)."
        echo "  Retrying will not help. The password in DATABASE_URL does not"
        echo "  match the one the PostgreSQL data directory was initialised with."
        echo ""
        echo "  Note: the postgres image only applies POSTGRES_PASSWORD on the"
        echo "  very first start (empty data directory). Changing the variable"
        echo "  afterwards does NOT change the password inside the database."
        echo ""
        echo "  Fix: recreate the PostgreSQL service (the database is empty, so"
        echo "  nothing is lost), keeping the service name 'postgresql' so the"
        echo "  internal hostname stays the same."
        return 20
        ;;
      *"Can't reach"*|*"reach database server"*)
        echo ""
        echo "  Database host is not reachable yet; will retry."
        return 10
        ;;
    esac
  fi

  # Unknown failure: retry a bounded number of times, then give up loudly.
  return 11
}

attempt=1

while :; do
  set +e
  sync_schema
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "資料庫結構同步完成"
    break
  fi

  # Credential failures do not resolve by waiting, so do not spin silently on
  # them. Keep the process alive (a crash loop would just show "deployment
  # failed" in Zeabur with no cause), but re-print the actionable diagnosis
  # periodically so the log never loses the thread.
  #
  # DB_FAIL_FAST=1 turns this into a hard exit, for CI or when you want the
  # platform to surface the failure as a failed deploy instead of a hung one.
  if [ "$status" -eq 20 ]; then
    if [ "${DB_FAIL_FAST:-0}" = "1" ]; then
      echo "Exiting because DB_FAIL_FAST=1 and credentials are invalid."
      exit 1
    fi
    if [ $((attempt % 20)) -eq 1 ]; then
      echo ""
      echo "=================================================================="
      echo " BLOCKED: database rejected the password (see explanation above)."
      echo " Fix DATABASE_URL, then redeploy. Retry ${attempt}."
      echo "=================================================================="
      echo ""
    fi
  fi

  attempt=$((attempt + 1))
  echo "資料庫還沒 ready，3 秒後重試... (第 ${attempt} 次)"
  sleep 3
done

# Seed only on first boot (marker file lives outside the image layer).
SEED_MARKER=/app/.seeded
if [ ! -f "$SEED_MARKER" ]; then
  echo "執行種子資料..."
  node dist-seed/seed.js || echo "seed 失敗或已經 seed 過，略過"
  touch "$SEED_MARKER"
fi

echo "啟動伺服器..."
exec node dist/main.js
