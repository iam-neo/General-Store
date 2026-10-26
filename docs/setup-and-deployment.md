# Setup and Deployment Guide

## 1. Project Overview

The **General Store Management System** is built with:
- **Frontend**: Next.js App Router, React, TypeScript, Tailwind CSS.
- **Authentication**: Server-side Scrypt password verification, HMAC-SHA256 signed HTTP-only cookies, durable multi-instance session revocation, atomic sliding-window rate limiting.
- **Shared Storage**: Upstash Redis / Vercel KV for multi-instance serverless session revocation and abuse protection; local filesystem adapter for offline local development.
- **Backend**: Google Apps Script Web App running in Google's cloud.
- **Database**: Google Sheets (separate sheets per entity, header-based dynamic mapping).
- **Hosting Target**: Vercel (free-tier serverless) or any Node.js 18+ runtime.

---

## 2. Environment Configuration

Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

### Environment Variables

| Variable | Scope | Purpose |
| :--- | :--- | :--- |
| `OWNER_USERNAME` | Server-Only | Store owner username (default UI suggestion: `owner`). |
| `OWNER_PASSWORD_HASH` | Server-Only | Scrypt password hash for store owner authentication. Generated using `npm run auth:hash`. |
| `SESSION_SECRET` | Server-Only | 32+ character random secret used to sign HMAC-SHA256 session cookies. |
| `UPSTASH_REDIS_REST_URL` | Server-Only | Shared Upstash Redis REST API URL (or Vercel KV `KV_REST_API_URL`). Required in production. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-Only | Shared Upstash Redis REST API Token (or Vercel KV `KV_REST_API_TOKEN`). Required in production. |
| `AUTH_STORAGE_TYPE` | Server-Only | Storage adapter selection (`redis` \| `file` \| `memory`). Defaults to `file` in dev and `redis` in production. |
| `ALLOW_TEST_WRITES` | Server-Only | Controls diagnostic write operations. In production, writes are disabled unless explicitly `"true"`. |
| `APPS_SCRIPT_URL` | Server-Only | URL of the deployed Google Apps Script Web App. If omitted, the server runs in local in-memory mock mode. |
| `APPS_SCRIPT_HMAC_SECRET` | Server-Only | Shared secret token configured in Apps Script Script Properties (`BACKEND_SECRET`). |
| `GOOGLE_SPREADSHEET_ID` | Server-Only | Optional reference ID of the Google Spreadsheet. |

> **Security Rule**: None of these variables use `NEXT_PUBLIC_`. They are strictly server-only and unreachable by browser bundles.

---

## 3. Store Owner Password Setup

To generate a secure scrypt password hash for `OWNER_PASSWORD_HASH`:

```bash
npm run auth:hash -- "YourStrongStorePassword123!"
```

Or using Node directly:
```bash
node scripts/generate-password-hash.mjs "YourStrongStorePassword123!"
```

Copy the generated hash string into `.env.local`:
```env
OWNER_USERNAME=owner
OWNER_PASSWORD_HASH="scrypt$N=16384,r=8,p=1$<salt-hex>$<derived-key-hex>"
SESSION_SECRET="your-32-plus-character-cryptographic-random-secret-key"
```

---

## 4. Shared Production Storage (Upstash Redis / Vercel KV)

### Why Shared Storage is Required in Serverless Deployments
In serverless environments like Vercel, requests are distributed across dynamic, ephemeral execution containers in multiple availability regions. Local memory maps and `/tmp` files are process-local and container-bound:
- Container A cannot read a session revocation written to Container B's `/tmp`.
- An attacker can exploit multiple concurrent requests across lambdas to bypass process-local rate limiters.
- Any container restart or cold start loses in-memory state.

To guarantee zero-bypass security, all serverless instances query a centralized managed datastore:
- **Provider Choice**: **Upstash Redis / Vercel KV**.
- **Serverless REST Protocol**: `@upstash/redis` communicates over stateless HTTPS `fetch` rather than long-lived TCP sockets, eliminating connection pool limits and idle socket exhaustion in serverless lambdas.
- **Free Tier Availability**: Upstash provides a generous free tier (10,000 requests/day, 256MB storage), ideal for single-store production without requiring paid infrastructure.

