import { NextRequest, NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";
import { verifyApiOwnerSession, isSameOriginRequest } from "@/lib/server/auth/guard";
import { validateSaleCreate } from "@/lib/server/sales/validation";
import type { SaleListFilter } from "@/lib/server/apps-script/types";

/**
 * GET /api/sales — List sales with optional filters (date range, customer, status, pagination).
 */
export async function GET(req: NextRequest) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) return auth.errorResponse;

  const { searchParams } = req.nextUrl;

  const filter: SaleListFilter = {
    start_date: searchParams.get("start_date") || undefined,
    end_date: searchParams.get("end_date") || undefined,
    customer_id: searchParams.get("customer_id") || undefined,
    status: searchParams.get("status") || undefined,
    page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) || 1 : undefined,
    limit: searchParams.has("limit") ? parseInt(searchParams.get("limit")!, 10) || 20 : undefined,
  };

  const { client } = getAppsScriptBackend();
  const result = await client.listSales(filter);

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

/**
 * POST /api/sales — Create a new sale, deduct stock, and record audit ledger.
 */
export async function POST(req: NextRequest) {
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

  const validation = validateSaleCreate(body);
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

  const actor = auth.session?.username || "store_owner";
  const { client } = getAppsScriptBackend();
  const result = await client.createSale({
    ...validation.data,
    actor: validation.data.actor || actor,
  });

  return NextResponse.json(result, {
    status: result.success ? 201 : result.error?.code === "VALIDATION_ERROR" ? 400 : 500,
  });
}
