# Google Apps Script source

This directory is reserved for the separately version-controlled backend. It is not connected to a Google Apps Script project in the current UI-preview phase.

When Phase C begins:

1. Create a standalone Apps Script project owned by the store owner.
2. Put source files under `src/` and configure `appsscript.json`.
3. Link the local directory with `clasp` using a local-only authorization session.
4. Keep request-signing secrets in Apps Script Script Properties; never commit them.
5. Deploy a development version, connect it only to a test spreadsheet, and verify the signed request protocol.
6. Promote a reviewed version to production deliberately. Deploying Next.js does not deploy this project.

The preferred web-app execution mode is the owner identity with the narrowest access setting the Google account permits. Each request must be authenticated at the application layer before any spreadsheet read or write.
