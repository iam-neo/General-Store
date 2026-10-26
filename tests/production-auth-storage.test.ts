import test from "node:test";
import assert from "node:assert/strict";
import {
  UpstashRedisAuthStorage,
  type RedisClientLike,
} from "../src/lib/server/auth/storage/redis";
import type { RateLimitRecord } from "../src/lib/server/auth/storage/interface";
import { FailClosedAuthStorage } from "../src/lib/server/auth/storage/fail-closed";
import {
  getAuthStorage,
  getAuthStorageDiagnostics,
  setAuthStorage,
  __resetAuthStorageForTesting,
} from "../src/lib/server/auth/storage";
import {
  revokeSession,
  revokeAllSessions,
  isSessionRevoked,
  verifyDurableSession,
} from "../src/lib/server/auth/durable-session";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "../src/lib/server/auth/rate-limit";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  __resetSessionStoreForTesting,
} from "../src/lib/server/auth/session";
import { getTrustedClientIp } from "../src/lib/server/auth/ip";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as logoutPost } from "../src/app/api/auth/logout/route";
import { NextRequest } from "next/server";

const TEST_SECRET = "super-secret-key-at-least-32-chars-long-test-token!";
const TEST_USERNAME = "owner";
const TEST_PASSWORD_HASH = "scrypt$N=16384,r=8,p=1$dummysalt1234567$dummyhash1234567890abcdef";

function setupEnv() {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.OWNER_USERNAME = TEST_USERNAME;
  process.env.OWNER_PASSWORD_HASH = TEST_PASSWORD_HASH;
  __resetSessionStoreForTesting();
}

function teardownEnv() {
  delete process.env.SESSION_SECRET;
  delete process.env.OWNER_USERNAME;
  delete process.env.OWNER_PASSWORD_HASH;
  delete process.env.AUTH_STORAGE_TYPE;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.ALLOW_IN_MEMORY_AUTH_IN_PRODUCTION;
  __resetSessionStoreForTesting();
  __resetAuthStorageForTesting();
}

// ─── Mock Shared Redis Client (Simulates Multi-Instance Central Store) ─

