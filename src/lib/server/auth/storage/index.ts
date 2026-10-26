import { join } from "node:path";
import type { AuthStorageAdapter } from "./interface";
import { FileAuthStorage } from "./file";
import { MemoryAuthStorage } from "./memory";
import { UpstashRedisAuthStorage } from "./redis";
import { FailClosedAuthStorage } from "./fail-closed";

export * from "./interface";
export { FileAuthStorage } from "./file";
export { MemoryAuthStorage } from "./memory";
export { UpstashRedisAuthStorage } from "./redis";
export { FailClosedAuthStorage } from "./fail-closed";

let globalStorage: AuthStorageAdapter | null = null;

function resolveDefaultStorageDir(): string {
  if (process.env.AUTH_STORAGE_DIR) {
    return process.env.AUTH_STORAGE_DIR;
  }
  return join(process.cwd(), ".auth-store");
}

export type AuthStorageDiagnostics = {
  adapterName: string;
  isProduction: boolean;
  isSharedStorage: boolean;
  isConfigured: boolean;
  storageType: string;
  missingVariables: string[];
};

/**
 * Diagnostics for server-side auth storage.
 * Reveals configuration presence and adapter identity without exposing secret values.
 */
export function getAuthStorageDiagnostics(): AuthStorageDiagnostics {
  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const explicitType = process.env.AUTH_STORAGE_TYPE?.toLowerCase().trim();
  const storageType = explicitType || (isProduction ? "redis" : "file");

  const hasUpstashUrl = Boolean(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
  const hasUpstashToken = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);

  const missingVariables: string[] = [];
  if (isProduction || storageType === "redis" || storageType === "upstash") {
    if (!hasUpstashUrl) missingVariables.push("UPSTASH_REDIS_REST_URL (or KV_REST_API_URL)");
    if (!hasUpstashToken) missingVariables.push("UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)");
  }

  const adapter = getAuthStorage();

  return {
    adapterName: adapter.name,
    isProduction,
    isSharedStorage: adapter.name === "upstash-redis" || adapter.name === "redis",
    isConfigured: adapter.name !== "fail-closed" && missingVariables.length === 0,
    storageType,
    missingVariables,
  };
}

/**
 * Resolves the appropriate AuthStorageAdapter based on validated server-side configuration.
 *
 * Rules:
 * 1. In production (NODE_ENV=production or VERCEL):
 *    - Accidental use of FileAuthStorage is strictly forbidden (throws).
 *    - MemoryAuthStorage is forbidden unless ALLOW_IN_MEMORY_AUTH_IN_PRODUCTION=true (for isolated testing).
 *    - Managed Redis/KV (Upstash) is selected if credentials are configured.
 *    - If no shared-storage credentials exist, returns FailClosedAuthStorage (no silent fallback to memory or /tmp).
 * 2. In local development or testing:
 *    - Can explicitly select memory, redis, or file adapter.
 *    - Defaults to local FileAuthStorage (.auth-store) with graceful fallback to MemoryAuthStorage if restricted.
 */
export function getAuthStorage(): AuthStorageAdapter {
  if (globalStorage) {
    return globalStorage;
  }

  const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const storageType = process.env.AUTH_STORAGE_TYPE?.toLowerCase().trim();

  // 1. Explicit Memory Adapter
  if (storageType === "memory") {
    if (isProduction && process.env.ALLOW_IN_MEMORY_AUTH_IN_PRODUCTION !== "true") {
      throw new Error(
        "MemoryAuthStorage cannot be used in production or serverless environments. Multi-instance session security requires shared storage."
      );
    }
    globalStorage = new MemoryAuthStorage();
    return globalStorage;
  }

  // 2. Explicit Local File Adapter
  if (storageType === "file") {
    if (isProduction) {
      throw new Error(
        "FileAuthStorage cannot be used in production or serverless environments. Local filesystem is not shared across instances. Configure managed Redis/KV instead."
      );
    }
    const dir = resolveDefaultStorageDir();
    globalStorage = new FileAuthStorage(dir);
    return globalStorage;
  }

  // 3. Shared Redis / Upstash Adapter (Explicit or Automatic in Production)
  const hasUpstashUrl = Boolean(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
  const hasUpstashToken = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);

  if (storageType === "redis" || storageType === "upstash" || (isProduction && (hasUpstashUrl || hasUpstashToken))) {
    if (!hasUpstashUrl || !hasUpstashToken) {
      if (isProduction) {
        // In production, missing credentials fail closed safely
        globalStorage = new FailClosedAuthStorage(
          "Shared Redis/KV credentials missing in production (UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN)."
        );
        return globalStorage;
      }
      throw new Error(
        "AUTH_STORAGE_TYPE is set to 'redis' but UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is missing."
      );
    }

    globalStorage = new UpstashRedisAuthStorage();
    return globalStorage;
  }

  // 4. Production without shared credentials fails closed (no silent fallback to /tmp or memory)
  if (isProduction) {
    globalStorage = new FailClosedAuthStorage(
      "No production shared storage configured. Managed Redis/KV is required in production."
    );
    return globalStorage;
  }

  // 5. Default Local Development: File Storage with safe fallback to Memory if filesystem is restricted
  try {
    const dir = resolveDefaultStorageDir();
    globalStorage = new FileAuthStorage(dir);
    return globalStorage;
  } catch {
    globalStorage = new MemoryAuthStorage();
    return globalStorage;
  }
}

export function setAuthStorage(adapter: AuthStorageAdapter): void {
  globalStorage = adapter;
}

export function __resetAuthStorageForTesting(adapter?: AuthStorageAdapter): void {
  globalStorage = adapter || null;
}
