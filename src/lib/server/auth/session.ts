import { getAuthConfig } from "./config";

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

export const SESSION_COOKIE_NAME = "gs_session";
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours
export const SESSION_LIFETIME_SEC = 8 * 60 * 60;

export type SessionData = {
  sessionId: string;
  username: string;
  role: "owner";
  createdAt: number;
  expiresAt: number;
};

// In-memory active session store and revocation list for immediate server-side revocation on logout
const activeSessions = new Map<string, SessionData>();
const revokedSessionIds = new Set<string>();

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Creates a signed, tamper-resistant session token using universal Web Crypto HMAC-SHA256.
 */
export async function createSessionToken(
  username: string
): Promise<{ token: string; session: SessionData }> {
  const config = getAuthConfig();
  if (!config.isConfigured || !config.sessionSecret) {
    throw new Error("Cannot create session: SESSION_SECRET is not configured.");
  }

  const now = Date.now();
  const session: SessionData = {
    sessionId: crypto.randomUUID(),
    username: username.trim(),
    role: "owner",
    createdAt: now,
    expiresAt: now + SESSION_LIFETIME_MS,
  };

  const payloadJson = JSON.stringify(session);
  const payloadB64 = base64UrlEncode(payloadJson);

  const key = await getHmacKey(config.sessionSecret);
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  const signatureHex = bytesToHex(new Uint8Array(sigBuffer));

  const token = `${payloadB64}.${signatureHex}`;

  // Register in active sessions store
  activeSessions.set(session.sessionId, session);

  cleanExpiredSessions();

  return { token, session };
}

/**
 * Verifies a session token string.
 * Validates HMAC signature, expiration timestamp, and server-side revocation state.
 */
export async function verifySessionToken(
  token: string | null | undefined
): Promise<SessionData | null> {
  if (!token || typeof token !== "string") {
    return null;
  }

  const config = getAuthConfig();
  if (!config.isConfigured || !config.sessionSecret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadB64, incomingSigHex] = parts;

  try {
    const key = await getHmacKey(config.sessionSecret);
    const signatureBytes = hexToBytes(incomingSigHex);
    if (signatureBytes.length !== 32) {
      return null;
    }

    // Constant-time HMAC verification performed by Web Crypto
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes as BufferSource,
      new TextEncoder().encode(payloadB64)
    );

    if (!isValid) {
      return null;
    }

    const payloadJson = base64UrlDecode(payloadB64);
    const session = JSON.parse(payloadJson) as SessionData;

    if (!session || typeof session !== "object") {
      return null;
    }

    if (session.role !== "owner" || !session.sessionId || !session.expiresAt) {
      return null;
    }

    // Expiration check
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(session.sessionId);
      return null;
    }

    // Revocation check
    if (revokedSessionIds.has(session.sessionId)) {
      return null;
    }

    // Active session tracking
    if (activeSessions.size > 0 && !activeSessions.has(session.sessionId)) {
      activeSessions.set(session.sessionId, session);
    }

    return session;
  } catch {
    return null;
  }
}

/**
 * Revokes a session immediately, invalidating the session ID server-side.
 */
export function revokeSession(sessionId: string): void {
  if (!sessionId) return;
  activeSessions.delete(sessionId);
  revokedSessionIds.add(sessionId);

  // Keep revocation set bounded
  if (revokedSessionIds.size > 10000) {
    const iter = revokedSessionIds.values();
    for (let i = 0; i < 2000; i++) {
      const next = iter.next();
      if (next.done) break;
      revokedSessionIds.delete(next.value);
    }
  }
}

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, s] of activeSessions.entries()) {
    if (now > s.expiresAt) {
      activeSessions.delete(id);
    }
  }
}

export function getSessionCookieOptions(isProduction: boolean = process.env.NODE_ENV === "production") {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_LIFETIME_SEC,
  };
}

export function __resetSessionStoreForTesting(): void {
  activeSessions.clear();
  revokedSessionIds.clear();
}
