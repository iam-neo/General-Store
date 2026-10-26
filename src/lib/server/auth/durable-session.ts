import { verifySessionToken, type SessionData, SESSION_LIFETIME_MS } from "./session";
import { getAuthStorage, type AuthStorageAdapter } from "./storage";

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

/**
 * Revokes a specific session ID across all instances using durable storage.
 */
export async function revokeSession(
  sessionId: string,
  expiresAt?: number,
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<void> {
  if (!sessionId) return;
  const exp = expiresAt || Date.now() + SESSION_LIFETIME_MS;
  await storage.revokeSession(sessionId, exp);
}

/**
 * Globally invalidates all sessions issued prior to this moment across all instances.
 */
export async function revokeAllSessions(
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<void> {
  await storage.setGlobalRevocationEpoch(Date.now());
}

/**
 * Checks whether a specific session ID has been revoked in durable storage.
 * Fails closed (returns true) if storage operation fails.
 */
export async function isSessionRevoked(
  sessionId: string,
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<boolean> {
  if (!sessionId) return true;
  try {
    return await storage.isSessionRevoked(sessionId);
  } catch {
    // Security fail-closed: if storage check fails, treat as revoked
    return true;
  }
}

/**
 * Full server-side session verifier.
 * Combines HMAC-SHA256 signature check, expiration check, global epoch check,
 * and durable per-session revocation check.
 *
 * Guarantees fail-closed behavior: if shared storage times out or is unavailable,
 * sessions are rejected rather than silently trusted.
 */
export async function verifyDurableSession(
  token: string | null | undefined,
  storage: AuthStorageAdapter = getAuthStorage()
): Promise<SessionData | null> {
  // 1. Cryptographic signature and expiration check
  const session = await verifySessionToken(token);
  if (!session) {
    return null;
  }

  try {
    // 2. Check global revocation epoch
    const globalEpoch = await storage.getGlobalRevocationEpoch();
    if (globalEpoch > 0 && session.createdAt < globalEpoch) {
      return null;
    }

    // 3. Check individual session revocation
    const revoked = await storage.isSessionRevoked(session.sessionId);
    if (revoked) {
      return null;
    }

    return session;
  } catch {
    // Security fail-closed: if storage is unreachable or throws (e.g. timeout, network down),
    // reject the session verification. Never bypass revocation checks!
    return null;
  }
}
