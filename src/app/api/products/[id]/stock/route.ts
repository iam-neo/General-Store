import { NextRequest, NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";
import { verifyApiOwnerSession, isSameOriginRequest } from "@/lib/server/auth/guard";
import { validateStockAdjustment } from "@/lib/server/products/validation";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/products/[id]/stock — Adjust stock for a product.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) return auth.errorResponse;

  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: "UNAUTHORIZED", message: "Cross-origin request rejected." },
      },
      { status: 403 }
    );
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: "VALIDATION_ERROR", message: "Request body must be valid JSON." },
      },
      { status: 400 }
    );
  }

  const validation = validateStockAdjustment(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: validation.errors.map((e) => e.message).join(" "),
          details: validation.errors,
        },
      },
      { status: 400 }
    );
  }

  const { client } = getAppsScriptBackend();
  const result = await client.adjustStock(id, {
    ...validation.data,
    actor: auth.session.username,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
