/**
 * Admin dashboard stats, notices CRUD (drives the homepage notice list),
 * and Settings editing (drives homepage hero text / contact info).
 */

function getAdminDashboard(e) {
  const auth = requireRole(e.parameter.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const payments = readSheet("Payments_Log");
  const totalFeesCollected = payments
    .filter((p) => p.Status === "SUCCESS")
    .reduce((sum, p) => sum + Number(p.Amount || 0), 0);
  const pendingFees = payments
    .filter((p) => p.Status === "INITIATED" || p.Status === "PENDING")
    .reduce((sum, p) => sum + Number(p.Amount || 0), 0);

  const students = readSheet("Students");
  const attendance = readSheet("Attendance");
  const presentCount = attendance.filter((a) => a.Status === "Present").length;
  const avgAttendancePercent = attendance.length ? Math.round((presentCount / attendance.length) * 100) : null;

  const recentEnquiries = readSheet("Admissions_Enquiries")
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, 5)
    .map((en) => ({
      name: en.Name,
      phone: en.Phone,
      courseInterest: en.CourseInterest,
      status: en.Status,
      timestamp: en.Timestamp,
    }));

  return jsonResponse({
    ok: true,
    data: { totalFeesCollected, pendingFees, totalStudents: students.length, avgAttendancePercent, recentEnquiries },
  });
}

/** Public — used by the homepage to render active notices. No auth required. */
function getNotices() {
  const rows = readSheet("Notices")
    .filter((n) => String(n.Active).toUpperCase() === "TRUE")
    .sort((a, b) => Number(a.Order || 0) - Number(b.Order || 0));
  return jsonResponse({ ok: true, data: rows });
}

/** Admin-only — returns every notice, including inactive ones, for the management UI. */
function getAdminNotices(e) {
  const auth = requireRole(e.parameter.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });
  const rows = readSheet("Notices").sort((a, b) => Number(a.Order || 0) - Number(b.Order || 0));
  return jsonResponse({ ok: true, data: rows });
}

function postAdminNotice(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });
  if (!body.title || !body.body) return jsonResponse({ ok: false, error: "Title and body are required" });

  const noticeId = body.noticeId || Utilities.getUuid();
  upsertRow("Notices", "NoticeId", noticeId, {
    NoticeId: noticeId,
    Title: body.title,
    Body: body.body,
    Date: body.date || new Date(),
    Active: body.active !== false,
    Order: body.order || 0,
  });
  return jsonResponse({ ok: true, data: { noticeId } });
}

function deleteAdminNotice(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });
  const removed = deleteRowByKey("Notices", "NoticeId", body.noticeId);
  return jsonResponse({ ok: removed });
}

/** Lets admin edit homepage-controlled Settings keys (hero_title, hero_subtitle, etc). */
function postAdminSettings(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const updates = body.updates || {};
  Object.keys(updates).forEach((key) => {
    upsertRow("Settings", "Key", key, { Key: key, Value: updates[key] });
  });
  CacheService.getScriptCache().remove("settings");
  return jsonResponse({ ok: true });
}
