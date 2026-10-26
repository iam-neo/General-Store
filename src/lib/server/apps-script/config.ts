/**
 * Server-only configuration for Google Apps Script integration.
 * NEVER expose these variables or secrets to client bundles.
 */

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

export type AppsScriptConfig = Readonly<{
  url: string | null;
  secret: string | null;
  spreadsheetId: string | null;
  isConfigured: boolean;
}>;

export function getAppsScriptConfig(): AppsScriptConfig {
  const url = process.env.APPS_SCRIPT_URL?.trim() || null;
  const secret =
    process.env.APPS_SCRIPT_HMAC_SECRET?.trim() ||
    process.env.APPS_SCRIPT_SECRET?.trim() ||
    process.env.BACKEND_SECRET?.trim() ||
    null;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.trim() || null;

  return {
    url,
    secret,
    spreadsheetId,
    isConfigured: Boolean(url),
  };
}

export function isAppsScriptConfigured(): boolean {
  return Boolean(process.env.APPS_SCRIPT_URL?.trim());
}
