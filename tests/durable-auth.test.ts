import test from "node:test";
import assert from "node:assert/strict";
import { MemoryAuthStorage } from "../src/lib/server/auth/storage/memory";
import { FileAuthStorage } from "../src/lib/server/auth/storage/file";
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
  __resetSessionStoreForTesting,
} from "../src/lib/server/auth/session";
import { __resetAuthStorageForTesting, setAuthStorage } from "../src/lib/server/auth/storage";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";

const TEST_SECRET = "super-secret-key-at-least-32-chars-long-test-token!";
const TEST_USERNAME = "owner";

function setupTestEnv() {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.OWNER_USERNAME = TEST_USERNAME;
  process.env.OWNER_PASSWORD_HASH =
    "scrypt$N=16384,r=8,p=1$dummysalt1234567$dummyhash1234567890abcdef";
  __resetSessionStoreForTesting();
}

function teardownTestEnv() {
  delete process.env.SESSION_SECRET;
  delete process.env.OWNER_USERNAME;
  delete process.env.OWNER_PASSWORD_HASH;
  __resetSessionStoreForTesting();
  __resetAuthStorageForTesting();
}

// ─── MemoryAuthStorage Tests ──────────────────────────────────────────

test("MemoryAuthStorage: session revocation and lookup", async () => {
  const storage = new MemoryAuthStorage();

  // Not revoked initially
  assert.equal(await storage.isSessionRevoked("session-1"), false);

  // Revoke a session
  await storage.revokeSession("session-1", Date.now() + 60_000);
  assert.equal(await storage.isSessionRevoked("session-1"), true);

  // Non-revoked session is still unaffected
  assert.equal(await storage.isSessionRevoked("session-2"), false);
});

test("MemoryAuthStorage: expired revocations are automatically cleaned", async () => {
  const storage = new MemoryAuthStorage();

  // Revoke with expiry in the past
  await storage.revokeSession("expired-session", Date.now() - 1000);
  assert.equal(await storage.isSessionRevoked("expired-session"), false);
});

test("MemoryAuthStorage: global revocation epoch", async () => {
  const storage = new MemoryAuthStorage();

  assert.equal(await storage.getGlobalRevocationEpoch(), 0);

  const epoch = Date.now();
  await storage.setGlobalRevocationEpoch(epoch);
  assert.equal(await storage.getGlobalRevocationEpoch(), epoch);
});

test("MemoryAuthStorage: rate limiting records", async () => {
  const storage = new MemoryAuthStorage();

  // No record initially
  assert.equal(await storage.getRateLimit("test-key"), null);

  // Set a record
  const record = { attempts: 3, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() };
  await storage.setRateLimit("test-key", record, 60_000);

  const retrieved = await storage.getRateLimit("test-key");
  assert.deepEqual(retrieved, record);

  // Clear it
  await storage.clearRateLimit("test-key");
  assert.equal(await storage.getRateLimit("test-key"), null);
});

test("MemoryAuthStorage: expired rate limits are cleaned on read", async () => {
  const storage = new MemoryAuthStorage();

  const record = { attempts: 1, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() };
  await storage.setRateLimit("expired-key", record, -1); // Already expired
  assert.equal(await storage.getRateLimit("expired-key"), null);
});

test("MemoryAuthStorage: clearAll wipes everything", async () => {
  const storage = new MemoryAuthStorage();

  await storage.revokeSession("s1", Date.now() + 60_000);
  await storage.setGlobalRevocationEpoch(Date.now());
  await storage.setRateLimit("k1", { attempts: 1, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() }, 60_000);

  await storage.clearAll();

  assert.equal(await storage.isSessionRevoked("s1"), false);
  assert.equal(await storage.getGlobalRevocationEpoch(), 0);
  assert.equal(await storage.getRateLimit("k1"), null);
});

// ─── FileAuthStorage Tests ────────────────────────────────────────────

const TEST_STORAGE_DIR = join(process.cwd(), ".auth-store-test");

