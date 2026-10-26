import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { getAuthConfig } from "./config";

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

const SCRYPT_DEFAULTS = {
  N: 16384, // CPU/memory cost
  r: 8,     // Block size
  p: 1,     // Parallelization
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
};

// Dummy hash used for constant-time comparison when user does not exist
const DUMMY_HASH =
  "scrypt$N=16384,r=8,p=1$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

function deriveScryptKey(
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

/**
 * Derives a secure password hash string using scrypt.
 * Output format: scrypt$N=16384,r=8,p=1$<salt-hex>$<hash-hex>
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== "string") {
    throw new Error("Password must be a non-empty string.");
  }

  const salt = randomBytes(16).toString("hex");
  const derivedKey = await deriveScryptKey(
    password,
    salt,
    SCRYPT_DEFAULTS.keylen,
    {
      N: SCRYPT_DEFAULTS.N,
      r: SCRYPT_DEFAULTS.r,
      p: SCRYPT_DEFAULTS.p,
      maxmem: SCRYPT_DEFAULTS.maxmem,
    }
  );

  return `scrypt$N=${SCRYPT_DEFAULTS.N},r=${SCRYPT_DEFAULTS.r},p=${SCRYPT_DEFAULTS.p}$${salt}$${derivedKey.toString("hex")}`;
}

/**
 * Constant-time comparison between two strings to avoid timing leakage.
 */
export function constantTimeStringEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Verifies a candidate password against a stored scrypt hash string.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!password || !storedHash || typeof storedHash !== "string") {
    return false;
  }

  try {
    const parts = storedHash.split("$");
    if (parts.length !== 4 || parts[0] !== "scrypt") {
      return false;
    }

    // Parse options from parts[1] (e.g. "N=16384,r=8,p=1")
    let N = SCRYPT_DEFAULTS.N;
    let r = SCRYPT_DEFAULTS.r;
    let p = SCRYPT_DEFAULTS.p;

    const optPairs = parts[1].split(",");
    for (const pair of optPairs) {
      const [k, v] = pair.split("=");
      const num = parseInt(v, 10);
      if (!isNaN(num)) {
        if (k === "N") N = num;
        if (k === "r") r = num;
        if (k === "p") p = num;
      }
    }

    const salt = parts[2];
    const expectedKey = Buffer.from(parts[3], "hex");

    if (expectedKey.length === 0 || !salt) {
      return false;
    }

    const derivedKey = await deriveScryptKey(password, salt, expectedKey.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_DEFAULTS.maxmem,
    });

    if (derivedKey.length !== expectedKey.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
}

export type CredentialVerificationResult = {
  success: boolean;
  errorCode?: "AUTH_NOT_CONFIGURED" | "INVALID_CREDENTIALS";
};

/**
 * Validates store owner credentials against server configuration.
 * Always performs constant-time password derivation to thwart username enumeration.
 */
export async function verifyOwnerCredentials(
  candidateUsername: string,
  candidatePassword: string
): Promise<CredentialVerificationResult> {
  const config = getAuthConfig();

  if (!config.isConfigured || !config.ownerUsername || !config.ownerPasswordHash) {
    return {
      success: false,
      errorCode: "AUTH_NOT_CONFIGURED",
    };
  }

  const usernameMatch = constantTimeStringEquals(
    candidateUsername.trim(),
    config.ownerUsername.trim()
  );

  // If username does not match, still verify candidate password against dummy hash
  // to ensure identical execution time (prevents user enumeration via timing attack).
  const hashToVerify = usernameMatch ? config.ownerPasswordHash : DUMMY_HASH;
  const passwordMatch = await verifyPassword(candidatePassword, hashToVerify);

  if (usernameMatch && passwordMatch) {
    return { success: true };
  }

  return {
    success: false,
    errorCode: "INVALID_CREDENTIALS",
  };
}
