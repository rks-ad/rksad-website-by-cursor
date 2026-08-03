/**
 * Global persistent visit counter.
 *
 * Source-of-truth order:
 *   1. PostgreSQL (page_views) — required for multi-device persistence
 *   2. Redis (REDIS_URL) — optional shared fallback
 *   3. JSON file — last-resort local fallback (needs a persistent volume)
 *
 * The returned count is always monotonic for a given storage backend.
 * An in-process floor prevents accidentally serving 0 after a transient error.
 */

import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const COUNTER_FILE =
  process.env.COUNTER_FILE_PATH ||
  resolve(process.cwd(), "data", "counter.json");

const REDIS_COUNT_KEY = "rksad:counter:count";
const REDIS_META_KEY = "rksad:counter:meta";

/** Soft daily growth target range (visits added per UTC day). */
const DAILY_TARGET_MIN = 12_000;
const DAILY_TARGET_MAX = 38_000;

/** Optional bootstrap when storage has count 0 (e.g. first deploy / migration). */
const COUNTER_SEED = Math.max(
  0,
  Math.floor(Number(process.env.COUNTER_SEED || process.env.COUNTER_INITIAL || 0)) || 0
);

type DayMeta = {
  day: string;
  dayAdded: number;
  dailyTarget: number;
};

type FilePayload = DayMeta & {
  count: number;
  updated_at?: string;
};

/** Process-local floor — never serve below this after we've seen a higher value. */
let lastKnownCount = 0;

export function getLastKnownCount(): number {
  return lastKnownCount;
}

let prisma: PrismaClient | null = null;
let prismaDisabledUntil = 0;

let redis: Redis | null = null;
let redisFailed = false;

function bumpFloor(n: number): number {
  if (Number.isFinite(n) && n > lastKnownCount) {
    lastKnownCount = Math.floor(n);
  }
  return Math.max(lastKnownCount, Math.floor(n) || 0);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Weighted traffic-style increment:
 *  40% → 2-digit, 35% → 3-digit, 20% → 4-digit, 5% → big jump
 */
export function pickTrafficIncrement(): number {
  const roll = Math.random();

  if (roll < 0.4) {
    const bases = [33, 45, 56, 67, 72, 78, 84, 88, 92, 97] as const;
    return Math.min(99, Math.max(25, pickFrom(bases) + randInt(-3, 4)));
  }

  if (roll < 0.75) {
    const bases = [
      112, 145, 187, 234, 278, 312, 356, 401, 453, 489, 512, 567, 623, 678, 734,
      789, 845, 897,
    ] as const;
    return Math.min(999, Math.max(100, pickFrom(bases) + randInt(-12, 18)));
  }

  if (roll < 0.95) {
    if (Math.random() < 0.45) {
      const bases = [
        1023, 1187, 1345, 1456, 1589, 1672, 1789, 1890, 2012, 2234, 2456, 2678,
        2890, 3012, 3187,
      ] as const;
      return Math.min(3200, Math.max(1000, pickFrom(bases) + randInt(-40, 60)));
    }
    return randInt(1023, 3200);
  }

  return randInt(4000, 6500);
}

function softClampIncrement(raw: number, meta: DayMeta): number {
  const remaining = meta.dailyTarget - meta.dayAdded;

  if (remaining <= 0 || meta.dayAdded >= Math.floor(meta.dailyTarget * 0.9)) {
    return randInt(28, 96);
  }

  if (meta.dayAdded >= Math.floor(meta.dailyTarget * 0.7)) {
    if (raw > 900) return randInt(110, 480);
    return raw;
  }

  if (raw > remaining) {
    return Math.max(
      33,
      Math.min(raw, Math.max(45, Math.floor(remaining * 0.35)))
    );
  }

  return Math.max(1, raw);
}

function freshDayMeta(): DayMeta {
  return {
    day: todayUtc(),
    dayAdded: 0,
    dailyTarget: randInt(DAILY_TARGET_MIN, DAILY_TARGET_MAX),
  };
}

function normalizeDayMeta(partial: Partial<DayMeta> | null | undefined): DayMeta {
  const today = todayUtc();
  const day = typeof partial?.day === "string" ? partial.day : "";
  if (day !== today) return freshDayMeta();

  return {
    day: today,
    dayAdded:
      typeof partial?.dayAdded === "number" && Number.isFinite(partial.dayAdded)
        ? Math.max(0, Math.floor(partial.dayAdded))
        : 0,
    dailyTarget:
      typeof partial?.dailyTarget === "number" &&
      Number.isFinite(partial.dailyTarget)
        ? Math.max(DAILY_TARGET_MIN, Math.floor(partial.dailyTarget))
        : randInt(DAILY_TARGET_MIN, DAILY_TARGET_MAX),
  };
}

function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (Date.now() < prismaDisabledUntil) return null;
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

function disablePrismaBriefly(err: unknown): void {
  console.warn(
    "[counter] Postgres error — will retry shortly:",
    err instanceof Error ? err.message : err
  );
  prismaDisabledUntil = Date.now() + 15_000;
}

function getRedis(): Redis | null {
  if (redisFailed) return null;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!redis) {
    try {
      redis = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      redis.on("error", (e: Error) => {
        console.warn("[counter] Redis error:", e.message);
      });
    } catch (err) {
      console.warn("[counter] Redis init failed:", err);
      redisFailed = true;
      return null;
    }
  }
  return redis;
}

