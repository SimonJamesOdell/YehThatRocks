#!/bin/sh
set -e

echo "[entrypoint] Waiting for MySQL to be ready..."
until node -e "
  const net = require('net');
  const url = new URL(process.env.DATABASE_URL || 'mysql://localhost:3306');
  const sock = net.createConnection(Number(url.port) || 3306, url.hostname);
  sock.on('connect', () => { sock.destroy(); process.exit(0); });
  sock.on('error', () => process.exit(1));
" 2>/dev/null; do
  sleep 2
done

echo "[entrypoint] Resolving migration baseline (no-op after first boot)..."
node /app/docker/migrate-baseline.js

echo "[entrypoint] Applying pending database migrations..."
npx prisma migrate deploy --schema /app/prisma/schema.prisma

echo "[entrypoint] Seeding database..."
npx prisma db execute --schema /app/prisma/schema.prisma --file /app/prisma/seed.sql 2>&1 || echo "[entrypoint] Seed skipped (non-fatal, data may already exist)"

echo "[entrypoint] Initializing admin dashboard cache..."
node /app/scripts/maintain-admin-dashboard-cache.js || echo "[entrypoint] Dashboard cache initialization failed (non-fatal)"

echo "[entrypoint] Starting admin dashboard cache scheduler in background..."
node /app/scripts/schedule-admin-dashboard-maintenance.js &
SCHEDULER_PID=$!

echo "[entrypoint] Starting application..."
"$@" &
APP_PID=$!

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$SCHEDULER_PID" ] && kill -0 "$SCHEDULER_PID" 2>/dev/null; then
    kill "$SCHEDULER_PID" 2>/dev/null || true
  fi
}

trap cleanup INT TERM

if [ "${WARMUP_CATEGORY_PATHS:-1}" = "1" ]; then
  echo "[entrypoint] Warming category cache paths..."
  node /app/scripts/warm-category-caches.js || echo "[entrypoint] Category warmup failed (non-fatal)"
else
  echo "[entrypoint] Category warmup disabled (WARMUP_CATEGORY_PATHS=${WARMUP_CATEGORY_PATHS:-0})"
fi

wait "$APP_PID"
APP_EXIT_CODE=$?

if [ -n "$SCHEDULER_PID" ] && kill -0 "$SCHEDULER_PID" 2>/dev/null; then
  kill "$SCHEDULER_PID" 2>/dev/null || true
fi

exit "$APP_EXIT_CODE"
