/**
 * OTP store: in-memory Map with 10-minute TTL, optional Redis when REDIS_URL is set.
 */

import { Redis } from "ioredis";

const OTP_TTL_SECONDS = 600;

type MemoryEntry = { otp: string; expiresAt: number };

const memoryStore = new Map<string, MemoryEntry>();

let redis: Redis | null = null;
let redisFailed = false;

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
      console.warn("[otp] Redis init failed, using memory:", err);
      redisFailed = true;
      return null;
    }
  }
  return redis;
}

function otpKey(email: string): string {
  return `otp:${email.toLowerCase()}`;
}

function pruneMemory(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key);
  }
}

async function ensureRedisReady(client: Redis): Promise<void> {
  if (client.status === "ready") return;
  if (client.status === "wait" || client.status === "end") {
    await client.connect();
  }
}

export async function storeOtp(email: string, otp: string): Promise<void> {
  const key = otpKey(email);
  const client = getRedis();

  if (client) {
    try {
      await ensureRedisReady(client);
      await client.set(key, otp, "EX", OTP_TTL_SECONDS);
      return;
    } catch (err) {
      console.warn(
        "[otp] Redis store failed, using memory:",
        err instanceof Error ? err.message : err
      );
    }
  }

  pruneMemory();
  memoryStore.set(key, {
    otp,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
  });
}

export async function getOtp(email: string): Promise<string | null> {
  const key = otpKey(email);
  const client = getRedis();

  if (client) {
    try {
      await ensureRedisReady(client);
      const value = await client.get(key);
      if (value !== null) return value;
    } catch (err) {
      console.warn(
        "[otp] Redis get failed, trying memory:",
        err instanceof Error ? err.message : err
      );
    }
  }

  pruneMemory();
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.otp;
}

export async function deleteOtp(email: string): Promise<void> {
  const key = otpKey(email);
  const client = getRedis();

  if (client) {
    try {
      await ensureRedisReady(client);
      await client.del(key);
    } catch {
      /* ignore */
    }
  }

  memoryStore.delete(key);
}
