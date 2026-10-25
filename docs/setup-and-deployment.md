# Setup and deployment notes

## Current frontend demo

This is a Next.js App Router project using strict TypeScript and Tailwind CSS. Install dependencies with `npm install`; run the preview with `npm run dev`. `/login` is a UI mockup. `/dashboard` and its child routes are public previews with a clear demo-data notice; the route group does not authenticate or protect them.

Dashboard cards and transaction examples are centralized in `src/features/dashboard/mock-data.ts`. The example names, IDs, and amounts are fictional. The English/Nepali preference is stored in the current browser's local storage only.

The font stack prefers Noto Sans Devanagari and common Nepali-capable system fonts. Before production, bundle or self-host a licensed Devanagari font and confirm its rendering on the shop's target devices.

## Future environment configuration

`.env.example` documents reserved server-side variables for owner authentication and the Apps Script integration. They are intentionally unused in the current demo. Production values belong in the deployment platform's encrypted environment settings and in Apps Script Script Properties where required.

## Separate Apps Script deployment

Apps Script source will live under `apps-script/src/`. Use `clasp` or an equivalent Google-supported workflow to link the local source to an Apps Script project. Keep local Google authorization credentials out of this repository. Push and test against a development deployment first, then create a versioned production deployment explicitly. A Next.js deployment does not publish Apps Script changes.

Before production, document the spreadsheet ID, sheet headers, deployment access mode, script owner, signing-key rotation, backup schedule, and restore procedure. Do not put spreadsheet or Apps Script credentials in browser code.
