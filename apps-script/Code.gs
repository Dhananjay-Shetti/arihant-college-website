/**
 * Arihant College — Apps Script backend entry point.
 *
 * This is a ready-to-paste skeleton. It is NOT yet deployed — no real
 * Sheet ID or PhonePe credentials are wired in. Placeholders are marked
 * with {{...}}. See apps-script/README.md for deployment steps.
 *
 * File layout (paste each into its own .gs file in the Apps Script editor):
 *   Code.gs      - doGet/doPost entry points + router (this file)
 *   Sheets.gs    - all Sheet read/write helpers
 *   PhonePe.gs   - PhonePe initiate/callback/status logic
 */

function doGet(e) {
  return route(e, "GET");
}

function doPost(e) {
  return route(e, "POST");
}

function route(e, method) {
  const path = (e.parameter.path || "").replace(/^\/|\/$/g, "");
  try {
    const handlers = {
      "GET:settings": () => getSettings(),
      "GET:courses": () => getCourses(e),
      "GET:departments": () => getDepartments(),
      "GET:faculty": () => getFaculty(e),
      "GET:faq": () => getFaq(),
      "GET:fee/structure": () => getFeeStructure(e),
      "GET:payments/status": () => getPaymentStatus(e),
      "GET:students/lookup": () => lookupStudent(e),
      "POST:admissions/enquiry": () => postEnquiry(e),
      "POST:payments/phonepe/initiate": () => initiatePhonePePayment(e),
      "POST:payments/phonepe/callback": () => handlePhonePeCallback(e),

      "POST:auth/login": () => login(e),
      "POST:auth/logout": () => logout(e),

      "GET:student/dashboard": () => getStudentDashboard(e),
      "GET:student/fees/receipt": () => getFeeReceipt(e),

      "GET:teacher/dashboard": () => getTeacherDashboard(e),
      "GET:teacher/students": () => getTeacherStudents(e),
      "POST:teacher/attendance": () => markAttendance(e),
      "GET:student/ia-marks": () => getStudentIaMarks(e),
      "GET:teacher/ia-marks": () => getTeacherIaMarks(e),
      "POST:teacher/ia-marks": () => postTeacherIaMarks(e),
      "POST:admin/admission/submit": () => submitAdmissionApplication(e),
      "GET:admin/admission/list": () => listAdmissionApplications(e),
      "GET:admin/admission/documents": () => listApplicationDocuments(e),
      "GET:admin/admission/get": () => getAdmissionApplication(e),
      "POST:admin/admission/recompile": () => recompileConsolidatedPdf(e),

      "GET:admin/dashboard": () => getAdminDashboard(e),
      "GET:notices": () => getNotices(),
      "GET:admin/notices": () => getAdminNotices(e),
      "POST:admin/notices": () => postAdminNotice(e),
      "POST:admin/notices/delete": () => deleteAdminNotice(e),
      "POST:admin/settings": () => postAdminSettings(e),
      "POST:admin/media/upload": () => uploadMediaFile(e),
    };
    const key = method + ":" + path;
    if (!handlers[key]) return jsonResponse({ ok: false, error: "Not found: " + key });
    return handlers[key]();
  } catch (err) {
    logError(path, err);
    return jsonResponse({ ok: false, error: "Internal error" });
  }
}

function jsonResponse(obj) {
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function logError(path, err) {
  Logger.log("[ERROR] " + path + ": " + (err && err.stack ? err.stack : err));
  // Optional: also append to a hidden "ErrorLog" sheet for audit trail.
}

function requireApiKey(payload) {
  const expected = PropertiesService.getScriptProperties().getProperty("API_KEY");
  return expected && payload.apiKey === expected;
}

// ---------- Read endpoints ----------

function getSettings() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("settings");
  if (cached) return jsonResponse({ ok: true, data: JSON.parse(cached) });

  const rows = readSheet("Settings"); // [{Key, Value}, ...]
  const data = {};
  rows.forEach((r) => { data[r.Key] = r.Value; });
  cache.put("settings", JSON.stringify(data), 21600); // 6h
  return jsonResponse({ ok: true, data });
}

