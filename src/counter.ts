import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const COUNTER_FILE =
  process.env.COUNTER_FILE_PATH ||
  resolve(process.cwd(), "data", "counter.json");

/** Soft daily growth target range (visits added per UTC day). */
const DAILY_TARGET_MIN = 12_000;
const DAILY_TARGET_MAX = 38_000;

type CounterMeta = {
  count: number;
  day: string; // YYYY-MM-DD (UTC)
  dayAdded: number;
  dailyTarget: number;
  updated_at?: string;
};

let prisma: PrismaClient | null = null;
let prismaAvailable: boolean | null = null;

function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

async function ensurePageViewsRow(client: PrismaClient): Promise<void> {
  await client.page_views.upsert({
    where: { id: 1 },
    create: { id: 1, count: BigInt(0) },
    update: {},
  });
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
    // 2-digit: curated + nearby jitter
    const bases = [33, 45, 56, 67, 72, 78, 84, 88, 92, 97] as const;
    return Math.min(99, Math.max(25, pickFrom(bases) + randInt(-3, 4)));
  }

  if (roll < 0.75) {
    // 3-digit
    const bases = [112, 145, 187, 234, 278, 312, 356, 401, 453, 489, 512, 567, 623, 678, 734, 789, 845, 897] as const;
    return Math.min(999, Math.max(100, pickFrom(bases) + randInt(-12, 18)));
  }

  if (roll < 0.95) {
    // 4-digit (~1023–3200)
    if (Math.random() < 0.45) {
      const bases = [1023, 1187, 1345, 1456, 1589, 1672, 1789, 1890, 2012, 2234, 2456, 2678, 2890, 3012, 3187] as const;
      return Math.min(3200, Math.max(1000, pickFrom(bases) + randInt(-40, 60)));
    }
    return randInt(1023, 3200);
  }

  // Big jump
  return randInt(4000, 6500);
}

function softClampIncrement(raw: number, meta: CounterMeta): number {
  const remaining = meta.dailyTarget - meta.dayAdded;

  // Late in the day budget → prefer smaller bumps so growth looks paced
  if (remaining <= 0 || meta.dayAdded >= Math.floor(meta.dailyTarget * 0.9)) {
    return randInt(28, 96);
  }

  if (meta.dayAdded >= Math.floor(meta.dailyTarget * 0.7)) {
    // Prefer 2–3 digit, avoid huge jumps
    if (raw > 900) return randInt(110, 480);
    return raw;
  }

  // Don't blow the whole daily target in one hit
  if (raw > remaining) {
    return Math.max(33, Math.min(raw, Math.max(45, Math.floor(remaining * 0.35))));
  }

  return raw;
}

function defaultMeta(count = 0): CounterMeta {
  return {
    count,
    day: todayUtc(),
    dayAdded: 0,
    dailyTarget: randInt(DAILY_TARGET_MIN, DAILY_TARGET_MAX),
  };
}

function readMeta(): CounterMeta {
  try {
    if (!existsSync(COUNTER_FILE)) return defaultMeta(0);
    const raw = readFileSync(COUNTER_FILE, "utf-8");
    const data = JSON.parse(raw) as Partial<CounterMeta>;
    const count =
      typeof data.count === "number" && Number.isFinite(data.count)
        ? Math.max(0, Math.floor(data.count))
        : 0;
    const day = typeof data.day === "string" ? data.day : todayUtc();
    let meta: CounterMeta = {
      count,
      day,
      dayAdded:
        typeof data.dayAdded === "number" && Number.isFinite(data.dayAdded)
          ? Math.max(0, Math.floor(data.dayAdded))
          : 0,
      dailyTarget:
        typeof data.dailyTarget === "number" && Number.isFinite(data.dailyTarget)
          ? Math.max(DAILY_TARGET_MIN, Math.floor(data.dailyTarget))
          : randInt(DAILY_TARGET_MIN, DAILY_TARGET_MAX),
      updated_at: data.updated_at,
    };

    // New UTC day → reset soft budget
    if (meta.day !== todayUtc()) {
      meta = {
        ...meta,
        day: todayUtc(),
        dayAdded: 0,
        dailyTarget: randInt(DAILY_TARGET_MIN, DAILY_TARGET_MAX),
      };
    }

    return meta;
  } catch {
    return defaultMeta(0);
  }
}

function writeMeta(meta: CounterMeta): void {
  mkdirSync(dirname(COUNTER_FILE), { recursive: true });
  writeFileSync(
    COUNTER_FILE,
    JSON.stringify(
      { ...meta, updated_at: new Date().toISOString() },
      null,
      2
    ),
    "utf-8"
  );
}

function computeDelta(meta: CounterMeta): number {
  return softClampIncrement(pickTrafficIncrement(), meta);
}

function applyDeltaToMeta(meta: CounterMeta, delta: number): CounterMeta {
  return {
    ...meta,
    count: meta.count + delta,
    dayAdded: meta.dayAdded + delta,
  };
}

/**
 * Increment the persistent total by a realistic traffic-sized delta and return the new count.
 * Prefer PostgreSQL; fall back to JSON file. Soft daily target paces growth over 24h.
 */
export async function getAndIncrementCounter(): Promise<number> {
  const meta = readMeta();
  const delta = computeDelta(meta);
  const client = getPrisma();

  if (client && prismaAvailable !== false) {
    try {
      await ensurePageViewsRow(client);

      // Keep DB and file in sync — never decrease; take the higher known total
      const current = await client.page_views.findUnique({ where: { id: 1 } });
      const dbCount = current ? Number(current.count) : 0;
      const base = Math.max(dbCount, meta.count);
      if (base > dbCount) {
        await client.page_views.update({
          where: { id: 1 },
          data: { count: BigInt(base) },
        });
      }
      meta.count = base;

      const updated = await client.page_views.update({
        where: { id: 1 },
        data: { count: { increment: delta } },
      });

      prismaAvailable = true;
      const count = Number(updated.count);
      const nextMeta = applyDeltaToMeta({ ...meta, count: count - delta }, delta);
      nextMeta.count = count;
      try {
        writeMeta(nextMeta);
      } catch {
        /* ignore sync errors */
      }
      return count;
    } catch (err) {
      console.warn(
        "[counter] Postgres unavailable, using file fallback:",
        err instanceof Error ? err.message : err
      );
      prismaAvailable = false;
      setTimeout(() => {
        prismaAvailable = null;
      }, 60_000);
    }
  }

  const next = applyDeltaToMeta(meta, delta);
  writeMeta(next);
  return next.count;
}