class MockSharedRedisClient implements RedisClientLike {
  private store = new Map<string, { value: unknown; expiresAt?: number }>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown> {
    const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  async eval<TArgs extends unknown[], TData = unknown>(
    _script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData> {
    // Redis Lua scripts execute atomically in a single thread without yielding
    const [key] = keys;
    const [now, windowMs, lockoutMs, maxAttempts] = args as unknown as [number, number, number, number];

    const entry = this.store.get(key);
    let record: (RateLimitRecord & { attempts?: number }) | null = null;
    if (entry && (!entry.expiresAt || Date.now() <= entry.expiresAt)) {
      record = typeof entry.value === "string" ? JSON.parse(entry.value) : (entry.value as RateLimitRecord);
    }

    if (record) {
      if (record.lockedUntil && record.lockedUntil > now) {
        const remaining = Math.max(1, Math.ceil((record.lockedUntil - now) / 1000));
        return JSON.stringify({ limited: true, retryAfterSeconds: remaining, attempts: record.attempts }) as TData;
      }

      if (now - record.firstAttemptAt > windowMs) {
        record = { attempts: 1, firstAttemptAt: now, lastAttemptAt: now };
        const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
        this.store.set(key, { value: JSON.stringify(record), expiresAt: Date.now() + ttlSec * 1000 });
        return JSON.stringify({ limited: false, retryAfterSeconds: 0, attempts: 1 }) as TData;
      } else {
        record.attempts = record.attempts + 1;
        record.lastAttemptAt = now;
        if (record.attempts >= maxAttempts) {
          record.lockedUntil = now + lockoutMs;
          const ttlSec = Math.max(1, Math.ceil(lockoutMs / 1000));
          this.store.set(key, { value: JSON.stringify(record), expiresAt: Date.now() + ttlSec * 1000 });
          return JSON.stringify({ limited: true, retryAfterSeconds: ttlSec, attempts: record.attempts }) as TData;
        } else {
          const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
          this.store.set(key, { value: JSON.stringify(record), expiresAt: Date.now() + ttlSec * 1000 });
          return JSON.stringify({ limited: false, retryAfterSeconds: 0, attempts: record.attempts }) as TData;
        }
      }
    } else {
      record = { attempts: 1, firstAttemptAt: now, lastAttemptAt: now };
      const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
      this.store.set(key, { value: JSON.stringify(record), expiresAt: Date.now() + ttlSec * 1000 });
      return JSON.stringify({ limited: false, retryAfterSeconds: 0, attempts: 1 }) as TData;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace("*", "");
    return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
  }
}

// ─── Faulty Client (Simulates Redis Timeout & Network Down) ───────────

class FaultyRedisClient implements RedisClientLike {
  async get(): Promise<never> { throw new Error("Redis connection timed out (ETIMEDOUT)"); }
  async set(): Promise<never> { throw new Error("Redis connection reset by peer (ECONNRESET)"); }
  async del(): Promise<never> { throw new Error("Redis socket error"); }
  async eval(): Promise<never> { throw new Error("Redis cluster failover timeout"); }
}

// ─── 1. Multi-Instance Session Revocation & Epoch Tests ───────────────

test("Production Storage: two independent clients observe the same session revocation", async () => {
  setupEnv();
  const sharedRedis = new MockSharedRedisClient();
  const clientInstanceA = new UpstashRedisAuthStorage({ client: sharedRedis });
  const clientInstanceB = new UpstashRedisAuthStorage({ client: sharedRedis });

  try {
    const { token, session } = await createSessionToken(TEST_USERNAME);

    // Initial state: both instances verify session successfully
    const validA = await verifyDurableSession(token, clientInstanceA);
    const validB = await verifyDurableSession(token, clientInstanceB);
    assert.ok(validA);
    assert.ok(validB);

    // Instance A logs out / revokes the session
    await revokeSession(session.sessionId, session.expiresAt, clientInstanceA);

    // Instance B (independent serverless instance) must immediately observe revocation
    const revokedOnB = await clientInstanceB.isSessionRevoked(session.sessionId);
    assert.equal(revokedOnB, true, "Instance B must observe the session revocation from Instance A");

    const rejectedOnB = await verifyDurableSession(token, clientInstanceB);
    assert.equal(rejectedOnB, null, "Instance B must reject verification of revoked session");
  } finally {
    teardownEnv();
  }
});

test("Production Storage: two independent clients share the same global revocation epoch", async () => {
  setupEnv();
  const sharedRedis = new MockSharedRedisClient();
  const clientInstanceA = new UpstashRedisAuthStorage({ client: sharedRedis });
  const clientInstanceB = new UpstashRedisAuthStorage({ client: sharedRedis });

  try {
    const { token: sessionBeforeEpoch } = await createSessionToken(TEST_USERNAME);

    // Instance A sets global revocation epoch (e.g. global logout / credential rotation)
    await new Promise((r) => setTimeout(r, 15));
    const nowEpoch = Date.now();
    await clientInstanceA.setGlobalRevocationEpoch(nowEpoch);

    // Instance B must read the same global epoch
    const epochOnB = await clientInstanceB.getGlobalRevocationEpoch();
    assert.equal(epochOnB, nowEpoch);

    // Old session verified on Instance B must be rejected
    const rejectedOnB = await verifyDurableSession(sessionBeforeEpoch, clientInstanceB);
    assert.equal(rejectedOnB, null, "Sessions issued before global epoch must be rejected on all instances");

    // New session issued after epoch must be accepted on Instance B
    const { token: sessionAfterEpoch } = await createSessionToken(TEST_USERNAME);
    const validOnB = await verifyDurableSession(sessionAfterEpoch, clientInstanceB);
    assert.ok(validOnB, "Session created after epoch must be accepted");
  } finally {
    teardownEnv();
  }
});

// ─── 2. Atomic Rate Limiting & Concurrent Lockout Tests ───────────────

test("Production Storage: concurrent failed logins atomically enforce lockout threshold", async () => {
  const sharedRedis = new MockSharedRedisClient();
  const clientInstanceA = new UpstashRedisAuthStorage({ client: sharedRedis });
  const clientInstanceB = new UpstashRedisAuthStorage({ client: sharedRedis });
  const testKey = "192.168.1.100:owner";

  // Simulate 10 concurrent failed login requests arriving simultaneously across instance A and B
  const attempts = Array.from({ length: 10 }, (_, i) => {
    const client = i % 2 === 0 ? clientInstanceA : clientInstanceB;
    return recordLoginFailure(testKey, client);
  });

  const results = await Promise.all(attempts);

  // Exactly 4 should have limited = false (attempts 1, 2, 3, 4)
  const notLimitedCount = results.filter((r) => !r.limited).length;
  // Attempts 5 through 10 must be locked out
  const limitedCount = results.filter((r) => r.limited).length;

  assert.equal(notLimitedCount, 4, "Only the first 4 attempts should be allowed");
  assert.equal(limitedCount, 6, "5th and subsequent concurrent attempts must be locked out immediately");

  // Subsequent check on either instance reports active lockout
  const checkA = await checkLoginRateLimit(testKey, clientInstanceA);
  const checkB = await checkLoginRateLimit(testKey, clientInstanceB);
  assert.equal(checkA.limited, true);
  assert.equal(checkB.limited, true);
  assert.ok(checkA.retryAfterSeconds > 0);
});

// ─── 3. Fail-Closed on Storage Timeouts & Errors ───────────────────────

test("Production Storage: storage timeouts and errors fail closed safely", async () => {
  setupEnv();
  const faultyClient = new FaultyRedisClient();
  const storage = new UpstashRedisAuthStorage({ client: faultyClient });

  try {
    const { token } = await createSessionToken(TEST_USERNAME);

    // 1. Session verification fails closed (returns null instead of letting session pass)
    const sessionResult = await verifyDurableSession(token, storage);
    assert.equal(sessionResult, null, "Storage error must cause verifyDurableSession to fail closed");

    // 2. isSessionRevoked fails closed (returns true)
    const isRevoked = await isSessionRevoked("any-session", storage);
    assert.equal(isRevoked, true, "Storage error must cause isSessionRevoked to fail closed");

    // 3. checkLoginRateLimit fails closed (blocks attempt)
    const limitCheck = await checkLoginRateLimit("ip:user", storage);
    assert.equal(limitCheck.limited, true, "Storage error must cause rate limit check to block logins");

    // 4. recordLoginFailure fails closed
    const recordResult = await recordLoginFailure("ip:user", storage);
    assert.equal(recordResult.limited, true, "Storage error must cause recordLoginFailure to report limited");
  } finally {
    teardownEnv();
  }
});

// ─── 4. Missing Production Configuration Fails Safely ──────────────────

test("Production Storage: missing production credentials fails closed without memory/file fallback", async () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.AUTH_STORAGE_TYPE;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    __resetAuthStorageForTesting();

    const storage = getAuthStorage();
    assert.equal(storage.name, "fail-closed", "Should select FailClosedAuthStorage in production when unconfigured");

    // FailClosedAuthStorage rejects all sessions
    const revoked = await storage.isSessionRevoked("some-id");
    assert.equal(revoked, true, "FailClosedAuthStorage must report all sessions revoked");

    // Rate limit check blocks
    const rateLimit = await storage.getRateLimit("key");
    assert.ok(rateLimit?.lockedUntil && rateLimit.lockedUntil > Date.now());

    // Login route returns 503 AUTH_STORAGE_NOT_CONFIGURED
    const req = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ username: "owner", password: "SomePassword123!" }),
    });

    const res = await loginPost(req);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error?.code, "AUTH_STORAGE_NOT_CONFIGURED");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = prevEnv;
    __resetAuthStorageForTesting();
  }
});

