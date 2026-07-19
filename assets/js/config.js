/**
 * Global site configuration.
 * Replace placeholders when real credentials/endpoints are available.
 * Nothing secret should ever live in this file (it ships to the browser).
 */
const CONFIG = {
  // Settings/Courses/Fees/Enquiries/Status-lookup now read from the real
  // Google Sheet via the deployed Apps Script Web App below.
  MOCK_MODE: false,

  // Deployed Apps Script Web App /exec URL, bound to the real Sheet
  // (1roz3mrLS8ZDWrTIFRKi-2UU0lgH9Ij-yu2rTdTEoMQE) via SPREADSHEET_ID script property.
  API_BASE_URL: "https://script.google.com/macros/s/AKfycbz315ErcxRqh5kL5OvSGTr4Wg-lZg7UgCBeMCx47hPzt8wLC9BiYIYmUWQZkhZZ_LlE/exec",

  // Matches the API_KEY script property set by runFirstTimeSetup() in Setup.gs.
  API_KEY: "e233408c2bf4318aae7c52d27ffc4619a24ef3247f449602",

  // PhonePe merchant credentials haven't been provided yet, so payments stay
  // mocked independently of MOCK_MODE above (see phonepe-mock.html / api.js).
  MOCK_PAYMENTS: true,

  // College WhatsApp number in international format, no + or spaces.
  WHATSAPP_NUMBER: "918050425435",

  PHONEPE: {
    ENV: "MOCK", // "MOCK" | "UAT" | "PROD"
    MERCHANT_ID: "{{PHONEPE_MID}}",
  },

  COLLEGE_NAME: "Arihant College",
};
