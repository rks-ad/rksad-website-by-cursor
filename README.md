# RKS.Ad Website (self-hosted)

Production Node.js port of the RKS.Ad Cloudflare Worker — **Hono + TypeScript + Prisma/Postgres**, ready for **Dokploy / Coolify** on an Oracle VPS.

Same UI, same API paths, same Resend OTP/partner emails. The visit counter uses PostgreSQL (with a JSON file fallback so the site never breaks).

---

## Stack

| Piece | Choice |
|--------|--------|
| Runtime | Node.js 20+ |
| Framework | [Hono](https://hono.dev) |
| Language | TypeScript |
| Counter DB | PostgreSQL via Prisma (`page_views`) |
| Counter fallback | `data/counter.json` |
| OTP store | PostgreSQL (`partner_otps`), then Redis, then memory |
| Email | Resend API (branded templates → applicant + `iam@rks.ad`) |
| Deploy | Docker / docker-compose |

---

## Project layout

```
├── src/
│   ├── index.ts          # Entry: routes + HTML + static assets
│   ├── counter.ts        # Postgres + file fallback
│   ├── otp-store.ts      # Memory / Redis OTP
│   ├── resend.ts         # Resend helper
│   └── routes/partner.ts # send-otp, verify-otp, submit-partner
├── views/index.html      # Full SPA (edit UI here)
├── public/
│   ├── app.css           # Self-contained CSS (no Tailwind CDN)
│   └── img/              # Optimized WebP logo/photo + UPI QR
├── prisma/schema.prisma  # page_views model
├── Dockerfile
├── docker-compose.yml
├── docker-entrypoint.sh  # prisma db push then start
└── .env.example
```

---

## API routes (unchanged)

| Method | Path | Behaviour |
|--------|------|-----------|
| `GET` | `/` | Serves `views/index.html` |
| `GET` | `/app.css` | Self-contained stylesheet |
| `GET` | `/img/:name` | Optimized static images |
| `GET` | `/api/counter` | Increment counter → `{ count }` |
| `POST` | `/api/send-otp` | Generate OTP, email via Resend |
| `POST` | `/api/verify-otp` | Check OTP |
| `POST` | `/api/submit-partner` | Email partnership details to `iam@rks.ad` |
| `GET` | `/robots.txt` | SEO |
| `GET` | `/sitemap.xml` | SEO |
| `GET` | `/health` | Health probe |

---

## Environment variables

Copy `.env.example` → `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | no | Default `3000` |
| `SITE_URL` | no | Used in sitemap/robots (default `https://rks.ad`) |
| `DATABASE_URL` | recommended | Postgres connection string |
| `RESEND_API_KEY` | **yes** (OTP/partner) | Resend API key |
| `FROM_EMAIL` | no | Default `Notify@mails.rks.ad` (must be on a Resend-verified domain) |
| `FROM_NAME` | no | Default `RKS.Ad Notify` |
| `PARTNER_NOTIFY_EMAIL` | no | Where forms are sent (default `iam@rks.ad`) |
| `REDIS_URL` | no | Optional Redis OTP fallback |
| `COUNTER_FILE_PATH` | no | Default `./data/counter.json` |

---

## Local development

```bash
cp .env.example .env
# edit DATABASE_URL, RESEND_API_KEY

npm install
npx prisma db push
npm run dev
```

Open http://localhost:3000

Without Postgres, the counter still works via the file fallback.

---

## Docker (local)

```bash
cp .env.example .env
# Set RESEND_API_KEY and optionally override DATABASE_URL

# Default compose DATABASE_URL for the bundled postgres:
# postgresql://rksad:rksad_secret@postgres:5432/rksad?schema=public

export DATABASE_URL="postgresql://rksad:rksad_secret@postgres:5432/rksad?schema=public"
export RESEND_API_KEY="re_..."

docker compose up -d --build
```

With Redis OTP store:

```bash
docker compose --profile redis up -d --build
# set REDIS_URL=redis://redis:6379
```

---

## Deploy on Dokploy / Coolify

### Option A — Docker Compose (recommended if this repo owns Postgres)

1. Push this repo to GitHub.
2. In Dokploy/Coolify → **New Compose** (or Docker Compose application).
3. Connect the repo; set compose file to `docker-compose.yml`.
4. Set environment variables in the UI:

   ```
   DATABASE_URL=postgresql://rksad:STRONG_PASSWORD@postgres:5432/rksad?schema=public
   RESEND_API_KEY=re_xxxxxxxx
   FROM_EMAIL=Notify@mails.rks.ad
   SITE_URL=https://rks.ad
   POSTGRES_USER=rksad
   POSTGRES_PASSWORD=STRONG_PASSWORD
   POSTGRES_DB=rksad
   ```

5. Deploy. On start, `docker-entrypoint.sh` runs `prisma db push` then starts the app.
6. Point your domain (`rks.ad`) at the service; enable HTTPS in the panel.
7. Health check path: `/health`

### Option B — Dockerfile only (use existing VPS Postgres)

If you already run Postgres/Prisma elsewhere on the VPS:

1. Create a **Dockerfile** application in Dokploy/Coolify.
2. Build context = repo root; Dockerfile = `Dockerfile`.
3. Set env vars (point `DATABASE_URL` at your existing DB):

   ```
   DATABASE_URL=postgresql://USER:PASS@YOUR_PG_HOST:5432/YOUR_DB?schema=public
   RESEND_API_KEY=re_xxxxxxxx
   FROM_EMAIL=Notify@mails.rks.ad
   SITE_URL=https://rks.ad
   PORT=3000
   ```

4. Expose port `3000`, attach domain, enable TLS.
5. Persist `/app/data` as a volume so the file-counter fallback survives restarts.

### Option C — Coolify “Nixpacks / Node” (no Docker build)

1. New application → this Git repo.
2. Build pack: Node / Nixpacks.
3. Build command: `npm ci && npx prisma generate && npx tsc`
4. Start command: `npx prisma db push --skip-generate && node dist/index.js`
5. Same env vars as Option B.
6. Port `3000`.

---

## Counter behaviour

1. On every `GET /api/counter`, try Postgres: upsert row `id=1`, `count += 1`, return `{ count }`.
2. If Postgres is down / unset → increment `data/counter.json` instead.
3. Successful Postgres increments also sync the file so a later outage continues from a sensible number.

Schema:

```prisma
model page_views {
  id         Int      @id @default(1)
  count      BigInt   @default(0)
  updated_at DateTime @updatedAt
}
```

To seed a starting count (e.g. migrate from Cloudflare KV):

```sql
INSERT INTO page_views (id, count, updated_at)
VALUES (1, 123456, NOW())
ON CONFLICT (id) DO UPDATE SET count = EXCLUDED.count, updated_at = NOW();
```

---

## Editing the site

All frontend UI lives in **`views/index.html`**. Redeploy after edits (or restart locally with `npm run dev`).

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Hot-reload with `tsx` |
| `npm run build` | `tsc` + Prisma generate |
| `npm start` | Run compiled `dist/index.js` |
| `npm run typecheck` | TypeScript check |
| `npm run db:push` | Push Prisma schema |

---

## Notes

- OTP is stored in **Postgres** (`partner_otps`) so it works across multiple containers. Redis/memory are fallbacks.
- Partner notify email goes to `PARTNER_NOTIFY_EMAIL` (default `iam@rks.ad`).
- Do not commit `.env` or real API keys.
- If OTP send fails, check `/health` → `emailConfigured` and that `FROM_EMAIL` uses a domain verified in Resend.
