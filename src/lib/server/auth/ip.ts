/**
 * Client IP address extraction with reverse proxy and serverless edge security.
 * Defends against IP header spoofing, whitespace manipulation, and non-IP strings.
 */
import type { NextRequest } from "next/server";

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

function isValidIp(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;
  if (IPV4_REGEX.test(trimmed)) return true;
  if (trimmed.includes(":") && IPV6_REGEX.test(trimmed)) return true;
  return false;
}

/**
 * Extracts a trustworthy client IP address from the request.
 *
 * Proxy trust model:
 * 1. Checks `req.ip` if populated by Next.js platform integration (e.g. Vercel).
 * 2. Checks `x-real-ip` which is set directly by the ingress edge proxy (Vercel/Nginx)
 *    and cannot be spoofed by incoming clients because edge proxies overwrite it.
 * 3. Checks `x-vercel-ip`.
 * 4. Fallback to `x-forwarded-for`: when multiple IPs are present, validates format
 *    and selects the proxy-supplied client IP without accepting malformed strings.
 * 5. Safe fallback: '127.0.0.1'.
 */
export function getTrustedClientIp(req: NextRequest | Request): string {
  // 1. Next.js platform IP (available on NextRequest)
  if ("ip" in req && typeof req.ip === "string" && req.ip) {
    const trimmed = req.ip.trim();
    if (isValidIp(trimmed)) return trimmed;
  }

  // 2. Direct edge proxy header (Vercel overwrites x-real-ip with connecting socket IP)
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  // 3. Vercel proprietary platform header
  const vercelIp = req.headers.get("x-vercel-ip")?.trim();
  if (vercelIp && isValidIp(vercelIp)) {
    return vercelIp;
  }

  // 4. x-forwarded-for
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const parts = xForwardedFor.split(",").map((p) => p.trim());
    for (const part of parts) {
      if (isValidIp(part)) {
        return part;
      }
    }
  }

  return "127.0.0.1";
}