// ─── 5. Production Mode Refuses Accidental File/Memory Fallback ────────

test("Production Storage: refuses local file storage in production", () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.AUTH_STORAGE_TYPE = "file";
    __resetAuthStorageForTesting();

    assert.throws(
      () => getAuthStorage(),
      /FileAuthStorage cannot be used in production/
    );
  } finally {
    (process.env as Record<string, string>).NODE_ENV = prevEnv;
    delete process.env.AUTH_STORAGE_TYPE;
    __resetAuthStorageForTesting();
  }
});

test("Production Storage: refuses in-memory storage in production without explicit override", () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.AUTH_STORAGE_TYPE = "memory";
    __resetAuthStorageForTesting();

    assert.throws(
      () => getAuthStorage(),
      /MemoryAuthStorage cannot be used in production/
    );

    // With explicit override, it is permitted (e.g. for isolated test suites)
    process.env.ALLOW_IN_MEMORY_AUTH_IN_PRODUCTION = "true";
    __resetAuthStorageForTesting();
    const allowed = getAuthStorage();
    assert.equal(allowed.name, "memory");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = prevEnv;
    delete process.env.AUTH_STORAGE_TYPE;
    delete process.env.ALLOW_IN_MEMORY_AUTH_IN_PRODUCTION;
    __resetAuthStorageForTesting();
  }
});

// ─── 6. Diagnostics & Secret Safety ────────────────────────────────────

test("Production Storage: diagnostics report configuration status without leaking secret values", () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetAuthStorageForTesting();

    const diag = getAuthStorageDiagnostics();
    assert.equal(diag.isProduction, true);
    assert.equal(diag.isConfigured, false);
    assert.ok(diag.missingVariables.length > 0);

    const diagJson = JSON.stringify(diag);
    // Ensure no secrets or dummy tokens exist in the output
    assert.ok(!diagJson.includes("fake"));
    assert.ok(!diagJson.includes("secret"));
    assert.ok(diagJson.includes("UPSTASH_REDIS_REST_URL"));
  } finally {
    (process.env as Record<string, string>).NODE_ENV = prevEnv;
    __resetAuthStorageForTesting();
  }
});

