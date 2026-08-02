import { PrismaClient } from "@prisma/client";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const COUNTER_FILE =
  process.env.COUNTER_FILE_PATH ||
  resolve(process.cwd(), "data", "counter.json");

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

function readFileCounter(): number {
  try {
    if (!existsSync(COUNTER_FILE)) return 0;
    const raw = readFileSync(COUNTER_FILE, "utf-8");
    const data = JSON.parse(raw) as { count?: number };
    return typeof data.count === "number" && Number.isFinite(data.count)
      ? Math.max(0, Math.floor(data.count))
      : 0;
  } catch {
    return 0;
  }
}

function writeFileCounter(count: number): void {
  mkdirSync(dirname(COUNTER_FILE), { recursive: true });
  writeFileSync(
    COUNTER_FILE,
    JSON.stringify({ count, updated_at: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

function incrementFileCounter(): number {
  const next = readFileCounter() + 1;
  writeFileCounter(next);
  return next;
}

/**
 * Increment the page-view counter by 1 and return the new count.
 * Prefer PostgreSQL; fall back to a local JSON file if DB is unavailable.
 */
export async function getAndIncrementCounter(): Promise<number> {
  const client = getPrisma();

  if (client && prismaAvailable !== false) {
    try {
      await ensurePageViewsRow(client);
      const updated = await client.page_views.update({
        where: { id: 1 },
        data: { count: { increment: 1 } },
      });
      prismaAvailable = true;
      const count = Number(updated.count);
      // Keep file fallback in sync so a later DB outage continues from a sensible value
      try {
        writeFileCounter(count);
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
      // Soft-reset availability after a while so we retry DB later
      setTimeout(() => {
        prismaAvailable = null;
      }, 60_000);
    }
  }

  return incrementFileCounter();
}