### Upstash Redis / Vercel KV Setup
1. Create a free Redis database at [Upstash Console](https://console.upstash.com) or add the **Vercel KV** integration from the Vercel Marketplace.
2. Under **REST API**, copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or use Vercel's automatically injected `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. Add these credentials to Vercel Environment Variables:
   ```env
   UPSTASH_REDIS_REST_URL=https://...upstash.io
   UPSTASH_REDIS_REST_TOKEN=AX...
   ```

### Storage Adapter Selection & Fail-Closed Guardrails
- **Production Mode (`NODE_ENV=production` or `VERCEL=1`)**:
  - Automatically selects `UpstashRedisAuthStorage`.
  - **Refuses Local File Adapter**: Explicitly setting `AUTH_STORAGE_TYPE=file` throws an immediate error to prevent accidental unshared storage.
  - **Refuses Memory Adapter**: Setting `AUTH_STORAGE_TYPE=memory` throws an immediate error unless `ALLOW_IN_MEMORY_AUTH_IN_PRODUCTION=true` is explicitly provided for testing.
  - **Fails Closed**: If shared credentials are unconfigured in production, `FailClosedAuthStorage` is activated. All session verification checks fail closed (`verifyDurableSession` returns `null`), and login attempts are blocked (HTTP 503 `AUTH_STORAGE_NOT_CONFIGURED`), completely preventing unshared or unrevocable logins.
  - **Storage Timeout / Network Failure**: If the Redis datastore is temporarily unreachable, all session verification and rate-limit checks fail closed rather than silently letting requests pass.
- **Local Development (`NODE_ENV=development`)**:
  - Automatically defaults to `FileAuthStorage` inside `.auth-store/`, maintaining rapid offline iteration without requiring external credentials.
  - Developers can set `AUTH_STORAGE_TYPE=memory` for transient unit tests or configure Upstash credentials to test production storage locally.

### Concurrency Safety & Atomic Rate Limiting
To prevent race conditions where concurrent failed login attempts bypass the lockout threshold:
- `UpstashRedisAuthStorage` executes an **atomic Lua script** inside Redis via `EVAL`.
- Redis executes the script single-threadedly: checking the attempt count, updating the timestamps, and applying the 15-minute lockout occur in one atomic step.
- Concurrent requests arriving within the same millisecond cannot slip past the configured 5-attempt limit.

### Automatic Expiration & Lifecycle Cleanup
- **Session Revocations**: Stored under `gs:auth:revoked:<sessionId>` with Redis TTL (`EX`) set to the remaining session lifetime (`expiresAt - now`). Once the token naturally expires, Redis automatically cleans up the key with zero maintenance overhead.
- **Rate Limit Records**: Stored under `gs:auth:ratelimit:<key>` with Redis TTL (`EX`) matching the sliding window or lockout duration (15 minutes).
- **Global Revocation Epoch**: Stored at `gs:auth:epoch`. Invalidates all sessions created prior to the epoch across all instances instantaneously.

---

## 5. Security & Authentication Architecture

### Credential Verification
- **Scrypt Hashing**: Passwords are verified against scrypt hashes ($N=16384, r=8, p=1$, 64-byte key). Plaintext passwords are never stored or logged.
- **Timing Attack Mitigation**: When an invalid username is submitted, a dummy scrypt verification is performed so response timing is identical, preventing username enumeration.
- **Generic Errors**: Failed login attempts always return `Invalid username or password.` regardless of whether the user exists or the password was wrong.

### Trustworthy Client IP Extraction
Rate limiting uses `getTrustedClientIp()`:
- Inspects platform-managed `req.ip` and direct ingress proxy header `x-real-ip` (overwritten by Vercel edge network).
- Inspects `x-vercel-ip`.
- For `x-forwarded-for`, strictly validates IPv4 and IPv6 format and parses the proxy-provided IP, rejecting header injection, carriage returns, and malformed strings.
- Falls back to `127.0.0.1` safely if no valid IP header is provided.

### Session Management & Cookie Security
- **Token Format**: `${base64url(payload)}.${HMAC-SHA256(payload, SESSION_SECRET)}`.
- **Cookie Security**:
  - `HttpOnly`: Inaccessible to JavaScript (prevents XSS exfiltration).
  - `Secure`: Transmitted only over HTTPS in production.
  - `SameSite=Lax`: Defends against Cross-Site Request Forgery (CSRF).
  - `Path=/`: Bounded to application root.
  - `Max-Age=28800`: 8-hour session lifetime with mandatory timestamp expiration.
- **Defense in Depth**:
  - **Edge Middleware (`src/middleware.ts`)**: Fast cryptographic HMAC signature and expiration verification without loading filesystem modules.
  - **Server Layout Guard (`src/app/(dashboard)/dashboard/layout.tsx`)**: Enforces durable revocation checks and global epoch verification on every dashboard page render via `requireOwnerSession()`.
  - **API Route Guards (`src/lib/server/auth/guard.ts`)**: Enforces durable revocation checks on all sensitive API calls via `verifyApiOwnerSession()`.

---

## 6. Local Development & Testing

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run automated test suite (60 unit and integration tests):
   ```bash
   npm test
   ```

3. Run TypeScript typecheck:
   ```bash
   npm run typecheck
   ```

4. Run code linter:
   ```bash
   npm run lint
   ```

5. Run production build check:
   ```bash
   npm run build
   ```

6. Run local development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000/login` to sign in.

---

## 7. Google Apps Script & Google Sheets Deployment

Detailed instructions for Google Apps Script source code, spreadsheet binding, Script Properties, and Web App publishing are available in:
[`apps-script/README.md`](file:///d:/1%20project/0codes/Project_neo/general-store/apps-script/README.md)

Detailed database schema definitions, data types, and Paisa currency conventions are documented in:
[`docs/database-schema.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/database-schema.md)