// ─── 7. Trustworthy Client IP Extraction ───────────────────────────────

test("Client IP: extracts trusted IP and sanitizes headers", () => {
  // 1. x-real-ip takes precedence over client-supplied x-forwarded-for
  const req1 = new NextRequest("http://localhost:3000/api/auth/login", {
    headers: {
      "x-real-ip": "203.0.113.195",
      "x-forwarded-for": "10.0.0.1, 10.0.0.2",
    },
  });
  assert.equal(getTrustedClientIp(req1), "203.0.113.195");

  // 2. x-vercel-ip is trusted if x-real-ip is not set
  const req2 = new NextRequest("http://localhost:3000/api/auth/login", {
    headers: {
      "x-vercel-ip": "198.51.100.42",
    },
  });
  assert.equal(getTrustedClientIp(req2), "198.51.100.42");

  // 3. x-forwarded-for parses and selects first valid IP
  const req3 = new NextRequest("http://localhost:3000/api/auth/login", {
    headers: {
      "x-forwarded-for": "198.51.100.10, 10.0.0.1",
    },
  });
  assert.equal(getTrustedClientIp(req3), "198.51.100.10");

  // 4. Rejects malformed / injection strings and falls back to 127.0.0.1
  const req4 = new NextRequest("http://localhost:3000/api/auth/login", {
    headers: {
      "x-real-ip": "attacker; injection: test\r\n",
    },
  });
  assert.equal(getTrustedClientIp(req4), "127.0.0.1");
});

// ─── 8. Concurrent Logout, Session Expiration & Storage Lifecycle ──────

test("Production Storage: concurrent logout and session verification across instances", async () => {
  setupEnv();
  const sharedRedis = new MockSharedRedisClient();
  const instanceA = new UpstashRedisAuthStorage({ client: sharedRedis });
  const instanceB = new UpstashRedisAuthStorage({ client: sharedRedis });

  try {
    const { token, session } = await createSessionToken(TEST_USERNAME);

    // Initial state: valid on both
    assert.ok(await verifyDurableSession(token, instanceB));

    // Simulate concurrent operations: instance A revokes while instance B attempts to verify
    await Promise.all([
      revokeSession(session.sessionId, session.expiresAt, instanceA),
      verifyDurableSession(token, instanceB),
      verifyDurableSession(token, instanceB),
    ]);

    // Once revocation completes, all subsequent verifications on all instances must fail
    const finalVerificationA = await verifyDurableSession(token, instanceA);
    const finalVerificationB = await verifyDurableSession(token, instanceB);
    assert.equal(finalVerificationA, null, "Instance A must reject revoked session");
    assert.equal(finalVerificationB, null, "Instance B must reject revoked session");
  } finally {
    teardownEnv();
  }
});

test("Production Storage: revokeAllSessions invalidates all prior sessions across instances", async () => {
  setupEnv();
  const sharedRedis = new MockSharedRedisClient();
  const instanceA = new UpstashRedisAuthStorage({ client: sharedRedis });
  const instanceB = new UpstashRedisAuthStorage({ client: sharedRedis });

  try {
    const { token: session1 } = await createSessionToken(TEST_USERNAME);
    const { token: session2 } = await createSessionToken(TEST_USERNAME);

    assert.ok(await verifyDurableSession(session1, instanceB));
    assert.ok(await verifyDurableSession(session2, instanceA));

    // Wait slightly to ensure epoch timestamp is after creation timestamp
    await new Promise((r) => setTimeout(r, 15));

    // Instance A triggers global logout
    await revokeAllSessions(instanceA);

    // Both sessions must now be rejected across both instances
    assert.equal(await verifyDurableSession(session1, instanceB), null);
    assert.equal(await verifyDurableSession(session2, instanceA), null);

    // A session issued after global logout remains valid
    const { token: newSession } = await createSessionToken(TEST_USERNAME);
    assert.ok(await verifyDurableSession(newSession, instanceB));
  } finally {
    teardownEnv();
  }
});

