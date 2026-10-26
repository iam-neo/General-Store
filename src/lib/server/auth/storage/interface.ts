/**
 * Unified storage adapter interface for durable session revocation,
 * active session tracking, global revocation epochs, and abuse rate limiting.
 */

export type RateLimitRecord = {
  attempts: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
  lockedUntil?: number;
};

export type RevokedSessionRecord = {
  sessionId: string;
  revokedAt: number;
  expiresAt: number;
};

export interface AuthStorageAdapter {
  readonly name: string;

  // Session Revocation & Epoch
  isSessionRevoked(sessionId: string): Promise<boolean>;
  revokeSession(sessionId: string, expiresAt: number): Promise<void>;
  getGlobalRevocationEpoch(): Promise<number>;
  setGlobalRevocationEpoch(epoch: number): Promise<void>;

  // Abuse Protection (Rate Limiting)
  getRateLimit(key: string): Promise<RateLimitRecord | null>;
  setRateLimit(key: string, record: RateLimitRecord, ttlMs: number): Promise<void>;
  clearRateLimit(key: string): Promise<void>;

  // Atomic Abuse Protection (prevent concurrent login race conditions across instances)
  recordLoginFailureAtomic?(
    key: string,
    options: { maxAttempts: number; windowMs: number; lockoutMs: number; now?: number }
  ): Promise<{ limited: boolean; retryAfterSeconds: number }>;

  // Lifecycle
  clearAll?(): Promise<void>;
}
