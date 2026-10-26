import { NextRequest, NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";
import { verifyApiOwnerSession } from "@/lib/server/auth/guard";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/sales/[id] — Get a single sale with its line items.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) return auth.errorResponse;

  const { id } = await context.params;

  const { client } = getAppsScriptBackend();
  const result = await client.getSale(id);

  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
