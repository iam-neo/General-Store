import { LiveAppsScriptClient } from "./client";
import { isAppsScriptConfigured } from "./config";
import { MockAppsScriptClient } from "./mock-client";

export * from "./types";
export * from "./schema";
export * from "./config";
export { MockAppsScriptClient } from "./mock-client";
export { LiveAppsScriptClient } from "./client";

export type AppsScriptBackend = {
  client: LiveAppsScriptClient | MockAppsScriptClient;
  mode: "live" | "mock";
  isLive: boolean;
};

// Singleton instance of mock client to preserve in-memory state across requests during dev/testing
let globalMockClient: MockAppsScriptClient | null = null;

function getSharedMockClient(): MockAppsScriptClient {
  if (!globalMockClient) {
    globalMockClient = new MockAppsScriptClient(false);
  }
  return globalMockClient;
}

/**
 * Returns the appropriate backend client based on environment configuration.
 * If APPS_SCRIPT_URL is provided, returns LiveAppsScriptClient.
 * Otherwise, returns the in-memory MockAppsScriptClient with mode: 'mock'.
 */
export function getAppsScriptBackend(): AppsScriptBackend {
  if (isAppsScriptConfigured()) {
    return {
      client: new LiveAppsScriptClient(),
      mode: "live",
      isLive: true,
    };
  }

  return {
    client: getSharedMockClient(),
    mode: "mock",
    isLive: false,
  };
}
