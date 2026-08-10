# ---- Build ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate && npx tsc

# ---- Runtime ----
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache wget \
  && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN npm ci --omit=dev || npm install --omit=dev \
  && npx prisma generate \
  && mkdir -p /app/data \
  && chown -R app:app /app

COPY --from=builder /app/dist ./dist
COPY views ./views
COPY public ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh && chown app:app ./docker-entrypoint.sh

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
