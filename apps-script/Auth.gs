/**
 * Password-based login for Students / Teachers / Admins.
 * Not Google OAuth — a plain credential (email/phone/Admission ID + password)
 * checked against a salted SHA-256 hash stored in the respective sheet, with
 * a random session token stored in the Sessions sheet (8h expiry).
 *
 * This is intentionally simple (prototype-grade), not a hardened auth system:
 * tokens travel as query/body params over HTTPS, there's no refresh flow,
 * no lockout after failed attempts. Good enough for a college demo, not for
 * handling anything more sensitive than attendance/fee-status.
 */

function hashPassword(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ":" + salt);
  return bytes.map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

const ROLE_SHEETS = { student: "Students", teacher: "Teachers", admin: "Admins" };
const ROLE_ID_FIELD = { student: "StudentId", teacher: "TeacherId", admin: "AdminId" };

function login(e) {
  const body = JSON.parse(e.postData.contents);
  const role = body.role;
  const identifier = String(body.identifier || "").trim().toLowerCase();
  const password = String(body.password || "");

  const sheetName = ROLE_SHEETS[role];
  if (!sheetName) return jsonResponse({ ok: false, error: "Invalid role" });
  if (!identifier || !password) return jsonResponse({ ok: false, error: "Missing credentials" });

  const cache = CacheService.getScriptCache();
  const throttleKey = "login_" + role + "_" + identifier;
  if (cache.get(throttleKey)) return jsonResponse({ ok: false, error: "Too many attempts. Wait a moment and try again." });

  const users = readSheet(sheetName);
  const user = users.find((u) => {
    if (String(u.Email || "").toLowerCase() === identifier) return true;
    if (String(u.Phone || "") === identifier) return true;
    if (u.AdmissionId && String(u.AdmissionId).toLowerCase() === identifier) return true;
    return false;
  });

  if (!user || String(user.Active).toUpperCase() === "FALSE") {
    cache.put(throttleKey, "1", 5);
    return jsonResponse({ ok: false, error: "Invalid credentials" });
  }

  const computed = hashPassword(password, user.Salt);
  if (computed !== user.PasswordHash) {
    cache.put(throttleKey, "1", 5);
    return jsonResponse({ ok: false, error: "Invalid credentials" });
  }

  const token = Utilities.getUuid();
  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const userId = user[ROLE_ID_FIELD[role]];

  appendRow("Sessions", { Token: token, Role: role, UserId: userId, IssuedAt: now, ExpiresAt: expires });

  return jsonResponse({
    ok: true,
    data: {
      token,
      role,
      id: userId,
      name: user.Name,
      courseId: user.CourseId || null,
      coursesAssigned: user.CoursesAssigned || null,
    },
  });
}

function logout(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.token) deleteRowByKey("Sessions", "Token", body.token);
  return jsonResponse({ ok: true });
}

/** Returns { role, userId } for a valid, unexpired token, or null. */
function authenticate(token) {
  if (!token) return null;
  const session = findRowByKey("Sessions", "Token", token);
  if (!session) return null;
  if (new Date(session.ExpiresAt).getTime() < Date.now()) return null;
  return { role: session.Role, userId: session.UserId };
}

function requireRole(token, allowedRoles) {
  const auth = authenticate(token);
  if (!auth) return null;
  if (allowedRoles.indexOf(auth.role) === -1) return null;
  return auth;
}
