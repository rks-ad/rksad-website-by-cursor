#!/bin/sh
set -e

echo "[rksad] starting…"

# Push schema when DATABASE_URL is available (idempotent; safe for Dokploy/Coolify)
if [ -n "$DATABASE_URL" ]; then
  echo "[rksad] applying Prisma schema (db push)…"
  npx prisma db push --skip-generate || echo "[rksad] warning: prisma db push failed — file counter fallback will be used"
else
  echo "[rksad] DATABASE_URL not set — using file-based counter only"
fi

exec node dist/index.js
