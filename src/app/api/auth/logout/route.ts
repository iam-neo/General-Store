import { NextRequest, NextResponse } from "next/server";
import {
  getRequestSession,
  isSameOriginRequest,
  revokeSession,
  SESSION_COOKIE_NAME,
} from "@/lib/server/auth";

export async function POST(req: NextRequest) {
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

  const session = await getRequestSession(req);
  if (session) {
    await revokeSession(session.sessionId, session.expiresAt);
  }

  const response = NextResponse.json({
    success: true,
    data: { loggedOut: true },
    error: null,
  });

  // Explicitly clear the session cookie
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
