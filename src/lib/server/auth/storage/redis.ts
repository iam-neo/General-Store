import { Redis } from "@upstash/redis";
import type { AuthStorageAdapter, RateLimitRecord } from "./interface";

export type RedisClientLike = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData>;
  keys?(pattern: string): Promise<string[]>;
};

export interface UpstashRedisAuthStorageOptions {
  url?: string;
  token?: string;
  client?: RedisClientLike;
  keyPrefix?: string;
}

const DEFAULT_PREFIX = "gs:auth:";

/**
 * Atomic sliding-window rate limit evaluation using a single Redis Lua script.
 * Prevents race conditions from concurrent serverless requests attempting to bypass limits.
 */
const ATOMIC_RATE_LIMIT_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local lockoutMs = tonumber(ARGV[3])
local maxAttempts = tonumber(ARGV[4])

local raw = redis.call('GET', key)
local record = nil
if raw and type(raw) == 'string' then
  record = cjson.decode(raw)
elseif raw and type(raw) == 'table' then
  record = raw
end

if record then
  if record.lockedUntil and record.lockedUntil > now then
    local remaining = math.ceil((record.lockedUntil - now) / 1000)
    if remaining < 1 then remaining = 1 end
    return cjson.encode({ limited = true, retryAfterSeconds = remaining, attempts = record.attempts })
  end

  if (now - record.firstAttemptAt) > windowMs then
    record = {
      attempts = 1,
      firstAttemptAt = now,
      lastAttemptAt = now
    }
    local ttlSec = math.ceil(windowMs / 1000)
    if ttlSec < 1 then ttlSec = 1 end
    redis.call('SET', key, cjson.encode(record), 'EX', ttlSec)
    return cjson.encode({ limited = false, retryAfterSeconds = 0, attempts = 1 })
  else
    record.attempts = record.attempts + 1
    record.lastAttemptAt = now
    if record.attempts >= maxAttempts then
      record.lockedUntil = now + lockoutMs
      local ttlSec = math.ceil(lockoutMs / 1000)
      if ttlSec < 1 then ttlSec = 1 end
      redis.call('SET', key, cjson.encode(record), 'EX', ttlSec)
      return cjson.encode({ limited = true, retryAfterSeconds = ttlSec, attempts = record.attempts })
    else
      local ttlSec = math.ceil(windowMs / 1000)
      if ttlSec < 1 then ttlSec = 1 end
      redis.call('SET', key, cjson.encode(record), 'EX', ttlSec)
      return cjson.encode({ limited = false, retryAfterSeconds = 0, attempts = record.attempts })
    end
  end
else
  record = {
    attempts = 1,
    firstAttemptAt = now,
    lastAttemptAt = now
  }
  local ttlSec = math.ceil(windowMs / 1000)
  if ttlSec < 1 then ttlSec = 1 end
  redis.call('SET', key, cjson.encode(record), 'EX', ttlSec)
  return cjson.encode({ limited = false, retryAfterSeconds = 0, attempts = 1 })
end
`;

export class UpstashRedisAuthStorage implements AuthStorageAdapter {
  readonly name = "upstash-redis";
  private readonly client: RedisClientLike;
  private readonly prefix: string;

  constructor(options: UpstashRedisAuthStorageOptions = {}) {
    this.prefix = options.keyPrefix || DEFAULT_PREFIX;

    if (options.client) {
      this.client = options.client;
    } else {
      const url =
        options.url ||
        process.env.UPSTASH_REDIS_REST_URL ||
        process.env.KV_REST_API_URL;
      const token =
        options.token ||
        process.env.UPSTASH_REDIS_REST_TOKEN ||
        process.env.KV_REST_API_TOKEN;

      if (!url || !token) {
        throw new Error(
          "UpstashRedisAuthStorage requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN)."
        );
      }

      this.client = new Redis({ url, token });
    }
  }

  private revocationKey(sessionId: string): string {
    return `${this.prefix}revoked:${sessionId}`;
  }

  private epochKey(): string {
    return `${this.prefix}epoch`;
  }

  private rateLimitKey(key: string): string {
    return `${this.prefix}ratelimit:${key}`;
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    if (!sessionId) return true;
    const res = await this.client.get(this.revocationKey(sessionId));
    return res !== null && res !== undefined;
  }

  async revokeSession(sessionId: string, expiresAt: number): Promise<void> {
    if (!sessionId) return;
    const now = Date.now();
    const ttlSec = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    const record = { sessionId, revokedAt: now, expiresAt };
    await this.client.set(this.revocationKey(sessionId), JSON.stringify(record), {
      ex: ttlSec,
    });
  }

  async getGlobalRevocationEpoch(): Promise<number> {
    const res = await this.client.get<number | string>(this.epochKey());
    return res ? Number(res) || 0 : 0;
  }

  async setGlobalRevocationEpoch(epoch: number): Promise<void> {
    await this.client.set(this.epochKey(), epoch);
  }

  async getRateLimit(key: string): Promise<RateLimitRecord | null> {
    const res = await this.client.get<RateLimitRecord | string>(this.rateLimitKey(key));
    if (!res) return null;
    if (typeof res === "string") {
      try {
        return JSON.parse(res) as RateLimitRecord;
      } catch {
        return null;
      }
    }
    return res;
  }

  async setRateLimit(key: string, record: RateLimitRecord, ttlMs: number): Promise<void> {
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.client.set(this.rateLimitKey(key), JSON.stringify(record), { ex: ttlSec });
  }

  async clearRateLimit(key: string): Promise<void> {
    await this.client.del(this.rateLimitKey(key));
  }

  async recordLoginFailureAtomic(
    key: string,
    options: { maxAttempts: number; windowMs: number; lockoutMs: number; now?: number }
  ): Promise<{ limited: boolean; retryAfterSeconds: number }> {
    const now = options.now ?? Date.now();
    const result = await this.client.eval(
      ATOMIC_RATE_LIMIT_LUA,
      [this.rateLimitKey(key)],
      [now, options.windowMs, options.lockoutMs, options.maxAttempts]
    );

    const parsed =
      typeof result === "string"
        ? (JSON.parse(result) as { limited: boolean; retryAfterSeconds: number })
        : (result as { limited: boolean; retryAfterSeconds: number });

    return {
      limited: Boolean(parsed.limited),
      retryAfterSeconds: Number(parsed.retryAfterSeconds) || 0,
    };
  }

  async clearAll(): Promise<void> {
    await this.client.del(this.epochKey());
    if (typeof this.client.keys === "function") {
      try {
        const matchingKeys = await this.client.keys(`${this.prefix}*`);
        if (matchingKeys && matchingKeys.length > 0) {
          await this.client.del(...matchingKeys);
        }
      } catch {
        // Ignored in restricted environments
      }
    }
  }
}
