#!/bin/sh
set -e

echo "[rksad] starting…"

if [ -n "$DATABASE_URL" ]; then
  echo "[rksad] DATABASE_URL is set — applying Prisma schema…"
  npx prisma db push --skip-generate || echo "[rksad] warning: prisma db push failed — file/redis fallback may be used"
else
  echo "[rksad] WARNING: DATABASE_URL is NOT set."
fi

if [ -n "$RESEND_API_KEY" ]; then
  echo "[rksad] RESEND_API_KEY is present in the container environment (length=${#RESEND_API_KEY})"
else
  echo "[rksad] WARNING: RESEND_API_KEY is empty/unset inside this container."
  echo "[rksad] Partner OTP emails will fail until you set RESEND_API_KEY as a RUNTIME env var and redeploy."
fi

exec node dist/index.js
