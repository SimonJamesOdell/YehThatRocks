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

echo "[entrypoint] MySQL is ready. Pushing Prisma schema..."
npx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "[entrypoint] prisma db push failed (non-fatal, tables may already exist)"

echo "[entrypoint] Seeding database..."
npx prisma db execute --schema /app/prisma/schema.prisma --file /app/prisma/seed.sql 2>&1 || echo "[entrypoint] Seed skipped (non-fatal, data may already exist)"

echo "[entrypoint] Starting application..."
exec "$@"
