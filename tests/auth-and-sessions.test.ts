import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  hashPassword,
  verifyPassword,
  verifyOwnerCredentials,
  constantTimeStringEquals,
  createSessionToken,
  verifySessionToken,
  revokeSessionLocal,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
  __resetSessionStoreForTesting,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  __resetRateLimiterForTesting,
} from "../src/lib/server/auth";
import { middleware } from "../src/middleware";
import { POST as initDatabasePost } from "../src/app/api/system/init-database/route";
import { GET as schemaStatusGet } from "../src/app/api/system/schema-status/route";
import { POST as testRecordPost, GET as testRecordGet } from "../src/app/api/system/test-record/route";
import { POST as loginPost } from "../src/app/api/auth/login/route";
import { POST as logoutPost } from "../src/app/api/auth/logout/route";
import { GET as meGet } from "../src/app/api/auth/me/route";

const TEST_SECRET = "super-secret-key-at-least-32-chars-long-test-token!";
const TEST_USERNAME = "owner";
const TEST_PASSWORD = "StorePassword#2026!";

// Helper to configure valid test auth environment
async function setupTestAuthEnv() {
  const hash = await hashPassword(TEST_PASSWORD);
  process.env.OWNER_USERNAME = TEST_USERNAME;
  process.env.OWNER_PASSWORD_HASH = hash;
  process.env.SESSION_SECRET = TEST_SECRET;
  __resetSessionStoreForTesting();
  __resetRateLimiterForTesting();
  return { hash };
}

function teardownTestAuthEnv() {
  delete process.env.OWNER_USERNAME;
  delete process.env.OWNER_PASSWORD_HASH;
  delete process.env.SESSION_SECRET;
  delete process.env.ALLOW_TEST_WRITES;
  __resetSessionStoreForTesting();
  __resetRateLimiterForTesting();
}

test("Password Hashing: generates valid scrypt format and verifies correctly", async () => {
  const password = "ValidStorePassword123!";
  const hash = await hashPassword(password);

  assert.ok(hash.startsWith("scrypt$N=16384,r=8,p=1$"));
  const parts = hash.split("$");
  assert.equal(parts.length, 4);

  // Correct password matches
  const match = await verifyPassword(password, hash);
  assert.equal(match, true);

  // Incorrect password rejected
  const wrongMatch = await verifyPassword("WrongPassword!", hash);
  assert.equal(wrongMatch, false);

  // Malformed hashes rejected safely without throwing
  assert.equal(await verifyPassword(password, "invalid-hash-string"), false);
  assert.equal(await verifyPassword(password, "scrypt$N=16384$corrupted"), false);
  assert.equal(await verifyPassword(password, ""), false);
});

test("Constant Time String Comparison: accurately checks equality without length leakage", () => {
  assert.equal(constantTimeStringEquals("owner", "owner"), true);
  assert.equal(constantTimeStringEquals("owner", "other"), false);
  assert.equal(constantTimeStringEquals("owner", "owner-extended"), false);
  assert.equal(constantTimeStringEquals("", ""), true);
});

test("Credential Verification: succeeds with correct credentials", async () => {
  await setupTestAuthEnv();
  try {
    const result = await verifyOwnerCredentials(TEST_USERNAME, TEST_PASSWORD);
    assert.equal(result.success, true);
    assert.equal(result.errorCode, undefined);
  } finally {
    teardownTestAuthEnv();
  }
});

test("Credential Verification: fails with generic error on incorrect password", async () => {
  await setupTestAuthEnv();
  try {
    const result = await verifyOwnerCredentials(TEST_USERNAME, "IncorrectPassword123!");
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_CREDENTIALS");
  } finally {
    teardownTestAuthEnv();
  }
});

test("Credential Verification: fails with identical generic error on unknown username", async () => {
  await setupTestAuthEnv();
  try {
    const result = await verifyOwnerCredentials("unknown-user", TEST_PASSWORD);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_CREDENTIALS");
  } finally {
    teardownTestAuthEnv();
  }
});

test("Credential Verification: fails closed when authentication is not configured", async () => {
  teardownTestAuthEnv();
  // No environment variables set
  const result = await verifyOwnerCredentials(TEST_USERNAME, TEST_PASSWORD);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "AUTH_NOT_CONFIGURED");
});