function cleanTestDir() {
  if (existsSync(TEST_STORAGE_DIR)) {
    rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
  }
}

test("FileAuthStorage: creates directory and handles session revocation", async () => {
  cleanTestDir();
  try {
    const storage = new FileAuthStorage(TEST_STORAGE_DIR);

    assert.equal(await storage.isSessionRevoked("file-session-1"), false);

    await storage.revokeSession("file-session-1", Date.now() + 60_000);
    assert.equal(await storage.isSessionRevoked("file-session-1"), true);
    assert.equal(await storage.isSessionRevoked("file-session-2"), false);
  } finally {
    cleanTestDir();
  }
});

test("FileAuthStorage: revocation survives re-instantiation (simulates multi-instance)", async () => {
  cleanTestDir();
  try {
    // Instance A revokes a session
    const storageA = new FileAuthStorage(TEST_STORAGE_DIR);
    await storageA.revokeSession("cross-instance-session", Date.now() + 60_000);

    // Instance B (new process / new instance) reads the same storage directory
    const storageB = new FileAuthStorage(TEST_STORAGE_DIR);
    assert.equal(
      await storageB.isSessionRevoked("cross-instance-session"),
      true,
      "Session revoked by instance A must be visible to instance B"
    );
  } finally {
    cleanTestDir();
  }
});

test("FileAuthStorage: global epoch persists across instances", async () => {
  cleanTestDir();
  try {
    const storageA = new FileAuthStorage(TEST_STORAGE_DIR);
    const epoch = Date.now();
    await storageA.setGlobalRevocationEpoch(epoch);

    const storageB = new FileAuthStorage(TEST_STORAGE_DIR);
    assert.equal(
      await storageB.getGlobalRevocationEpoch(),
      epoch,
      "Global epoch set by instance A must be readable by instance B"
    );
  } finally {
    cleanTestDir();
  }
});

test("FileAuthStorage: rate limits persist and expire correctly", async () => {
  cleanTestDir();
  try {
    const storage = new FileAuthStorage(TEST_STORAGE_DIR);

    const record = { attempts: 4, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() };
    await storage.setRateLimit("file-rate-key", record, 60_000);

    // Survives re-read
    const retrieved = await storage.getRateLimit("file-rate-key");
    assert.deepEqual(retrieved, record);

    // Expired entry is cleaned
    const expiredRecord = { attempts: 1, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() };
    await storage.setRateLimit("expired-file-key", expiredRecord, -1);
    assert.equal(await storage.getRateLimit("expired-file-key"), null);
  } finally {
    cleanTestDir();
  }
});

test("FileAuthStorage: clearAll resets all files", async () => {
  cleanTestDir();
  try {
    const storage = new FileAuthStorage(TEST_STORAGE_DIR);
    await storage.revokeSession("s1", Date.now() + 60_000);
    await storage.setGlobalRevocationEpoch(Date.now());
    await storage.setRateLimit("k1", { attempts: 1, firstAttemptAt: Date.now(), lastAttemptAt: Date.now() }, 60_000);

    await storage.clearAll();

    assert.equal(await storage.isSessionRevoked("s1"), false);
    assert.equal(await storage.getGlobalRevocationEpoch(), 0);
    assert.equal(await storage.getRateLimit("k1"), null);
  } finally {
    cleanTestDir();
  }
});

// ─── Durable Session Verification Integration Tests ───────────────────

test("Durable Session: verifyDurableSession rejects individually revoked sessions", async () => {
  setupTestEnv();
  const storage = new MemoryAuthStorage();
  setAuthStorage(storage);

  try {
    const { token, session } = await createSessionToken(TEST_USERNAME);

    // Valid before revocation
    const valid = await verifyDurableSession(token, storage);
    assert.ok(valid, "Session should be valid before revocation");
    assert.equal(valid?.sessionId, session.sessionId);

    // Revoke using durable storage
    await revokeSession(session.sessionId, session.expiresAt, storage);

    // Now rejected
    const rejected = await verifyDurableSession(token, storage);
    assert.equal(rejected, null, "Session should be rejected after durable revocation");
  } finally {
    teardownTestEnv();
  }
});