function getCourses(e) {
  let rows = readSheet("Courses").filter((r) => r.Active === true || r.Active === "TRUE");
  if (e.parameter.department) rows = rows.filter((r) => r.DepartmentId === e.parameter.department);
  if (e.parameter.level) rows = rows.filter((r) => r.Level === e.parameter.level);
  if (e.parameter.featured) rows = rows.filter((r) => String(r.Featured).toUpperCase() === "TRUE");
  return jsonResponse({ ok: true, data: rows });
}

function getDepartments() {
  const rows = readSheet("Departments").filter((r) => r.Active === true || r.Active === "TRUE");
  return jsonResponse({ ok: true, data: rows });
}

function getFaculty(e) {
  let rows = readSheet("Faculty").filter((r) => r.Active === true || r.Active === "TRUE");
  if (e.parameter.department) rows = rows.filter((r) => r.DepartmentId === e.parameter.department);
  return jsonResponse({ ok: true, data: rows });
}

function getFaq() {
  const rows = readSheet("FAQ").filter((r) => r.Active === true || r.Active === "TRUE");
  return jsonResponse({ ok: true, data: rows });
}

function getFeeStructure(e) {
  const courseId = e.parameter.course;
  const rows = readSheet("Fee_Structures").filter(
    (r) => r.CourseId === courseId && (r.Active === true || r.Active === "TRUE")
  );
  return jsonResponse({ ok: true, data: rows });
}

/**
 * Status lookup by Admission ID, mobile number, or email — no login required.
 * Reads Students + Payments_Log. Treat this as read-only identity: it proves
 * "you know this admission's ID/phone/email", not a real authenticated session.
 */
function lookupStudent(e) {
  const query = (e.parameter.query || "").trim().toLowerCase();
  if (!query) return jsonResponse({ ok: false, error: "Missing query" });

  const students = readSheet("Students");
  const student = students.find(
    (s) =>
      String(s.AdmissionId).toLowerCase() === query ||
      String(s.Phone) === query ||
      String(s.Email).toLowerCase() === query
  );
  if (!student) return jsonResponse({ ok: false, error: "No record found for that Admission ID / mobile / email." });

  const payments = readSheet("Payments_Log").filter((p) => p.StudentPhone === student.Phone);
  student.Payments = payments.map((p) => ({
    OrderId: p.OrderId, FeeId: p.FeeId, Amount: p.Amount, Status: p.Status, CreatedAt: p.CreatedAt,
  }));

  return jsonResponse({ ok: true, data: student });
}

// ---------- Write endpoints ----------

function postEnquiry(e) {
  const body = JSON.parse(e.postData.contents);
  if (!requireApiKey(body)) return jsonResponse({ ok: false, error: "Unauthorized" });
  if (!body.name) return jsonResponse({ ok: false, error: "Name is required" });
  if (!/^[6-9]\d{9}$/.test(body.phone || "")) return jsonResponse({ ok: false, error: "Invalid phone number" });

  const cache = CacheService.getScriptCache();
  const rateLimitKey = "enquiry_" + body.phone;
  if (cache.get(rateLimitKey)) return jsonResponse({ ok: false, error: "Please wait before submitting again." });
  cache.put(rateLimitKey, "1", 60);

  const enquiryId = Utilities.getUuid();
  appendRow("Admissions_Enquiries", {
    EnquiryId: enquiryId,
    Timestamp: new Date(),
    Name: body.name,
    Phone: body.phone,
    Email: body.email || "",
    CourseInterest: body.courseInterest || "",
    Message: body.message || "",
    Type: body.type || "admission",
    Status: "New",
    Source: "website",
  });

  return jsonResponse({ ok: true, data: { enquiryId } });
}

function getPaymentStatus(e) {
  const orderId = e.parameter.orderId;
  const row = readSheet("Payments_Log").find((r) => r.OrderId === orderId);
  if (!row) return jsonResponse({ ok: false, error: "Unknown order" });
  return jsonResponse({ ok: true, data: { orderId, status: row.Status, amount: row.Amount, courseId: row.CourseId } });
}

// PhonePe-specific handlers (initiatePhonePePayment, handlePhonePeCallback)
// live in PhonePe.gs — see that file for the full implementation once
// {{PHONEPE_MID}}, {{PHONEPE_SALT_KEY}}, {{PHONEPE_SALT_INDEX}} are supplied.
