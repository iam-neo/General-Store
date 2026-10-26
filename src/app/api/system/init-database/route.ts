import { NextRequest, NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";
import { verifyApiOwnerSession } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) {
    return auth.errorResponse;
  }

  const backend = getAppsScriptBackend();
  const response = await backend.client.initDatabase();

  return NextResponse.json({
    ...response,
    meta: {
      mode: backend.mode,
      isLive: backend.isLive,
    },
  });
}
