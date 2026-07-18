/**
 * Generic Sheet read/write helpers.
 * Set SPREADSHEET_ID in Script Properties once the real Sheet exists,
 * or replace SpreadsheetApp.openById(...) with SpreadsheetApp.getActive()
 * if this script is bound directly to the Sheet (Extensions > Apps Script).
 */

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

/** Reads a sheet into an array of objects keyed by header row. Batch read — one call per sheet. */
function readSheet(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found: " + sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

/** Appends one row, mapping an object to the sheet's existing header order. */
function appendRow(sheetName, rowObj) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found: " + sheetName);
  const headers = sheet.getDataRange().getValues()[0];
  const row = headers.map((h) => (rowObj[h] !== undefined ? rowObj[h] : ""));
  sheet.appendRow(row);
}

/** Finds a row by a column value and updates only the given fields. Used for idempotent Payments_Log updates. */
function updateRowByKey(sheetName, keyColumn, keyValue, updates) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found: " + sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx === -1) throw new Error("Column not found: " + keyColumn);

  for (let r = 1; r < values.length; r++) {
    if (values[r][keyIdx] === keyValue) {
      Object.keys(updates).forEach((field) => {
        const colIdx = headers.indexOf(field);
        if (colIdx !== -1) sheet.getRange(r + 1, colIdx + 1).setValue(updates[field]);
      });
      return true;
    }
  }
  return false;
}

function findRowByKey(sheetName, keyColumn, keyValue) {
  return readSheet(sheetName).find((row) => row[keyColumn] === keyValue) || null;
}

/**
 * Sheets auto-converts "yyyy-MM-dd"-looking strings into real Date cells on
 * write. Use this whenever comparing/displaying a date-typed column so both
 * Date objects and plain strings normalize to the same "yyyy-MM-dd" key.
 */
function toDateKey(value) {
  if (value instanceof Date) return Utilities.formatDate(value, "Asia/Kolkata", "yyyy-MM-dd");
  return String(value);
}

/** Deletes the first row matching keyColumn === keyValue. Returns true if a row was removed. */
function deleteRowByKey(sheetName, keyColumn, keyValue) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found: " + sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx === -1) throw new Error("Column not found: " + keyColumn);

  for (let r = 1; r < values.length; r++) {
    if (values[r][keyIdx] === keyValue) {
      sheet.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

/** Removes all data rows (keeps the header) so a sheet can be re-seeded cleanly. */
function clearDataRows(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw new Error("Sheet not found: " + sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
}

/** Upserts a row: updates the first row matching keyColumn===keyValue, or appends if none found. */
function upsertRow(sheetName, keyColumn, keyValue, rowObj) {
  const updated = updateRowByKey(sheetName, keyColumn, keyValue, rowObj);
  if (!updated) appendRow(sheetName, rowObj);
}
