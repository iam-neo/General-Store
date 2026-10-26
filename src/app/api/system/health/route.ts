import { NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";

export async function GET() {
  const backend = getAppsScriptBackend();
  const response = await backend.client.health();

  return NextResponse.json({
    ...response,
    meta: {
      mode: backend.mode,
      isLive: backend.isLive,
    },
  });
}
