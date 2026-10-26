import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AuthStorageAdapter, RateLimitRecord, RevokedSessionRecord } from "./interface";

export class FileAuthStorage implements AuthStorageAdapter {
  readonly name = "file";
  private readonly dir: string;
  private readonly revocationsFile: string;
  private readonly epochFile: string;
  private readonly rateLimitsFile: string;

  constructor(customDir?: string) {
    this.dir =
      customDir ||
      process.env.AUTH_STORAGE_DIR ||
      join(process.cwd(), ".auth-store");

    this.revocationsFile = join(this.dir, "revocations.json");
    this.epochFile = join(this.dir, "epoch.json");
    this.rateLimitsFile = join(this.dir, "ratelimits.json");

    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private readJsonFile<T>(filePath: string, fallback: T): T {
    try {
      if (!existsSync(filePath)) return fallback;
      const content = readFileSync(filePath, "utf8");
      return JSON.parse(content) as T;
    } catch {
      return fallback;
    }
  }

  private writeJsonAtomic<T>(filePath: string, data: T): void {
    this.ensureDir();
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    const content = JSON.stringify(data, null, 2);
    try {
      writeFileSync(tempPath, content, "utf8");
      // Node on Windows may fail if destination exists; write directly with fallback
      try {
        renameSync(tempPath, filePath);
      } catch {
        writeFileSync(filePath, content, "utf8");
        try { unlinkSync(tempPath); } catch {}
      }
    } catch {
      // In case of filesystem restriction, write directly
      try {
        writeFileSync(filePath, content, "utf8");
      } catch {
        // Ignored
      }
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const records = this.readJsonFile<Record<string, RevokedSessionRecord>>(
      this.revocationsFile,
      {}
    );
    const entry = records[sessionId];
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      delete records[sessionId];
      this.writeJsonAtomic(this.revocationsFile, records);
      return false;
    }

    return true;
  }

  async revokeSession(sessionId: string, expiresAt: number): Promise<void> {
    const records = this.readJsonFile<Record<string, RevokedSessionRecord>>(
      this.revocationsFile,
      {}
    );
    records[sessionId] = {
      sessionId,
      revokedAt: Date.now(),
      expiresAt,
    };

    // Clean expired
    const now = Date.now();
    for (const [id, rec] of Object.entries(records)) {
      if (now > rec.expiresAt) {
        delete records[id];
      }
    }

    this.writeJsonAtomic(this.revocationsFile, records);
  }

  async getGlobalRevocationEpoch(): Promise<number> {
    const data = this.readJsonFile<{ epoch: number }>(this.epochFile, { epoch: 0 });
    return data.epoch || 0;
  }

  async setGlobalRevocationEpoch(epoch: number): Promise<void> {
    this.writeJsonAtomic(this.epochFile, { epoch });
  }

  async getRateLimit(key: string): Promise<RateLimitRecord | null> {
    const records = this.readJsonFile<
      Record<string, { record: RateLimitRecord; expiresAt: number }>
    >(this.rateLimitsFile, {});

    const entry = records[key];
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      delete records[key];
      this.writeJsonAtomic(this.rateLimitsFile, records);
      return null;
    }

    return entry.record;
  }

  async setRateLimit(key: string, record: RateLimitRecord, ttlMs: number): Promise<void> {
    const records = this.readJsonFile<
      Record<string, { record: RateLimitRecord; expiresAt: number }>
    >(this.rateLimitsFile, {});

    records[key] = {
      record,
      expiresAt: Date.now() + ttlMs,
    };

    // Clean expired
    const now = Date.now();
    for (const [k, v] of Object.entries(records)) {
      if (now > v.expiresAt) {
        delete records[k];
      }
    }

    this.writeJsonAtomic(this.rateLimitsFile, records);
  }

  async clearRateLimit(key: string): Promise<void> {
    const records = this.readJsonFile<
      Record<string, { record: RateLimitRecord; expiresAt: number }>
    >(this.rateLimitsFile, {});

    if (records[key]) {
      delete records[key];
      this.writeJsonAtomic(this.rateLimitsFile, records);
    }
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
    this.writeJsonAtomic(this.revocationsFile, {});
    this.writeJsonAtomic(this.epochFile, { epoch: 0 });
    this.writeJsonAtomic(this.rateLimitsFile, {});
  }
}
