import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  type SessionData,
} from "./session";
import { verifyDurableSession } from "./durable-session";

if (typeof window !== "undefined") {
  throw new Error("This module must only be imported in server-side contexts.");
}

/**
 * Extracts and verifies the owner session from an incoming HTTP Request or NextRequest.
 */
export async function getRequestSession(
  req: NextRequest | Request
): Promise<SessionData | null> {
  let cookieHeader: string | null = null;

  if ("cookies" in req && typeof req.cookies?.get === "function") {
    const val = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (val) return verifyDurableSession(val);
  }

  cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));

  if (!match) {
    return null;
  }

  const token = match.substring(SESSION_COOKIE_NAME.length + 1);
  return verifyDurableSession(token);
}

/**
 * Extracts and verifies the owner session inside Server Components using Next.js headers cookies.
 */
export async function getServerSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    return verifyDurableSession(token);
  } catch {
    return null;
  }
}

/**
 * Server Component guard: redirects to `/login` if no valid owner session exists.
 */
export async function requireOwnerSession(redirectTo: string = "/login"): Promise<SessionData> {
  const session = await getServerSession();
  if (!session) {
    redirect(redirectTo);
  }
  return session;
}

/**
 * Route handler guard for sensitive system APIs.
 * Returns 401 Unauthorized JSON response if unauthenticated.
 */
export async function verifyApiOwnerSession(
  req: NextRequest | Request
): Promise<
  | { authorized: true; session: SessionData; errorResponse: null }
  | { authorized: false; session: null; errorResponse: NextResponse }
> {
  const session = await getRequestSession(req);

  if (!session) {
    return {
      authorized: false,
      session: null,
      errorResponse: NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required. Please sign in as store owner to perform this action.",
          },
        },
        { status: 401 }
      ),
    };
  }

  return {
    authorized: true,
    session,
    errorResponse: null,
  };
}

/**
 * Validates that an incoming mutating request originates from the same site.
 */
export function isSameOriginRequest(req: NextRequest | Request): boolean {
  // Reject explicit browser cross-site metadata
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return false;
  }

  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      if (host && originUrl.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      const reqUrl = new URL(req.url);
      return originUrl.origin.toLowerCase() === reqUrl.origin.toLowerCase();
    } catch {
      return false;
    }
  }

  // If origin is missing, check referer
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      if (host && refUrl.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      const reqUrl = new URL(req.url);
      return refUrl.origin.toLowerCase() === reqUrl.origin.toLowerCase();
    } catch {
      return false;
    }
  }

  // Standard non-browser or programmatic request without origin/referer
  return true;
}