test("Session Tokens: creates, verifies, and extracts session data safely", async () => {
  await setupTestAuthEnv();
  try {
    const { token, session } = await createSessionToken(TEST_USERNAME);
    assert.ok(token);
    assert.equal(session.username, TEST_USERNAME);
    assert.equal(session.role, "owner");
    assert.ok(session.expiresAt > Date.now());

    // Verify token
    const verified = await verifySessionToken(token);
    assert.ok(verified);
    assert.equal(verified?.username, TEST_USERNAME);
    assert.equal(verified?.role, "owner");
    assert.equal(verified?.sessionId, session.sessionId);
  } finally {
    teardownTestAuthEnv();
  }
});

test("Session Tokens: rejects tampered signatures and modified payloads", async () => {
  await setupTestAuthEnv();
  try {
    const { token } = await createSessionToken(TEST_USERNAME);
    const [payloadB64, sig] = token.split(".");

    // 1. Corrupted signature
    const corruptedSig = sig.slice(0, -2) + (sig.endsWith("a") ? "b" : "a");
    assert.equal(await verifySessionToken(`${payloadB64}.${corruptedSig}`), null);

    // 2. Corrupted payload
    const corruptedPayload = payloadB64.slice(0, -2) + "==";
    assert.equal(await verifySessionToken(`${corruptedPayload}.${sig}`), null);

    // 3. Malformed strings
    assert.equal(await verifySessionToken(""), null);
    assert.equal(await verifySessionToken("no-dots-here"), null);
    assert.equal(await verifySessionToken("a.b.c"), null);
  } finally {
    teardownTestAuthEnv();
  }
});

test("Session Revocation: process-local logout invalidates session server-side immediately", async () => {
  await setupTestAuthEnv();
  try {
    const { token, session } = await createSessionToken(TEST_USERNAME);
    assert.ok(await verifySessionToken(token));

    // Revoke the session using the process-local (synchronous) revocation
    revokeSessionLocal(session.sessionId);

    // Token must now be rejected even though its HMAC and timestamp are valid
    assert.equal(await verifySessionToken(token), null);
  } finally {
    teardownTestAuthEnv();
  }
});

test("Session Cookie: provides required security attributes in production", () => {
  const prodOptions = getSessionCookieOptions(true);
  assert.equal(prodOptions.name, SESSION_COOKIE_NAME);
  assert.equal(prodOptions.httpOnly, true);
  assert.equal(prodOptions.secure, true);
  assert.equal(prodOptions.sameSite, "lax");
  assert.equal(prodOptions.path, "/");
  assert.equal(prodOptions.maxAge, 28800);

  const devOptions = getSessionCookieOptions(false);
  assert.equal(devOptions.secure, false); // Local HTTP support
});

test("Rate Limiting: enforces lockout after 5 consecutive failed attempts", async () => {
  await __resetRateLimiterForTesting();
  const testKey = "192.168.1.1:owner";

  // Attempts 1 to 4: not limited
  for (let i = 1; i <= 4; i++) {
    const status = await recordLoginFailure(testKey);
    assert.equal(status.limited, false);
  }

  // 5th failed attempt: triggers lockout
  const fifth = await recordLoginFailure(testKey);
  assert.equal(fifth.limited, true);
  assert.ok(fifth.retryAfterSeconds > 0);

  // Subsequent check reflects lockout
  const check = await checkLoginRateLimit(testKey);
  assert.equal(check.limited, true);

  // Clear failures resets lockout
  await clearLoginFailures(testKey);
  assert.equal((await checkLoginRateLimit(testKey)).limited, false);
});

test("API Protection: unauthenticated calls to system routes return 401 Unauthorized", async () => {
  await setupTestAuthEnv();
  try {
    // 1. init-database
    const initReq = new NextRequest("http://localhost:3000/api/system/init-database", {
      method: "POST",
    });
    const initRes = await initDatabasePost(initReq);
    assert.equal(initRes.status, 401);
    const initBody = await initRes.json();
    assert.equal(initBody.error?.code, "UNAUTHORIZED");

    // 2. schema-status
    const schemaReq = new NextRequest("http://localhost:3000/api/system/schema-status", {
      method: "GET",
    });
    const schemaRes = await schemaStatusGet(schemaReq);
    assert.equal(schemaRes.status, 401);

    // 3. test-record
    const testReq = new NextRequest("http://localhost:3000/api/system/test-record?id=sample", {
      method: "GET",
    });
    const testRes = await testRecordGet(testReq);
    assert.equal(testRes.status, 401);
  } finally {
    teardownTestAuthEnv();
  }
});

