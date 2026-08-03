/**
 * OTP store: PostgreSQL (preferred) → Redis → in-memory Map.
 * Postgres keeps OTPs working across multiple containers / restarts.
 */

import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";

const OTP_TTL_SECONDS = 600;

type MemoryEntry = { otp: string; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();

let prisma: PrismaClient | null = null;
let prismaDisabledUntil = 0;

let redis: Redis | null = null;
let redisFailed = false;

function otpKey(email: string): string {
  return email.trim().toLowerCase();
}

function redisOtpKey(email: string): string {
  return `otp:${otpKey(email)}`;
}

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key);
  }
}

function getPrisma(): PrismaClient | null {
  if (!process.env.DATABASE_URL) return null;
  if (Date.now() < prismaDisabledUntil) return null;
  if (!prisma) prisma = new PrismaClient();
  return prisma;
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
      redis.on("error", (err: Error) => {
        console.warn("[otp] Redis error:", err.message);
      });
    } catch (err) {
      console.warn("[otp] Redis init failed, using memory/Postgres:", err);
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

function storeMemory(email: string, otp: string): void {
  pruneMemory();
  memoryStore.set(otpKey(email), {
    otp,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
  });
}

function getMemory(email: string): string | null {
  pruneMemory();
  const entry = memoryStore.get(otpKey(email));
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(otpKey(email));
    return null;
  }
  return entry.otp;
}

async function storePostgres(email: string, otp: string): Promise<boolean> {
  const client = getPrisma();
  if (!client) return false;
  try {
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
    await client.partner_otps.upsert({
      where: { email: otpKey(email) },
      create: { email: otpKey(email), otp, expires_at: expiresAt },
      update: { otp, expires_at: expiresAt, created_at: new Date() },
    });
    return true;
  } catch (err) {
    console.warn(
      "[otp] Postgres store failed:",
      err instanceof Error ? err.message : err
    );
    prismaDisabledUntil = Date.now() + 15_000;
    return false;
  }
}

async function getPostgres(email: string): Promise<string | null> {
  const client = getPrisma();
  if (!client) return null;
  try {
    const row = await client.partner_otps.findUnique({
      where: { email: otpKey(email) },
    });
    if (!row) return null;
    if (row.expires_at.getTime() <= Date.now()) {
      await client.partner_otps
        .delete({ where: { email: otpKey(email) } })
        .catch(() => undefined);
      return null;
    }
    return row.otp;
  } catch (err) {
    console.warn(
      "[otp] Postgres get failed:",
      err instanceof Error ? err.message : err
    );
    prismaDisabledUntil = Date.now() + 15_000;
    return null;
  }
}

async function deletePostgres(email: string): Promise<void> {
  const client = getPrisma();
  if (!client) return;
  try {
    await client.partner_otps.delete({ where: { email: otpKey(email) } });
  } catch {
    /* ignore missing */
  }
}

export async function storeOtp(email: string, otp: string): Promise<void> {
  // Always keep a memory copy on this instance as last resort
  storeMemory(email, otp);

  const savedPg = await storePostgres(email, otp);
  if (savedPg) return;

  const client = getRedis();
  if (client) {
    try {
      await ensureRedisReady(client);
      await client.set(redisOtpKey(email), otp, "EX", OTP_TTL_SECONDS);
      return;
    } catch (err) {
      console.warn(
        "[otp] Redis store failed, using memory:",
        err instanceof Error ? err.message : err
      );
    }
  }
}

export async function getOtp(email: string): Promise<string | null> {
  const fromPg = await getPostgres(email);
  if (fromPg) return fromPg;

  const client = getRedis();
  if (client) {
    try {
      await ensureRedisReady(client);
      const value = await client.get(redisOtpKey(email));
      if (value !== null) return value;
    } catch (err) {
      console.warn(
        "[otp] Redis get failed, trying memory:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return getMemory(email);
}

export async function deleteOtp(email: string): Promise<void> {
  await deletePostgres(email);

  const client = getRedis();
  if (client) {
    try {
      await ensureRedisReady(client);
      await client.del(redisOtpKey(email));
    } catch {
      /* ignore */
    }
  }

  memoryStore.delete(otpKey(email));
}
