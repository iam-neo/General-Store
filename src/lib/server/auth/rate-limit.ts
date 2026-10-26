/**
 * Sliding-window rate limiter for login abuse prevention,
 * backed by durable AuthStorageAdapter (shared across instances).
 * Supports atomic operations for concurrent request safety across serverless instances.
 */

import { getAuthStorage, type AuthStorageAdapter, type RateLimitRecord } from "./storage";

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
export const RATE_LIMIT_MAX_FAILED_ATTEMPTS = 5;
export const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

/**
 * Checks whether an identifier (e.g. `ip:username`) is currently rate-limited.
 * Fails closed if shared storage is unavailable or errors.
 */
export async function checkLoginRateLimit(
  key: string,
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  try {
    const now = Date.now();
    const record = await storage.getRateLimit(key);

    if (!record) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    // Check active lockout
    if (record.lockedUntil && now < record.lockedUntil) {
      const remaining = Math.ceil((record.lockedUntil - now) / 1000);
      return { limited: true, retryAfterSeconds: Math.max(1, remaining) };
    }

    // If window has passed, reset
    if (now - record.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
      await storage.clearRateLimit(key);
      return { limited: false, retryAfterSeconds: 0 };
    }

    if (record.attempts >= RATE_LIMIT_MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
      await storage.setRateLimit(key, record, RATE_LIMIT_LOCKOUT_MS);
      return { limited: true, retryAfterSeconds: Math.ceil(RATE_LIMIT_LOCKOUT_MS / 1000) };
    }

    return { limited: false, retryAfterSeconds: 0 };
  } catch {
    // Security fail-closed: if storage is unreachable, block login attempts
    return { limited: true, retryAfterSeconds: Math.ceil(RATE_LIMIT_LOCKOUT_MS / 1000) };
  }
}

/**
 * Records a failed login attempt for the key in durable storage.
 * Uses atomic adapter execution when available to prevent concurrent requests
 * from bypassing the configured lockout threshold.
 * Fails closed if shared storage errors.
 */
export async function recordLoginFailure(
  key: string,
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  try {
    // 1. Prefer atomic update if supported by adapter (e.g. Redis Lua script)
    if (typeof storage.recordLoginFailureAtomic === "function") {
      return await storage.recordLoginFailureAtomic(key, {
        maxAttempts: RATE_LIMIT_MAX_FAILED_ATTEMPTS,
        windowMs: RATE_LIMIT_WINDOW_MS,
        lockoutMs: RATE_LIMIT_LOCKOUT_MS,
      });
    }

    // 2. Standard fallback
    const now = Date.now();
    const existing = await storage.getRateLimit(key);

    let record: RateLimitRecord;

    if (!existing || now - existing.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
      record = {
        attempts: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
      };
      await storage.setRateLimit(key, record, RATE_LIMIT_WINDOW_MS);
      return { limited: false, retryAfterSeconds: 0 };
    }

    record = {
      ...existing,
      attempts: existing.attempts + 1,
      lastAttemptAt: now,
    };

    if (record.attempts >= RATE_LIMIT_MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
      await storage.setRateLimit(key, record, RATE_LIMIT_LOCKOUT_MS);
      return { limited: true, retryAfterSeconds: Math.ceil(RATE_LIMIT_LOCKOUT_MS / 1000) };
    }

    await storage.setRateLimit(key, record, RATE_LIMIT_WINDOW_MS);
    return { limited: false, retryAfterSeconds: 0 };
  } catch {
    // Security fail-closed
    return { limited: true, retryAfterSeconds: Math.ceil(RATE_LIMIT_LOCKOUT_MS / 1000) };
  }
}

/**
 * Clears rate limiting state upon successful authentication.
 */
export async function clearLoginFailures(
  key: string,
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<void> {
  try {
    await storage.clearRateLimit(key);
  } catch {
    // Non-critical, ignore
  }
}

/**
 * Resets rate limit store for testing purposes.
 */
export async function __resetRateLimiterForTesting(): Promise<void> {
  const storage = getAuthStorage();
  if (typeof storage.clearAll === "function") {
    await storage.clearAll();
  }
}
