# Arihant College Website

Static frontend + Google Apps Script backend, using a Google Sheet as the database.
No build step, no framework, no npm dependencies — plain HTML/CSS/JS served as static files.

## Architecture

- **Frontend**: static HTML pages in the repo root, shared assets in `assets/`.
- **Backend**: Google Apps Script Web App (`apps-script/*.gs`), exposes a JSON REST-like
  API over `doGet`/`doPost` with a `?path=` query param acting as the route.
- **Database**: a single Google Sheet, one tab per entity (`Settings`, `Courses`,
  `Departments`, `Faculty`, `Gallery`, `FAQ`, `Admissions_Enquiries`, `Fee_Structures`,
  `Payments_Log`, `Students`, `Teachers`, `Admins`, `Sessions`, `Attendance`, `Notices`).
- **Payments**: PhonePe Standard Checkout (redirect + server-to-server callback).
- **WhatsApp**: plain `wa.me` click-to-chat links, no Business API.
- **Auth**: password-based login for Student/Teacher/Admin — salted SHA-256 hash
  checked against `Students`/`Teachers`/`Admins`, 8-hour session token stored in
  `Sessions`. Not Google OAuth, not hardened — see the security note in
  [README.md](README.md#login-credentials-demo-data). Public status lookup
  (`status.html`) is separate and unrelated: it matches Admission ID/mobile/email
  with no password, read-only.
- **Dashboards**: `student-dashboard.html` (attendance + fees + receipts),
  `teacher-dashboard.html` (mark attendance by class/date), `admin-dashboard.html`
  (fee/attendance stats, notices CRUD, homepage hero-text editor). All three call
  role-gated endpoints (`requireRole(token, [...])` in the relevant `.gs` file).

## Current state

`CONFIG.MOCK_MODE` is `false` — Settings/Courses/Fee Structures/Admissions
enquiries/Status lookup all hit the real deployed Apps Script Web App
(`CONFIG.API_BASE_URL`) backed by the real Sheet
(`1roz3mrLS8ZDWrTIFRKi-2UU0lgH9Ij-yu2rTdTEoMQE`). `assets/data/mock-db.json` is
no longer read by any page but is kept around for offline dev reference.

`CONFIG.MOCK_PAYMENTS` is still `true` — PhonePe credentials haven't been
provided yet, so `Api.initiatePhonePePayment`/`getPaymentStatus` in
[assets/js/api.js](assets/js/api.js) stay on the simulated checkout
(`phonepe-mock.html` + `localStorage`) independent of `MOCK_MODE`. Flip it once
`PHONEPE_MID`/`PHONEPE_SALT_KEY`/etc. are set as Script Properties.

Any page still touching a mocked feature keeps a `.mock-tag` badge in the UI —
remove it only when that feature goes live.

The Apps Script project is **standalone**, not container-bound to the Sheet —
clasp's OAuth scope can't attach new scripts to a pre-existing Drive file, so
it opens the Sheet via `SpreadsheetApp.openById()` using the `SPREADSHEET_ID`
Script Property instead. See [apps-script/README.md](apps-script/README.md)
for the clasp push/deploy workflow and `Setup.gs` → `runFirstTimeSetup` for
how the sheet tabs/headers/seed data and Script Properties got created.

## Deploying the Apps Script backend

Seven files go into the Apps Script project, unchanged in name:
- `apps-script/Code.gs` — router (`doGet`/`doPost`) + read endpoints + enquiry write
- `apps-script/Sheets.gs` — generic Sheet helpers (`readSheet`, `appendRow`, `updateRowByKey`, `findRowByKey`, `deleteRowByKey`, `clearDataRows`, `upsertRow`, `toDateKey`)
- `apps-script/Auth.gs` — `hashPassword`, `login`, `logout`, `authenticate`, `requireRole`
- `apps-script/Attendance.gs` — student dashboard, teacher dashboard/roster/mark-attendance
- `apps-script/Admin.gs` — admin dashboard stats, notices CRUD, Settings editor
- `apps-script/PhonePe.gs` — PhonePe initiate/callback handlers
- `apps-script/Setup.gs` — `setupSheets`/`resetDemoData`/`runFirstTimeSetup` (dev/setup only, not part of the request-handling path)

Required Script Properties (Project Settings → Script Properties) before this works:
`API_KEY`, `SPREADSHEET_ID` (only if the script isn't bound directly to the Sheet),
and — once PhonePe credentials exist — `PHONEPE_MID`, `PHONEPE_SALT_KEY`,
`PHONEPE_SALT_INDEX`, `PHONEPE_ENV`, `PHONEPE_REDIRECT_URL`, `PHONEPE_CALLBACK_URL`.

Deploy as Web App (Execute as "Me", Access "Anyone"), then in `config.js` set
`MOCK_MODE: false` and `API_BASE_URL` to the deployed `/exec` URL.

**Date columns quirk:** Sheets auto-converts `"yyyy-MM-dd"`-looking strings into
real Date cells on write. Anything that reads or compares a date-typed column
(`Attendance.Date`, `Fee_Structures.DueDate`, etc.) must go through
`toDateKey()` rather than comparing raw string/Date values directly — a prior
bug here silently broke the monthly-attendance-percent calculation because
`String(dateObject)` doesn't produce `"yyyy-MM-dd"`.

## Design system

Dark, glass-morphic theme modeled on futurematerials.aero: deep navy background,
electric blue + gold accents, Barlow typeface, translucent blurred cards, scroll-reveal
animations. Tokens live as CSS custom properties at the top of
[assets/css/style.css](assets/css/style.css) — change values there, not per-component.

## Conventions

- No secrets in frontend files. `config.js` holds placeholders only (`{{...}}`);
  real values (API keys, PhonePe salt key, WhatsApp number) get filled in at deploy
  time, never committed with real values if this repo is ever made public.
- Never trust client-supplied payment `amount` — the backend always resolves it
  from `Fee_Structures` by `FeeId`.
- `Payments_Log.OrderId` is the idempotency key for PhonePe callback handling —
  any change to the callback handler must preserve the "only update if not already
  SUCCESS" check.
- Keep the `Api.*` function signatures in `api.js` and the Apps Script endpoint
  contracts (`Code.gs`/`PhonePe.gs`) in sync — they're two implementations of the
  same interface.
