import { NextRequest, NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server/auth";

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);

  if (!session) {
    return NextResponse.json({
      success: true,
      data: {
        authenticated: false,
        user: null,
      },
      error: null,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      authenticated: true,
      user: {
        username: session.username,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    },
    error: null,
  });
}
