/**
 * Single access point for all backend calls.
 * Settings/Courses/Fees/Enquiries/Status-lookup/Auth/Dashboards hit the real
 * Apps Script Web App (CONFIG.MOCK_MODE is false). PhonePe payment stays
 * mocked independently via CONFIG.MOCK_PAYMENTS until real merchant
 * credentials exist — see phonepe-mock.html.
 */
const Api = (() => {
  let mockDb = null;

  async function loadMockDb() {
    if (mockDb) return mockDb;
    const res = await fetch("assets/data/mock-db.json");
    mockDb = await res.json();
    return mockDb;
  }

  function delay(ms = 350) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function realRequest(path, method = "GET", body = null, params = null) {
    const url = new URL(CONFIG.API_BASE_URL);
    url.searchParams.set("path", path);
    if (params) {
      Object.keys(params).forEach((k) => {
        if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
      });
    }
    const opts = { method };
    if (body) {
      opts.body = JSON.stringify({ ...body, apiKey: CONFIG.API_KEY });
    }
    const res = await fetch(url.toString(), opts);
    return res.json();
  }

  /**
   * Short-TTL read cache (sessionStorage — per tab, cleared on tab close)
   * for content that rarely changes within a single visit: Settings,
   * Courses, Notices. Cuts the homepage down to zero extra Sheet reads on
   * repeat views/navigations within the TTL window instead of refetching
   * every time. Admin writes to these (saveAdminSettings/saveAdminNotice/
   * deleteAdminNotice) bust the matching key so same-tab edits show up
   * immediately rather than waiting out the TTL.
   */
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem("cache:" + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) return null;
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(key, data) {
    try {
      sessionStorage.setItem("cache:" + key, JSON.stringify({ data, expiresAt: Date.now() + CACHE_TTL_MS }));
    } catch (e) {
      // sessionStorage unavailable (private mode / quota) — just skip caching.
    }
  }

  function cacheClear(key) {
    try {
      sessionStorage.removeItem("cache:" + key);
    } catch (e) {}
  }

  async function getSettings() {
    if (CONFIG.MOCK_MODE) {
      const db = await loadMockDb();
      await delay();
      return { ok: true, data: db.settings };
    }
    const cached = cacheGet("settings");
    if (cached) return cached;
    const res = await realRequest("settings");
    if (res.ok) cacheSet("settings", res);
    return res;
  }

  async function getCourses() {
    if (CONFIG.MOCK_MODE) {
      const db = await loadMockDb();
      await delay();
      return { ok: true, data: db.courses.filter((c) => c.Active) };
    }
    const cached = cacheGet("courses");
    if (cached) return cached;
    const res = await realRequest("courses");
    if (res.ok) cacheSet("courses", res);
    return res;
  }

  async function getFeeStructure(courseId) {
    if (CONFIG.MOCK_MODE) {
      const db = await loadMockDb();
      await delay();
      return {
        ok: true,
        data: db.feeStructures.filter((f) => f.CourseId === courseId && f.Active),
      };
    }
    return realRequest("fee/structure", "GET", null, { course: courseId });
  }

  async function submitEnquiry(payload) {
    if (CONFIG.MOCK_MODE) {
      await delay(500);
      if (!/^[6-9]\d{9}$/.test(payload.phone || "")) {
        return { ok: false, error: "Enter a valid 10-digit mobile number." };
      }
      if (!payload.name) {
        return { ok: false, error: "Name is required." };
      }
      const enquiryId = "MOCK-" + Date.now();
      console.info("[MOCK] Enquiry stored (would append to Admissions_Enquiries):", { enquiryId, ...payload });
      return { ok: true, data: { enquiryId } };
    }
    return realRequest("admissions/enquiry", "POST", payload);
  }

  // Lookup by Admission ID, phone, or email — mirrors GET /students/lookup?query=
  async function lookupStudent(query) {
    if (CONFIG.MOCK_MODE) {
      const db = await loadMockDb();
      await delay(400);
      const q = String(query).trim().toLowerCase();
      const student = db.students.find(
        (s) =>
          s.AdmissionId.toLowerCase() === q ||
          s.Phone === q ||
          s.Email.toLowerCase() === q
      );
      if (!student) return { ok: false, error: "No record found for that Admission ID / mobile / email." };
      return { ok: true, data: student };
    }
    return realRequest("students/lookup", "GET", null, { query });
  }

  async function initiatePhonePePayment(payload) {
    if (CONFIG.MOCK_PAYMENTS) {
      await delay(600);
      const orderId = "AC-" + Date.now() + "-" + Math.floor(Math.random() * 10000);
      console.info("[MOCK] Payments_Log row created (INITIATED):", { orderId, ...payload });
      // In real mode this would be PhonePe's hosted redirect URL.
      // In mock mode we send the user to our own mock checkout page.
      const redirectUrl = `phonepe-mock.html?orderId=${orderId}&amount=${payload.amount}&course=${encodeURIComponent(payload.courseId)}`;
      return { ok: true, data: { orderId, redirectUrl } };
    }
    return realRequest("payments/phonepe/initiate", "POST", payload);
  }

  async function getPaymentStatus(orderId) {
    if (CONFIG.MOCK_PAYMENTS) {
      await delay(300);
      const stored = JSON.parse(localStorage.getItem("mockPayments") || "{}");
      const status = stored[orderId] || "PENDING";
      return { ok: true, data: { orderId, status } };
    }
    return realRequest("payments/status", "GET", null, { orderId });
  }

  // ---------- Auth / dashboards (always real — no mock mode) ----------

  async function login(role, identifier, password) {
    return realRequest("auth/login", "POST", { role, identifier, password });
  }

  async function logout(token) {
    return realRequest("auth/logout", "POST", { token });
  }

  async function getStudentDashboard(token) {
    return realRequest("student/dashboard", "GET", null, { token });
  }

  async function getFeeReceipt(token, orderId) {
    return realRequest("student/fees/receipt", "GET", null, { token, orderId });
  }

  async function getTeacherDashboard(token) {
    return realRequest("teacher/dashboard", "GET", null, { token });
  }

  async function getTeacherStudents(token, course, date) {
    return realRequest("teacher/students", "GET", null, { token, course, date });
  }

  async function markAttendance(token, courseId, date, records) {
    return realRequest("teacher/attendance", "POST", { token, courseId, date, records });
  }

  async function getStudentIaMarks(token) {
    return realRequest("student/ia-marks", "GET", null, { token });
  }

  async function getTeacherIaMarks(token, course, subject, component) {
    return realRequest("teacher/ia-marks", "GET", null, { token, course, subject, component });
  }

  async function saveTeacherIaMarks(token, courseId, subject, component, maxMarks, records) {
    return realRequest("teacher/ia-marks", "POST", { token, courseId, subject, component, maxMarks, records });
  }

  async function submitAdmissionApplication(token, payload) {
    return realRequest("admin/admission/submit", "POST", { token, ...payload });
  }

  async function getAdmissionApplications(token) {
    return realRequest("admin/admission/list", "GET", null, { token });
  }

  async function getApplicationDocuments(token, applicationId) {
    return realRequest("admin/admission/documents", "GET", null, { token, applicationId });
  }

  async function getAdmissionApplication(token, applicationId) {
    return realRequest("admin/admission/get", "GET", null, { token, applicationId });
  }

  async function recompileConsolidatedPdf(token, applicationId, screenshotBase64) {
    return realRequest("admin/admission/recompile", "POST", { token, applicationId, screenshotBase64 });
  }

  async function getAdminDashboard(token) {
    return realRequest("admin/dashboard", "GET", null, { token });
  }

  async function getNotices() {
    const cached = cacheGet("notices");
    if (cached) return cached;
    const res = await realRequest("notices");
    if (res.ok) cacheSet("notices", res);
    return res;
  }

  async function getAdminNotices(token) {
    return realRequest("admin/notices", "GET", null, { token });
  }

  async function saveAdminNotice(token, notice) {
    const res = await realRequest("admin/notices", "POST", { token, ...notice });
    if (res.ok) cacheClear("notices");
    return res;
  }

  async function deleteAdminNotice(token, noticeId) {
    const res = await realRequest("admin/notices/delete", "POST", { token, noticeId });
    if (res.ok) cacheClear("notices");
    return res;
  }

  async function saveAdminSettings(token, updates) {
    const res = await realRequest("admin/settings", "POST", { token, updates });
    if (res.ok) cacheClear("settings");
    return res;
  }

  return {
    getSettings,
    getCourses,
    getFeeStructure,
    submitEnquiry,
    lookupStudent,
    initiatePhonePePayment,
    getPaymentStatus,
    login,
    logout,
    getStudentDashboard,
    getFeeReceipt,
    getTeacherDashboard,
    getTeacherStudents,
    markAttendance,
    getStudentIaMarks,
    getTeacherIaMarks,
    saveTeacherIaMarks,
    submitAdmissionApplication,
    getAdmissionApplications,
    getApplicationDocuments,
    getAdmissionApplication,
    recompileConsolidatedPdf,
    getAdminDashboard,
    getNotices,
    getAdminNotices,
    saveAdminNotice,
    deleteAdminNotice,
    saveAdminSettings,
  };
})();
