# General Store Management System

A responsive Next.js and TypeScript interface for a small family-owned general store in Nepal.

## Current phase

The current implementation is a **frontend demo**. `/login` is a mockup and `/dashboard` is a public UI preview, not an authenticated route. All displayed transaction IDs, names, and amounts come from centralized fictional demo data. The other dashboard routes are labeled placeholders.

Authentication, Google Sheets, Apps Script, eSewa, sales entry, repayments, and report calculations are not connected. The login form never sends the entered credentials or creates a session.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/login` or `http://localhost:3000/dashboard`. The English/Nepali selector changes the current UI labels and stores the preference in this browser only.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment variables

`.env.example` lists variables reserved for future server-side authentication and Apps Script integration. They are not used by the current frontend demo. Never commit real secrets or expose them through `NEXT_PUBLIC_` variables.

## Google Apps Script

The `apps-script/` directory has a separate deployment lifecycle from Next.js. Follow [the Apps Script workflow](apps-script/README.md) and [setup notes](docs/setup-and-deployment.md) when the backend phase begins. No Apps Script project is connected yet.