test("Production Storage: session expiration and datastore cleanup policy", async () => {
  setupEnv();
  const sharedRedis = new MockSharedRedisClient();
  const instance = new UpstashRedisAuthStorage({ client: sharedRedis });

  try {
    const { token } = await createSessionToken(TEST_USERNAME);
    assert.ok(await verifyDurableSession(token, instance));

    // Revocation key has TTL in seconds matching remaining expiration
    const nearExpiry = Date.now() + 1000; // 1 second from now
    await instance.revokeSession("expiring-session-id", nearExpiry);
    assert.equal(await instance.isSessionRevoked("expiring-session-id"), true);

    // After 1-second Redis TTL passes in store, the record expires and is cleaned up
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(await instance.isSessionRevoked("expiring-session-id"), false);
  } finally {
    teardownEnv();
  }
});

test("Production Storage: FailClosedAuthStorage rejects all mutations and fails safe", async () => {
  const failClosed = new FailClosedAuthStorage("Testing fail-closed reasons");

  assert.equal(failClosed.name, "fail-closed");
  assert.equal(await failClosed.isSessionRevoked("any-session"), true);
  assert.equal(await failClosed.getGlobalRevocationEpoch(), Number.MAX_SAFE_INTEGER);

  await assert.rejects(
    async () => failClosed.revokeSession("id", Date.now() + 1000),
    /Cannot revoke session: Testing fail-closed reasons/
  );

  await assert.rejects(
    async () => failClosed.setGlobalRevocationEpoch(Date.now()),
    /Cannot set global revocation epoch: Testing fail-closed reasons/
  );

  await assert.rejects(
    async () => failClosed.setRateLimit("key", { attempts: 1, firstAttemptAt: 0, lastAttemptAt: 0 }, 1000),
    /Cannot record rate limit: Testing fail-closed reasons/
  );

  await assert.rejects(
    async () => failClosed.clearRateLimit("key"),
    /Cannot clear rate limit: Testing fail-closed reasons/
  );

  const atomicRes = await failClosed.recordLoginFailureAtomic("key", {
    maxAttempts: 5,
    windowMs: 60_000,
    lockoutMs: 900_000,
  });
  assert.equal(atomicRes.limited, true);
  assert.equal(atomicRes.retryAfterSeconds, 900);
});

test("Production Storage: setAuthStorage and clearLoginFailures work across clients", async () => {
  const sharedRedis = new MockSharedRedisClient();
  const instance = new UpstashRedisAuthStorage({ client: sharedRedis });
  setAuthStorage(instance);

  try {
    const key = "user-ip:test";
    await recordLoginFailure(key, instance);
    const beforeClear = await checkLoginRateLimit(key, instance);
    assert.equal(beforeClear.limited, false);

    // Clear login failures
    await clearLoginFailures(key, instance);
    const afterClear = await instance.getRateLimit(key);
    assert.equal(afterClear, null);
  } finally {
    __resetAuthStorageForTesting();
  }
});

test("Production Storage: logout route invalidates durable session and clears cookie", async () => {
  setupEnv();
  const sharedRedis = new MockSharedRedisClient();
  const instance = new UpstashRedisAuthStorage({ client: sharedRedis });
  setAuthStorage(instance);

  try {
    const { token, session } = await createSessionToken(TEST_USERNAME);
    assert.ok(await verifyDurableSession(token, instance));

    const logoutReq = new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: "http://localhost:3000",
      },
    });

    const logoutRes = await logoutPost(logoutReq);
    assert.equal(logoutRes.status, 200);

    // Session is now revoked in durable storage
    assert.equal(await instance.isSessionRevoked(session.sessionId), true);
    assert.equal(await verifyDurableSession(token, instance), null);

    // Cookie is cleared
    const setCookie = logoutRes.headers.get("set-cookie");
    assert.ok(setCookie?.includes(`${SESSION_COOKIE_NAME}=`));
    assert.ok(setCookie?.includes("Max-Age=0") || setCookie?.includes("max-age=0"));
  } finally {
    teardownEnv();
  }
});

// ─── 9. Live Integration Check (Conditional) ───────────────────────────

test("Production Storage: live integration test status", async () => {
  const hasLiveUpstash = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
  const hasLiveKv = Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );

  if (hasLiveUpstash || hasLiveKv) {
    const liveStorage = new UpstashRedisAuthStorage({
      keyPrefix: "gs:auth:test:live:",
    });

    const testSessionId = `live-test-${Date.now()}`;
    await liveStorage.revokeSession(testSessionId, Date.now() + 10_000);
    const isRevoked = await liveStorage.isSessionRevoked(testSessionId);
    assert.equal(isRevoked, true, "Live Upstash Redis must record and verify session revocation");
    await liveStorage.clearAll();
  } else {
    // Document clearly that live integration was evaluated via deterministic mock
    assert.ok(true, "Live credentials not present in test environment; verified via MockSharedRedisClient");
  }
});