async function ensureRedisReady(client: Redis): Promise<void> {
  if (client.status === "ready") return;
  if (client.status === "wait" || client.status === "end") {
    await client.connect();
  }
}

/* -------------------- File fallback -------------------- */

function readFilePayload(): FilePayload {
  try {
    if (!existsSync(COUNTER_FILE)) {
      return { count: COUNTER_SEED, ...freshDayMeta() };
    }
    const raw = readFileSync(COUNTER_FILE, "utf-8");
    const data = JSON.parse(raw) as Partial<FilePayload>;
    const count =
      typeof data.count === "number" && Number.isFinite(data.count)
        ? Math.max(0, Math.floor(data.count))
        : COUNTER_SEED;
    return { count: Math.max(count, COUNTER_SEED), ...normalizeDayMeta(data) };
  } catch {
    return { count: Math.max(COUNTER_SEED, lastKnownCount), ...freshDayMeta() };
  }
}

function writeFilePayload(payload: FilePayload): void {
  mkdirSync(dirname(COUNTER_FILE), { recursive: true });
  const tmp = `${COUNTER_FILE}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify(
    { ...payload, updated_at: new Date().toISOString() },
    null,
    2
  );
  writeFileSync(tmp, body, "utf-8");
  renameSync(tmp, COUNTER_FILE);
}

function incrementViaFile(): number {
  const current = readFilePayload();
  // Never go below process floor or seed
  current.count = Math.max(current.count, lastKnownCount, COUNTER_SEED);
  const meta = normalizeDayMeta(current);
  const delta = softClampIncrement(pickTrafficIncrement(), meta);
  const next: FilePayload = {
    count: current.count + delta,
    day: meta.day,
    dayAdded: meta.dayAdded + delta,
    dailyTarget: meta.dailyTarget,
  };
  writeFilePayload(next);
  return bumpFloor(next.count);
}

/* -------------------- Redis fallback -------------------- */

async function incrementViaRedis(): Promise<number | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    await ensureRedisReady(client);

    const existing = await client.get(REDIS_COUNT_KEY);
    let base = existing !== null ? Number(existing) : NaN;
    if (!Number.isFinite(base)) base = Math.max(COUNTER_SEED, lastKnownCount);
    base = Math.max(base, lastKnownCount, COUNTER_SEED);

    let meta: DayMeta = freshDayMeta();
    try {
      const rawMeta = await client.get(REDIS_META_KEY);
      if (rawMeta) meta = normalizeDayMeta(JSON.parse(rawMeta) as DayMeta);
    } catch {
      /* ignore bad meta */
    }

    // Ensure Redis has at least the floor before INCRBY
    if (existing === null || Number(existing) < base) {
      await client.set(REDIS_COUNT_KEY, String(base));
    }

    const delta = softClampIncrement(pickTrafficIncrement(), meta);
    const next = await client.incrby(REDIS_COUNT_KEY, delta);

    meta = {
      ...meta,
      dayAdded: meta.dayAdded + delta,
    };
    await client.set(REDIS_META_KEY, JSON.stringify(meta));

    // Mirror to file when possible (best-effort)
    try {
      writeFilePayload({ count: next, ...meta });
    } catch {
      /* ignore */
    }

    return bumpFloor(next);
  } catch (err) {
    console.warn(
      "[counter] Redis increment failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/* -------------------- PostgreSQL (authoritative) -------------------- */

async function incrementViaPostgres(): Promise<number | null> {
  const client = getPrisma();
  if (!client) return null;

  try {
    const result = await client.$transaction(async (tx) => {
      let row = await tx.page_views.findUnique({ where: { id: 1 } });

      if (!row) {
        const seed = Math.max(COUNTER_SEED, lastKnownCount);
        const meta = freshDayMeta();
        row = await tx.page_views.create({
          data: {
            id: 1,
            count: BigInt(seed),
            day: meta.day,
            day_added: BigInt(0),
            daily_target: meta.dailyTarget,
          },
        });
      }

      let count = Number(row.count);
      // Bootstrap empty DB from seed / in-memory floor / file
      const fileCount = readFilePayload().count;
      const floor = Math.max(count, lastKnownCount, COUNTER_SEED, fileCount);
      if (floor > count) {
        row = await tx.page_views.update({
          where: { id: 1 },
          data: { count: BigInt(floor) },
        });
        count = Number(row.count);
      }

      const meta = normalizeDayMeta({
        day: row.day,
        dayAdded: Number(row.day_added),
        dailyTarget: row.daily_target,
      });

      const delta = softClampIncrement(pickTrafficIncrement(), meta);
      const nextDayAdded = meta.dayAdded + delta;

      const updated = await tx.page_views.update({
        where: { id: 1 },
        data: {
          count: { increment: delta },
          day: meta.day,
          day_added: BigInt(nextDayAdded),
          daily_target: meta.dailyTarget,
        },
      });

      return {
        count: Number(updated.count),
        meta: {
          day: meta.day,
          dayAdded: nextDayAdded,
          dailyTarget: meta.dailyTarget,
        },
      };
    });

    // Best-effort mirrors so fallbacks resume from the real global value
    try {
      writeFilePayload({ count: result.count, ...result.meta });
    } catch {
      /* ignore */
    }

    const r = getRedis();
    if (r) {
      try {
        await ensureRedisReady(r);
        const current = Number((await r.get(REDIS_COUNT_KEY)) || 0);
        if (!Number.isFinite(current) || result.count > current) {
          await r.set(REDIS_COUNT_KEY, String(result.count));
        }
        await r.set(REDIS_META_KEY, JSON.stringify(result.meta));
      } catch {
        /* ignore */
      }
    }

    return bumpFloor(result.count);
  } catch (err) {
    disablePrismaBriefly(err);
    return null;
  }
}

/**
 * Increment the single global counter and return the new value.
 * Always persists to the best available shared store.
 */
export async function getAndIncrementCounter(): Promise<number> {
  const fromPg = await incrementViaPostgres();
  if (fromPg !== null) {
    console.log(`[counter] postgres → ${fromPg}`);
    return fromPg;
  }

  const fromRedis = await incrementViaRedis();
  if (fromRedis !== null) {
    console.warn(`[counter] redis fallback → ${fromRedis}`);
    return fromRedis;
  }

  try {
    const fromFile = incrementViaFile();
    console.warn(
      `[counter] FILE fallback → ${fromFile} (set DATABASE_URL for global persistence across deploys)`
    );
    return fromFile;
  } catch (err) {
    console.error("[counter] all storage backends failed:", err);
    // Never hand the UI a fresh zero if we've seen a real count this process
    if (lastKnownCount > 0) return lastKnownCount;
    if (COUNTER_SEED > 0) return bumpFloor(COUNTER_SEED);
    throw err;
  }
}

/** Storage mode hint for health checks / ops. */
export function getCounterStorageHint(): string {
  if (process.env.DATABASE_URL && Date.now() >= prismaDisabledUntil) {
    return "postgres";
  }
  if (process.env.REDIS_URL && !redisFailed) return "redis";
  return "file";
}
