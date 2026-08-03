#!/bin/sh
set -e

echo "[rksad] starting…"

if [ -n "$DATABASE_URL" ]; then
  echo "[rksad] DATABASE_URL is set — applying Prisma schema (global counter)…"
  if npx prisma db push --skip-generate; then
    echo "[rksad] Prisma schema ready"
  else
    echo "[rksad] WARNING: prisma db push failed — counter may fall back to Redis/file"
  fi
else
  echo "[rksad] WARNING: DATABASE_URL is NOT set."
  echo "[rksad] The visit counter will use a local file and can RESET when the container redeploys."
  echo "[rksad] Set DATABASE_URL to your Postgres instance for a true global counter."
fi

exec node dist/index.js
