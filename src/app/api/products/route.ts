import { NextRequest, NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";
import { verifyApiOwnerSession, isSameOriginRequest } from "@/lib/server/auth/guard";
import { validateProductCreate } from "@/lib/server/products/validation";
import type { ProductListFilter } from "@/lib/server/apps-script/types";

/**
 * GET /api/products — List products with optional search, filter, and pagination.
 */
export async function GET(req: NextRequest) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) return auth.errorResponse;

  const { searchParams } = req.nextUrl;

  const rawStatus = searchParams.get("status");
  const status =
    rawStatus === "active" || rawStatus === "inactive" || rawStatus === "all"
      ? rawStatus
      : undefined;

  const filter: ProductListFilter = {
    search: searchParams.get("search") || undefined,
    category: searchParams.get("category") || undefined,
    status,
    low_stock: searchParams.get("low_stock") === "true" ? true : undefined,
    page: searchParams.has("page") ? parseInt(searchParams.get("page")!, 10) || 1 : undefined,
    limit: searchParams.has("limit") ? parseInt(searchParams.get("limit")!, 10) || 20 : undefined,
  };

  const { client } = getAppsScriptBackend();
  const result = await client.listProducts(filter);

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

/**
 * POST /api/products — Create a new product.
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

  const validation = validateProductCreate(body);
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
  const result = await client.createProduct(validation.data);

  return NextResponse.json(result, { status: result.success ? 201 : 400 });
}
