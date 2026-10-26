import { NextRequest, NextResponse } from "next/server";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  createSessionToken,
  getAuthStorage,
  getSessionCookieOptions,
  getTrustedClientIp,
  isSameOriginRequest,
  recordLoginFailure,
  verifyOwnerCredentials,
} from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  // 1. CSRF defense: verify same-origin
  if (!isSameOriginRequest(req)) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "CSRF_FORBIDDEN",
          message: "Cross-site request rejected.",
        },
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { username, password } = body || {};

    if (!username || typeof username !== "string" || username.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Username is required.",
          },
        },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password === "") {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Password is required.",
          },
        },
        { status: 400 }
      );
    }

    // 2. Production storage configuration check
    const storage = getAuthStorage();
    if (storage.name === "fail-closed") {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "AUTH_STORAGE_NOT_CONFIGURED",
            message: "Production shared authentication storage is not configured.",
          },
        },
        { status: 503 }
      );
    }

    // 3. Rate limiting check using trusted client IP
    const clientIp = getTrustedClientIp(req);
    const rateLimitKey = `${clientIp}:${username.toLowerCase().trim()}`;

    const limitCheck = await checkLoginRateLimit(rateLimitKey);
    if (limitCheck.limited) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "RATE_LIMITED",
            message: "Too many failed login attempts. Please wait 15 minutes before trying again.",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(limitCheck.retryAfterSeconds),
          },
        }
      );
    }

    // 4. Credential verification
    const verification = await verifyOwnerCredentials(username, password);

    if (!verification.success) {
      if (verification.errorCode === "AUTH_NOT_CONFIGURED") {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: "AUTH_NOT_CONFIGURED",
              message: "Store owner authentication is not configured on the server.",
            },
          },
          { status: 503 }
        );
      }

      // Record failed attempt for rate limiting
      const failureStatus = await recordLoginFailure(rateLimitKey);

      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid username or password.",
          },
        },
        {
          status: 401,
          headers: failureStatus.limited
            ? { "Retry-After": String(failureStatus.retryAfterSeconds) }
            : {},
        }
      );
    }

    // 5. Authentication succeeded: clear rate limits
    await clearLoginFailures(rateLimitKey);

    // 6. Create signed session token
    const { token, session } = await createSessionToken(username);

    // 7. Build response with HTTP-only cookie
    const response = NextResponse.json({
      success: true,
      data: {
        username: session.username,
        role: session.role,
        expiresAt: session.expiresAt,
      },
      error: null,
    });

    const cookieOptions = getSessionCookieOptions();
    response.cookies.set({
      ...cookieOptions,
      value: token,
    });

    return response;
  } catch (err: unknown) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: err instanceof Error ? err.message : "Malformed JSON request body.",
        },
      },
      { status: 400 }
    );
  }
}
