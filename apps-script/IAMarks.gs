/**
 * Internal Assessment (IA) marks: students view their own, teachers enter/
 * update marks for their assigned classes. Every write is audited in
 * IA_Marks_Audit (old value, new value, who, when) — including first-time
 * entry, since "no mark yet -> a mark" is itself a grade change worth
 * tracing.
 *
 * Subject is free text (not a managed list) — the existing schema has no
 * per-course subject catalog, and adding one was out of scope for this
 * pass. Teachers type the subject name; it's just a string key alongside
 * CourseId + Component ("IA1"/"IA2"/etc) that ties a mark to a specific
 * assessment.
 */

function getStudentIaMarks(e) {
  const auth = requireRole(e.parameter.token, ["student"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const rows = readSheet("IA_Marks")
    .filter((r) => r.StudentId === auth.userId)
    .sort((a, b) => (a.Subject + a.Component).localeCompare(b.Subject + b.Component))
    .map((r) => ({
      subject: r.Subject,
      component: r.Component,
      marksObtained: r.MarksObtained,
      maxMarks: r.MaxMarks,
      percent: r.MaxMarks ? Math.round((r.MarksObtained / r.MaxMarks) * 100) : null,
      updatedAt: r.UpdatedAt,
    }));

  return jsonResponse({ ok: true, data: rows });
}

function getTeacherIaMarks(e) {
  const auth = requireRole(e.parameter.token, ["teacher"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const teacher = findRowByKey("Teachers", "TeacherId", auth.userId);
  const assigned = String(teacher.CoursesAssigned || "").split(",").map((s) => s.trim());
  const courseId = e.parameter.course;
  const subject = String(e.parameter.subject || "").trim();
  const component = String(e.parameter.component || "").trim();
  if (assigned.indexOf(courseId) === -1) return jsonResponse({ ok: false, error: "Not assigned to this course" });
  if (!subject || !component) return jsonResponse({ ok: false, error: "Subject and component are required" });

  const students = readSheet("Students").filter((s) => s.CourseId === courseId);
  const marks = readSheet("IA_Marks").filter(
    (m) => m.CourseId === courseId && m.Subject === subject && m.Component === component
  );

  const data = students.map((s) => {
    const rec = marks.find((m) => m.StudentId === s.StudentId);
    return {
      studentId: s.StudentId,
      admissionId: s.AdmissionId,
      name: s.Name,
      marksObtained: rec ? rec.MarksObtained : null,
      maxMarks: rec ? rec.MaxMarks : null,
    };
  });

  return jsonResponse({ ok: true, data: { students: data } });
}

function postTeacherIaMarks(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["teacher"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const teacher = findRowByKey("Teachers", "TeacherId", auth.userId);
  const assigned = String(teacher.CoursesAssigned || "").split(",").map((s) => s.trim());
  const courseId = body.courseId;
  const subject = String(body.subject || "").trim();
  const component = String(body.component || "").trim();
  const maxMarks = Number(body.maxMarks);

  if (assigned.indexOf(courseId) === -1) return jsonResponse({ ok: false, error: "Not assigned to this course" });
  if (!subject || !component) return jsonResponse({ ok: false, error: "Subject and component are required" });
  if (!maxMarks || maxMarks <= 0) return jsonResponse({ ok: false, error: "Max marks must be a positive number" });
  if (!Array.isArray(body.records) || !body.records.length) return jsonResponse({ ok: false, error: "No marks submitted" });

  for (let i = 0; i < body.records.length; i++) {
    const m = Number(body.records[i].marks);
    if (isNaN(m) || m < 0 || m > maxMarks) {
      return jsonResponse({ ok: false, error: "Marks for " + body.records[i].studentId + " must be between 0 and " + maxMarks });
    }
  }

  const existing = readSheet("IA_Marks").filter(
    (m) => m.CourseId === courseId && m.Subject === subject && m.Component === component
  );
  const now = new Date();
  let saved = 0;

  body.records.forEach((rec) => {
    const marks = Number(rec.marks);
    const match = existing.find((m) => m.StudentId === rec.studentId);
    const oldMarks = match ? match.MarksObtained : "";

    if (!match || Number(match.MarksObtained) !== marks) {
      appendRow("IA_Marks_Audit", {
        AuditId: Utilities.getUuid(),
        IaId: match ? match.IaId : "",
        StudentId: rec.studentId,
        Subject: subject,
        Component: component,
        OldMarks: oldMarks,
        NewMarks: marks,
        ChangedBy: auth.userId,
        ChangedAt: now,
      });
    }

    if (match) {
      updateRowByKey("IA_Marks", "IaId", match.IaId, {
        MaxMarks: maxMarks,
        MarksObtained: marks,
        EnteredBy: auth.userId,
        UpdatedAt: now,
      });
    } else {
      appendRow("IA_Marks", {
        IaId: Utilities.getUuid(),
        StudentId: rec.studentId,
        CourseId: courseId,
        Subject: subject,
        Component: component,
        MaxMarks: maxMarks,
        MarksObtained: marks,
        EnteredBy: auth.userId,
        UpdatedAt: now,
      });
    }
    saved++;
  });

  return jsonResponse({ ok: true, data: { saved } });
}