test("API Protection: authenticated owner session can access permitted system routes", async () => {
  await setupTestAuthEnv();
  try {
    const { token } = await createSessionToken(TEST_USERNAME);

    // Call init-database with valid session cookie
    const initReq = new NextRequest("http://localhost:3000/api/system/init-database", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const initRes = await initDatabasePost(initReq);
    assert.equal(initRes.status, 200);
    const body = await initRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data?.initialized, true);
  } finally {
    teardownTestAuthEnv();
  }
});

test("Diagnostic Safety: test writes disabled in production by default unless ALLOW_TEST_WRITES=true", async () => {
  await setupTestAuthEnv();
  const prevEnv = process.env.NODE_ENV;
  try {
    const { token } = await createSessionToken(TEST_USERNAME);

    // Simulate production environment
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.ALLOW_TEST_WRITES;

    const postReq = new NextRequest("http://localhost:3000/api/system/test-record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({ message: "Test", nonce: "nonce-prod-test-1" }),
    });

    const res = await testRecordPost(postReq);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error?.code, "TEST_WRITE_DISABLED");

    // Enable ALLOW_TEST_WRITES=true explicitly
    process.env.ALLOW_TEST_WRITES = "true";
    const allowedReq = new NextRequest("http://localhost:3000/api/system/test-record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
      body: JSON.stringify({ message: "Test", nonce: "nonce-prod-test-2" }),
    });

    const allowedRes = await testRecordPost(allowedReq);
    assert.equal(allowedRes.status, 200);
  } finally {
    (process.env as Record<string, string>).NODE_ENV = prevEnv;
    teardownTestAuthEnv();
  }
});

test("Middleware: unauthenticated /dashboard access redirects to /login", async () => {
  await setupTestAuthEnv();
  try {
    const req = new NextRequest("http://localhost:3000/dashboard/sales");
    const res = await middleware(req);

    assert.equal(res.status, 307);
    const location = res.headers.get("location");
    assert.ok(location?.includes("/login"));
    assert.ok(location?.includes("from=%2Fdashboard%2Fsales"));
  } finally {
    teardownTestAuthEnv();
  }
});

test("Middleware: authenticated owner can access /dashboard", async () => {
  await setupTestAuthEnv();
  try {
    const { token } = await createSessionToken(TEST_USERNAME);
    const req = new NextRequest("http://localhost:3000/dashboard", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const res = await middleware(req);
    // NextResponse.next() returns a standard 200/pass-through response
    assert.equal(res.status, 200);
  } finally {
    teardownTestAuthEnv();
  }
});

test("Middleware: authenticated user visiting /login redirects to /dashboard", async () => {
  await setupTestAuthEnv();
  try {
    const { token } = await createSessionToken(TEST_USERNAME);
    const req = new NextRequest("http://localhost:3000/login", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const res = await middleware(req);
    assert.equal(res.status, 307);
    const location = res.headers.get("location");
    assert.ok(location?.endsWith("/dashboard"));
  } finally {
    teardownTestAuthEnv();
  }
});

test("Auth Routes: /api/auth/login sets HTTP-only cookie and /me inspects session", async () => {
  await setupTestAuthEnv();
  try {
    // 1. Login with valid credentials
    const loginReq = new NextRequest("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
      }),
    });

    const loginRes = await loginPost(loginReq);
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get("set-cookie");
    assert.ok(setCookie?.includes(SESSION_COOKIE_NAME));
    assert.ok(setCookie?.includes("HttpOnly"));

    // Extract token from Set-Cookie header
    const tokenMatch = setCookie?.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
    const token = tokenMatch ? tokenMatch[1] : "";
    assert.ok(token);

    // 2. Call /api/auth/me with that cookie
    const meReq = new NextRequest("http://localhost:3000/api/auth/me", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const meRes = await meGet(meReq);
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.data?.authenticated, true);
    assert.equal(meBody.data?.user?.username, TEST_USERNAME);

    // 3. Call /api/auth/logout to invalidate
    const logoutReq = new NextRequest("http://localhost:3000/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        origin: "http://localhost:3000",
      },
    });
    const logoutRes = await logoutPost(logoutReq);
    assert.equal(logoutRes.status, 200);

    // 4. Call /api/auth/me again after logout: must report unauthenticated
    const postLogoutMeReq = new NextRequest("http://localhost:3000/api/auth/me", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });
    const postLogoutMeRes = await meGet(postLogoutMeReq);
    const postLogoutBody = await postLogoutMeRes.json();
    assert.equal(postLogoutBody.data?.authenticated, false);
  } finally {
    teardownTestAuthEnv();
  }
});
