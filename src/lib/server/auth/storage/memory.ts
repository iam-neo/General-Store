import type { AuthStorageAdapter, RateLimitRecord, RevokedSessionRecord } from "./interface";

export class MemoryAuthStorage implements AuthStorageAdapter {
  readonly name = "memory";
  private revokedSessions = new Map<string, RevokedSessionRecord>();
  private globalEpoch: number = 0;
  private rateLimits = new Map<string, { record: RateLimitRecord; expiresAt: number }>();

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const record = this.revokedSessions.get(sessionId);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      this.revokedSessions.delete(sessionId);
      return false;
    }
    return true;
  }

  async revokeSession(sessionId: string, expiresAt: number): Promise<void> {
    this.revokedSessions.set(sessionId, {
      sessionId,
      revokedAt: Date.now(),
      expiresAt,
    });
  }

  async getGlobalRevocationEpoch(): Promise<number> {
    return this.globalEpoch;
  }

  async setGlobalRevocationEpoch(epoch: number): Promise<void> {
    this.globalEpoch = epoch;
  }

  async getRateLimit(key: string): Promise<RateLimitRecord | null> {
    const entry = this.rateLimits.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.rateLimits.delete(key);
      return null;
    }
    return entry.record;
  }

  async setRateLimit(key: string, record: RateLimitRecord, ttlMs: number): Promise<void> {
    this.rateLimits.set(key, {
      record,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async clearRateLimit(key: string): Promise<void> {
    this.rateLimits.delete(key);
  }

  async recordLoginFailureAtomic(
    key: string,
    options: { maxAttempts: number; windowMs: number; lockoutMs: number; now?: number }
  ): Promise<{ limited: boolean; retryAfterSeconds: number }> {
    const now = options.now ?? Date.now();
    const existing = await this.getRateLimit(key);

    let record: RateLimitRecord;
    if (!existing || now - existing.firstAttemptAt > options.windowMs) {
      record = {
        attempts: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
      };
      await this.setRateLimit(key, record, options.windowMs);
      return { limited: false, retryAfterSeconds: 0 };
    }

    record = {
      ...existing,
      attempts: existing.attempts + 1,
      lastAttemptAt: now,
    };

    if (record.attempts >= options.maxAttempts) {
      record.lockedUntil = now + options.lockoutMs;
      await this.setRateLimit(key, record, options.lockoutMs);
      return { limited: true, retryAfterSeconds: Math.ceil(options.lockoutMs / 1000) };
    }

    await this.setRateLimit(key, record, options.windowMs);
    return { limited: false, retryAfterSeconds: 0 };
  }

  async clearAll(): Promise<void> {
    this.revokedSessions.clear();
    this.globalEpoch = 0;
    this.rateLimits.clear();
  }
}