test("Durable Session: verifyDurableSession rejects sessions issued before global epoch", async () => {
  setupTestEnv();
  const storage = new MemoryAuthStorage();
  setAuthStorage(storage);

  try {
    const { token } = await createSessionToken(TEST_USERNAME);

    // Set global epoch to now (all sessions created before this are invalid)
    await new Promise((r) => setTimeout(r, 10)); // Ensure time difference
    await revokeAllSessions(storage);

    const rejected = await verifyDurableSession(token, storage);
    assert.equal(rejected, null, "Session created before global epoch should be rejected");

    // New session created after epoch should work
    const { token: newToken } = await createSessionToken(TEST_USERNAME);
    const valid = await verifyDurableSession(newToken, storage);
    assert.ok(valid, "Session created after epoch should be valid");
  } finally {
    teardownTestEnv();
  }
});

test("Durable Session: rejects null, undefined, empty, and malformed tokens", async () => {
  setupTestEnv();
  const storage = new MemoryAuthStorage();
  setAuthStorage(storage);

  try {
    assert.equal(await verifyDurableSession(null, storage), null);
    assert.equal(await verifyDurableSession(undefined, storage), null);
    assert.equal(await verifyDurableSession("", storage), null);
    assert.equal(await verifyDurableSession("not.a.valid.token", storage), null);
    assert.equal(await verifyDurableSession("short", storage), null);
  } finally {
    teardownTestEnv();
  }
});

// ─── Durable Rate Limiting Integration Tests ──────────────────────────

test("Durable Rate Limiting: sliding window enforced across storage instances", async () => {
  const storage = new MemoryAuthStorage();
  const testKey = "durable-rate-test:user";

  // First 4 failures: not locked
  for (let i = 1; i <= 4; i++) {
    const result = await recordLoginFailure(testKey, storage);
    assert.equal(result.limited, false, `Attempt ${i} should not be rate-limited`);
  }

  // 5th failure triggers lockout
  const lockout = await recordLoginFailure(testKey, storage);
  assert.equal(lockout.limited, true, "5th failure should trigger lockout");
  assert.ok(lockout.retryAfterSeconds > 0);

  // Checking rate limit confirms lockout
  const check = await checkLoginRateLimit(testKey, storage);
  assert.equal(check.limited, true, "Rate limit check should report locked state");

  // Clear failures
  await clearLoginFailures(testKey, storage);
  const cleared = await checkLoginRateLimit(testKey, storage);
  assert.equal(cleared.limited, false, "After clearing, rate limit should be gone");
});

test("Durable Rate Limiting: lockout persists across FileAuthStorage instances", async () => {
  cleanTestDir();
  try {
    const storageA = new FileAuthStorage(TEST_STORAGE_DIR);
    const testKey = "file-rate-cross:user";

    // Build up to lockout on instance A
    for (let i = 1; i <= 5; i++) {
      await recordLoginFailure(testKey, storageA);
    }

    // Instance B reads the lockout state
    const storageB = new FileAuthStorage(TEST_STORAGE_DIR);
    const check = await checkLoginRateLimit(testKey, storageB);
    assert.equal(
      check.limited,
      true,
      "Lockout set by instance A must be visible to instance B"
    );
  } finally {
    cleanTestDir();
  }
});

// ─── isSessionRevoked standalone tests ────────────────────────────────

test("isSessionRevoked: returns true for revoked and false for unrevoked sessions", async () => {
  const storage = new MemoryAuthStorage();

  assert.equal(await isSessionRevoked("never-revoked", storage), false);

  await revokeSession("revoked-one", Date.now() + 60_000, storage);
  assert.equal(await isSessionRevoked("revoked-one", storage), true);
  assert.equal(await isSessionRevoked("never-revoked", storage), false);
});

test("isSessionRevoked: empty session ID is always revoked", async () => {
  const storage = new MemoryAuthStorage();
  assert.equal(await isSessionRevoked("", storage), true);
});
