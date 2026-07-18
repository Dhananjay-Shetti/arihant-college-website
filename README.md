# Arihant College Website

Static frontend + Google Apps Script backend, using a Google Sheet as the database.

**Live now:** Settings, Courses, Fee Structures, Admissions enquiries, the
Admission ID / mobile / email status lookup, full Student/Teacher/Admin
login + dashboards, and WhatsApp click-to-chat (real number) all run against
a real Google Sheet via a deployed Apps Script Web App.
**Still mocked:** PhonePe payment (simulated checkout screen) — pending
PhonePe merchant credentials.

## Login credentials (demo data)

Password-based login, not Google OAuth — see [apps-script/Auth.gs](apps-script/Auth.gs).
All accounts below were seeded by `Setup.gs` → `resetDemoData()`.

| Role | Identifier | Password |
|---|---|---|
| Student | `AC2026-0001` (or phone `9812345670` / email `riya.sharma@example.com`) | `Student@123` |
| Teacher | `priya.verma@arihantcollege.example` | `Teacher@123` |
| Admin | `admin@arihantcollege.example` | `Admin@123` |

All 8 seeded students share the password `Student@123` (unique salt per user).
All 3 seeded teachers share `Teacher@123`. Log in at [login.html](login.html).

**Security note:** this is prototype-grade auth — salted SHA-256 password
hashes + an 8-hour session token stored in the `Sessions` sheet, checked on
every request via `requireRole()`. No lockout after repeated failures beyond
a 5-second per-identifier throttle, no password reset flow, tokens travel as
query params over HTTPS. Fine for a college demo; don't reuse this pattern
for anything more sensitive without hardening it first.

## What's real vs. mocked

| Feature | Status | Where |
|---|---|---|
| Settings / Courses / Fee Structures | **Live** — reads the real Sheet | `Api.getSettings/getCourses/getFeeStructure` in [assets/js/api.js](assets/js/api.js) |
| Admissions enquiry form | **Live** — writes to `Admissions_Enquiries` sheet | [admissions.html](admissions.html) → `Api.submitEnquiry()` |
| Status check (Admission ID / mobile / email) | **Live** — reads `Students` + `Payments_Log` | [status.html](status.html) → `Api.lookupStudent()` |
| Login (Student/Teacher/Admin) | **Live** — salted-hash password check + session token | [login.html](login.html) → `Api.login()` |
| Student dashboard | **Live** — day-by-day + monthly/overall attendance, fee status, receipts | [student-dashboard.html](student-dashboard.html) |
| Teacher dashboard | **Live** — roster by class, mark Present/Absent per day | [teacher-dashboard.html](teacher-dashboard.html) |
| Admin dashboard | **Live** — fees collected/pending, attendance avg, notices CRUD, homepage content editor | [admin-dashboard.html](admin-dashboard.html) |
| Fee receipt | **Live** — printable receipt (browser print-to-PDF) | [fee-receipt.html](fee-receipt.html) |
| Homepage notices + hero text | **Live** — admin-editable via dashboard, public `GET /notices` + `Settings.hero_*` | [index.html](index.html) |
| WhatsApp | **Live** — real `wa.me` links using the real college number | [assets/js/config.js](assets/js/config.js) |
| PhonePe payment | Mocked — [phonepe-mock.html](phonepe-mock.html) simulates PhonePe's hosted checkout with "Simulate Success/Failure" buttons; controlled independently via `CONFIG.MOCK_PAYMENTS` | [fees.html](fees.html) → `Api.initiatePhonePePayment()` |

Pages that touch a still-mocked feature keep a small **"Mock"** badge in the UI.

## Backend deployment (already done)

- Google Sheet: `1roz3mrLS8ZDWrTIFRKi-2UU0lgH9Ij-yu2rTdTEoMQE`
- Apps Script project (standalone, not container-bound — see note below):
  https://script.google.com/d/1AJkFflPgb-YxElzFq7lfFBgBmDskZymqRvLztJdlgQPfwRPfDXmlwcqN/edit
- Deployed Web App: set as `API_BASE_URL` in [assets/js/config.js](assets/js/config.js)
- `apps-script/.clasp.json` is wired to this project — `clasp push` from that
  folder updates the code, `clasp deploy --deploymentId <id>` republishes an
  existing deployment at the same URL

**Why standalone, not container-bound:** clasp's OAuth scope (`drive.file`)
can only attach new scripts to Drive files clasp itself created, not to a
pre-existing Sheet. The script is standalone and opens the Sheet via
`SpreadsheetApp.openById()`, using the `SPREADSHEET_ID` Script Property —
functionally identical, just not visible under Extensions → Apps Script from
inside the Sheet's own UI.

To (re-)create the tabs/headers and reset demo data after editing `Setup.gs`:
push with `clasp push`, then run `runFirstTimeSetup` once from the Apps
Script editor's function dropdown (manual permission click required — Google
requires a human for that, it can't be scripted). **Careful:** `resetDemoData()`
unconditionally clears and rewrites `Departments`/`Courses`/`Fee_Structures`/
`Students`/`Teachers`/`Admins`/`Notices`/`Attendance`/`Payments_Log` — it does
NOT touch `Admissions_Enquiries` or `Sessions`, but any real data you've since
entered into the other sheets will be wiped on re-run.

## How to view it locally

```
npx serve .
# or
python -m http.server 8080
```
(A static server is needed for `fetch()` to work reliably in some browsers.)

## Remaining to go live

### PhonePe
1. Get from the client: Merchant ID, Salt Key, Salt Index, environment (UAT/PROD).
2. Set Script Properties (via the Apps Script editor, or a new `clasp run` setup
   function like `runFirstTimeSetup`): `PHONEPE_MID`, `PHONEPE_SALT_KEY`,
   `PHONEPE_SALT_INDEX`, `PHONEPE_ENV`, `PHONEPE_REDIRECT_URL` (→ deployed
   `fee-status.html`), `PHONEPE_CALLBACK_URL` (→ `/exec?path=payments/phonepe/callback`).
3. Register the callback URL in the PhonePe merchant dashboard.
4. Set `CONFIG.MOCK_PAYMENTS = false` in `config.js` — `phonepe-mock.html`
   stops being used and `Api.initiatePhonePePayment` calls the real endpoint.

## Repo layout

```
index.html, admissions.html, fees.html, status.html, contact.html   — public pages
login.html                                                          — Student/Teacher/Admin sign-in
student-dashboard.html, teacher-dashboard.html, admin-dashboard.html — role dashboards
fee-receipt.html                                                    — printable fee receipt
phonepe-mock.html, fee-status.html                                  — mocked payment flow
assets/css/style.css                                                — design system (dark glass, Barlow)
assets/js/config.js                                                 — real Sheet backend + remaining placeholders
assets/js/api.js                                                    — MOCK_MODE (data) / MOCK_PAYMENTS (PhonePe) switches
assets/js/session.js                                                — client-side session token helper (localStorage)
assets/js/whatsapp.js                                                — wa.me link builder
assets/js/motion.js                                                  — scroll-reveal + nav blur
assets/data/mock-db.json                                            — no longer used for data pages, kept for reference/offline dev
apps-script/Code.gs, Sheets.gs, Auth.gs, Attendance.gs, Admin.gs,
apps-script/PhonePe.gs, Setup.gs                                    — deployed backend (see apps-script/README.md)
```
