/**
 * Server-only configuration for Store Owner Authentication & Sessions.
 * Never expose these variables or secrets to client bundles.
 */

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

export type AuthConfig = Readonly<{
  ownerUsername: string | null;
  ownerPasswordHash: string | null;
  sessionSecret: string | null;
  isConfigured: boolean;
}>;

export function getAuthConfig(): AuthConfig {
  const ownerUsername = process.env.OWNER_USERNAME?.trim() || null;
  const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH?.trim() || null;
  const sessionSecret = process.env.SESSION_SECRET?.trim() || null;

  const isConfigured = Boolean(
    ownerUsername &&
    ownerPasswordHash &&
    sessionSecret &&
    sessionSecret.length >= 32
  );

  return {
    ownerUsername,
    ownerPasswordHash,
    sessionSecret,
    isConfigured,
  };
}

export function isAuthFullyConfigured(): boolean {
  return getAuthConfig().isConfigured;
}
