# Google Apps Script Backend & Google Sheets Database

This directory contains the production-ready Google Apps Script backend source files for the **General Store Management System**.

---

## 1. Directory Structure

```
apps-script/
├── appsscript.json             # Apps Script project manifest (V8 runtime, Asia/Kathmandu timezone)
├── .clasp.json.example         # Template for Google clasp CLI deployment
├── README.md                   # Complete deployment and configuration documentation
└── src/
    ├── Config.js               # Canonical schema definitions and Script Properties reader
    ├── Auth.js                 # Shared secret token verification and timestamp skew check
    ├── Database.js             # LockService concurrency wrapper, header mapping, row operations
    ├── Schema.js               # Header inspection and idempotent database initialization
    ├── Handlers.js             # Endpoints: health, schema_status, init_database, test_record CRUD
    └── Code.js                 # Web App entry points (doGet, doPost) and manual IDE triggers
```

---

## 2. Setup Instructions

You can set up the Google Apps Script project either **manually via the web editor** or using the **Google `clasp` command-line tool**.

### Method A: Manual Setup (Recommended for Initial Deployment)

1. **Create the Google Sheet**:
   - Go to [Google Sheets](https://sheets.new) and create a new blank spreadsheet.
   - Name it: `General Store Database`.
   - Copy the **Spreadsheet ID** from the browser URL:
     `https://docs.google.com/spreadsheets/d/`**`<SPREADSHEET_ID>`**`/edit`
   - Keep the spreadsheet private to your Google account.

2. **Create the Google Apps Script Project**:
   - Go to [script.google.com](https://script.google.com) and click **New project** (or inside your Google Sheet, click **Extensions > Apps Script**).
   - Name the project: `General Store Backend`.

3. **Copy the Source Files**:
   - In the Apps Script web editor, create the following script files under the editor and paste the corresponding code from `apps-script/src/`:
     - `Config.gs` (from `Config.js`)
     - `Auth.gs` (from `Auth.js`)
     - `Database.gs` (from `Database.js`)
     - `Schema.gs` (from `Schema.js`)
     - `Handlers.gs` (from `Handlers.js`)
     - `Code.gs` (from `Code.js`)
   - In **Project Settings** (gear icon on the left), check **Show "appsscript.json" manifest file in editor**.
   - Open `appsscript.json` and replace its content with `apps-script/appsscript.json`.

4. **Configure Script Properties (Environment Variables)**:
   - In **Project Settings**, scroll down to **Script Properties** and click **Add script property**:
     - `SPREADSHEET_ID`: Paste your Google Spreadsheet ID.
     - `BACKEND_SECRET`: Enter a secure random string (e.g. 32 characters generated via `openssl rand -hex 24`).
     - `ALLOW_TEST_WRITES`: `true`
     - `MAX_REQUEST_AGE_MS`: `300000` (5 minutes)

5. **Initialize the Database**:
   - In the editor toolbar at the top, select the function **`initDatabase`** from the function dropdown.
   - Click **Run**.
   - Google will request authorization permissions. Click **Review Permissions**, select your Google account, and grant access.
   - View the execution log: all 9 sheets (`Products`, `Customers`, `Sales`, `SaleItems`, `Payments`, `Expenses`, `AuditLog`, `Settings`, `SystemTest`) will be created with bold frozen headers.

6. **Deploy as a Web App**:
   - Click the blue **Deploy** button (top right) > **New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Set:
     - **Description**: `v1.0.0 Phase 4 Foundation`
     - **Execute as**: `Me (<your-email@gmail.com>)`
     - **Who has access**: `Anyone` *(Note: Since Next.js calls this backend server-to-server without a Google browser login, "Anyone" is required. All requests are strictly protected at the application layer by `BACKEND_SECRET` and timestamp validation).*
   - Click **Deploy**.
   - Copy the generated **Web app URL** (e.g. `https://script.google.com/macros/s/AKfycbx.../exec`).

7. **Configure Next.js**:
   - In your Next.js project root, create `.env.local` (or configure Vercel Environment Variables):
     ```env
     APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbx.../exec
     APPS_SCRIPT_HMAC_SECRET=<your-chosen-secret>
     ```

---

### Method B: Using `@google/clasp` CLI

1. Install clasp globally:
   ```bash
   npm install -g @google/clasp
   ```
2. Enable the Google Apps Script API in your Google account settings:
   - Visit [script.google.com/home/usersettings](https://script.google.com/home/usersettings) and turn **Google Apps Script API** ON.
3. Authenticate clasp on your machine:
   ```bash
   clasp login
   ```
4. Create a new standalone script or clone an existing one:
   ```bash
   cd apps-script
   clasp create --title "General Store Backend" --type webapp
   ```
5. Push source files:
   ```bash
   clasp push
   ```
6. Open in browser to configure Script Properties and deploy:
   ```bash
   clasp open
   ```

---

## 3. Updating Deployments Safely

When making changes to Apps Script code in the future:
1. Push updated code via `clasp push` or the online editor.
2. In the Apps Script editor, click **Deploy > Manage deployments**.
3. Select your active Web App deployment.
4. Click the **Pencil (Edit)** icon.
5. In the **Version** dropdown, select **New version**.
6. Click **Deploy**.

> **Note**: If you do not select "New version", the web app deployment URL will continue running the older cached version!

---

## 4. Web App Constraints & Technical Quirks

- **302 HTTP Execution Redirects**: Google Apps Script web apps return an HTTP 302 redirect pointing to `script.googleusercontent.com`. The Next.js server client explicitly includes `redirect: "follow"` to resolve the final response.
- **ContentService & HTTP Statuses**: Apps Script always returns HTTP 200 (or redirect) from `ContentService`. Application-level errors are conveyed via the JSON envelope: `{ success: false, data: null, error: { code, message } }`.
- **Execution Quotas (Free Tier Google Accounts)**:
  - Max simultaneous script executions: 30
  - URL Fetch execution time limit: 6 minutes per call (Next.js server client uses a 15-20 second timeout)
  - Google Sheets maximum cell limit: 10,000,000 cells per spreadsheet
