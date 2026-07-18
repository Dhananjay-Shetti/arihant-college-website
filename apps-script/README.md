# Deploying via clasp

One-time setup (run these yourself — `clasp login` opens a browser OAuth
consent screen that can't be automated):

```
npm install -g @google/clasp
clasp login
```

This writes `~/.clasprc.json` with your OAuth token. Everything after this
point can be driven from the terminal (by you or by me via Bash).

## Wire this folder to your Apps Script project

You said you'll provide a Script ID and Sheet ID. Once you have them:

1. Open [.clasp.json](.clasp.json) and replace `{{APPS_SCRIPT_ID}}` with the
   real Script ID (found in the Apps Script editor: Project Settings → Script ID,
   or in the project's URL).
2. If the Sheet isn't the *container* the script is bound to (i.e. this is a
   standalone script, not one created via Extensions → Apps Script from inside
   the Sheet), also set the `SPREADSHEET_ID` Script Property to the Sheet ID —
   see `Sheets.gs` → `getSpreadsheet()`.
3. From this `apps-script/` folder:
   ```
   clasp status   # confirms which local files will be pushed
   clasp push     # uploads Code.gs, Sheets.gs, PhonePe.gs, appsscript.json
   ```
4. Set required Script Properties (Apps Script editor → Project Settings →
   Script Properties, or via `clasp` is not needed for this — do it in the UI):
   `API_KEY` (any random string you choose), and later the PhonePe keys.
5. Deploy the Web App:
   ```
   clasp deploy --description "initial deploy"
   clasp deployments   # lists deployment IDs
   ```
   Or do it via the editor: Deploy → New deployment → Web app → Execute as
   "Me", Access "Anyone".
6. Take the resulting `/exec` URL and put it in
   [`assets/js/config.js`](../assets/js/config.js) as `API_BASE_URL`, and flip
   `MOCK_MODE` to `false`.

## Iterating after the first deploy

```
clasp push                                   # push code changes
clasp deploy --deploymentId <id> -d "notes"  # update an existing deployment (keeps the same /exec URL)
```
`clasp push` alone updates the underlying script but does **not** republish
a Web App deployment — you need `clasp deploy` against the existing
deployment ID to make changes live at the same URL, otherwise each
`clasp deploy` without `--deploymentId` mints a new URL.

## What I still need from you

- The Apps Script **Script ID**
- The Google **Sheet ID** (and confirmation the sheet has tabs matching the
  schema in [CLAUDE.md](../CLAUDE.md): `Settings`, `Courses`, `Departments`,
  `Faculty`, `Gallery`, `FAQ`, `Admissions_Enquiries`, `Fee_Structures`,
  `Payments_Log`, `Students`, each with a header row)
- Confirmation you've run `clasp login` locally so `clasp push`/`clasp deploy`
  will authenticate
