import { NextRequest, NextResponse } from "next/server";
import { getAppsScriptBackend } from "@/lib/server/apps-script";
import { verifyApiOwnerSession } from "@/lib/server/auth";

/**
 * Checks whether test writes are permitted in the current environment.
 * In production, test writes are strictly disabled unless ALLOW_TEST_WRITES="true".
 */
function areTestWritesPermitted(): boolean {
  if (process.env.NODE_ENV === "production") {
    return process.env.ALLOW_TEST_WRITES === "true";
  }
  // In development/test, permitted unless explicitly set to false
  return process.env.ALLOW_TEST_WRITES !== "false";
}

/**
 * Controlled test record operations for Phase 4 & Phase 5.
 * Strictly protected by store owner session and production write guards.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) {
    return auth.errorResponse;
  }

  if (!areTestWritesPermitted()) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "TEST_WRITE_DISABLED",
          message:
            "Test record writes are disabled in production unless ALLOW_TEST_WRITES=true is explicitly configured.",
        },
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { message, nonce } = body || {};

    if (!message || typeof message !== "string" || message.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Field 'message' is required and must be a non-empty string.",
          },
        },
        { status: 400 }
      );
    }

    if (!nonce || typeof nonce !== "string" || nonce.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Field 'nonce' is required and must be a non-empty string.",
          },
        },
        { status: 400 }
      );
    }

    const backend = getAppsScriptBackend();
    const response = await backend.client.createTestRecord(message, nonce);

    return NextResponse.json({
      ...response,
      meta: {
        mode: backend.mode,
        isLive: backend.isLive,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message:
            err instanceof Error
              ? `Invalid request body: ${err.message}`
              : "Malformed JSON request body.",
        },
      },
      { status: 400 }
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) {
    return auth.errorResponse;
  }

  const { searchParams } = new URL(req.url);
  const identifier = searchParams.get("id") || searchParams.get("nonce");

  if (!identifier) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "Query parameter 'id' or 'nonce' is required.",
        },
      },
      { status: 400 }
    );
  }

  const backend = getAppsScriptBackend();
  const response = await backend.client.getTestRecord(identifier);

  return NextResponse.json({
    ...response,
    meta: {
      mode: backend.mode,
      isLive: backend.isLive,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyApiOwnerSession(req);
  if (!auth.authorized) {
    return auth.errorResponse;
  }

  if (!areTestWritesPermitted()) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "TEST_WRITE_DISABLED",
          message:
            "Test record operations are disabled in production unless ALLOW_TEST_WRITES=true is explicitly configured.",
        },
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const identifier = searchParams.get("id") || searchParams.get("nonce") || undefined;

  const backend = getAppsScriptBackend();
  const response = await backend.client.cleanupTestRecords(identifier);

  return NextResponse.json({
    ...response,
    meta: {
      mode: backend.mode,
      isLive: backend.isLive,
    },
  });
}
