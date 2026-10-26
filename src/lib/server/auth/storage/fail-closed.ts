import type { AuthStorageAdapter, RateLimitRecord } from "./interface";

/**
 * Security fail-closed storage adapter.
 * Used when production mode is detected but no valid shared storage (Redis/KV) credentials exist.
 * Rejects session verification, blocks rate-limit checks, and refuses state mutations.
 */
export class FailClosedAuthStorage implements AuthStorageAdapter {
  readonly name = "fail-closed";
  readonly reason: string;

  constructor(reason: string = "Production shared storage is unconfigured.") {
    this.reason = reason;
  }

  async isSessionRevoked(_sessionId: string): Promise<boolean> {
    // Security fail-closed: treat all sessions as revoked
    return true;
  }

  async revokeSession(_sessionId: string, _expiresAt: number): Promise<void> {
    throw new Error(`Cannot revoke session: ${this.reason}`);
  }

  async getGlobalRevocationEpoch(): Promise<number> {
    // Security fail-closed: return future epoch so all prior and current sessions are invalidated
    return Number.MAX_SAFE_INTEGER;
  }

  async setGlobalRevocationEpoch(_epoch: number): Promise<void> {
    throw new Error(`Cannot set global revocation epoch: ${this.reason}`);
  }

  async getRateLimit(_key: string): Promise<RateLimitRecord | null> {
    // Security fail-closed: treat as locked out
    const now = Date.now();
    return {
      attempts: 999,
      firstAttemptAt: now,
      lastAttemptAt: now,
      lockedUntil: now + 15 * 60 * 1000,
    };
  }

  async setRateLimit(_key: string, _record: RateLimitRecord, _ttlMs: number): Promise<void> {
    throw new Error(`Cannot record rate limit: ${this.reason}`);
  }

  async clearRateLimit(_key: string): Promise<void> {
    throw new Error(`Cannot clear rate limit: ${this.reason}`);
  }

  async recordLoginFailureAtomic(
    _key: string,
    _options: { maxAttempts: number; windowMs: number; lockoutMs: number; now?: number }
  ): Promise<{ limited: boolean; retryAfterSeconds: number }> {
    return { limited: true, retryAfterSeconds: 900 };
  }
}
