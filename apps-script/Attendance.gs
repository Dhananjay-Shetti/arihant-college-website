/**
 * Student dashboard (attendance + fees) and teacher attendance marking.
 */

function getStudentDashboard(e) {
  const auth = requireRole(e.parameter.token, ["student"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const student = findRowByKey("Students", "StudentId", auth.userId);
  if (!student) return jsonResponse({ ok: false, error: "Student not found" });

  const course = findRowByKey("Courses", "CourseId", student.CourseId);
  const attendanceRows = readSheet("Attendance")
    .filter((a) => a.StudentId === student.StudentId)
    .sort((a, b) => toDateKey(a.Date).localeCompare(toDateKey(b.Date)));

  const monthPrefix = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM");
  const monthRows = attendanceRows.filter((a) => toDateKey(a.Date).indexOf(monthPrefix) === 0);
  const monthPresent = monthRows.filter((a) => a.Status === "Present").length;
  const monthlyPercent = monthRows.length ? Math.round((monthPresent / monthRows.length) * 100) : null;

  const overallPresent = attendanceRows.filter((a) => a.Status === "Present").length;
  const overallPercent = attendanceRows.length ? Math.round((overallPresent / attendanceRows.length) * 100) : null;

  const payments = readSheet("Payments_Log").filter((p) => p.StudentPhone === student.Phone);

  return jsonResponse({
    ok: true,
    data: {
      name: student.Name,
      admissionId: student.AdmissionId,
      courseId: student.CourseId,
      courseName: course ? course.Name : student.CourseId,
      attendance: {
        records: attendanceRows.map((a) => ({ date: toDateKey(a.Date), status: a.Status })),
        monthlyPercent,
        overallPercent,
      },
      fees: {
        paid: payments.filter((p) => p.Status === "SUCCESS"),
        pending: payments.filter((p) => p.Status === "INITIATED" || p.Status === "PENDING"),
        failed: payments.filter((p) => p.Status === "FAILED"),
      },
    },
  });
}

function getFeeReceipt(e) {
  const auth = requireRole(e.parameter.token, ["student"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const student = findRowByKey("Students", "StudentId", auth.userId);
  const payment = findRowByKey("Payments_Log", "OrderId", e.parameter.orderId);
  if (!payment || payment.StudentPhone !== student.Phone) {
    return jsonResponse({ ok: false, error: "Receipt not found" });
  }
  if (payment.Status !== "SUCCESS") {
    return jsonResponse({ ok: false, error: "This payment has not completed successfully" });
  }

  const fee = findRowByKey("Fee_Structures", "FeeId", payment.FeeId);
  const course = findRowByKey("Courses", "CourseId", payment.CourseId);

  return jsonResponse({
    ok: true,
    data: {
      orderId: payment.OrderId,
      studentName: payment.StudentName,
      admissionId: student.AdmissionId,
      courseName: course ? course.Name : payment.CourseId,
      term: fee ? fee.Term : payment.FeeId,
      amount: payment.Amount,
      paidOn: payment.UpdatedAt,
      phonePeTransactionId: payment.PhonePeTransactionId,
    },
  });
}

function getTeacherDashboard(e) {
  const auth = requireRole(e.parameter.token, ["teacher"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const teacher = findRowByKey("Teachers", "TeacherId", auth.userId);
  if (!teacher) return jsonResponse({ ok: false, error: "Teacher not found" });

  const courseIds = String(teacher.CoursesAssigned || "").split(",").map((s) => s.trim()).filter(Boolean);
  const students = readSheet("Students");
  const courses = readSheet("Courses");

  const classes = courseIds.map((cid) => {
    const course = courses.find((c) => c.CourseId === cid);
    return {
      courseId: cid,
      courseName: course ? course.Name : cid,
      studentCount: students.filter((s) => s.CourseId === cid).length,
    };
  });

  return jsonResponse({ ok: true, data: { name: teacher.Name, classes } });
}

function getTeacherStudents(e) {
  const auth = requireRole(e.parameter.token, ["teacher"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const teacher = findRowByKey("Teachers", "TeacherId", auth.userId);
  const assigned = String(teacher.CoursesAssigned || "").split(",").map((s) => s.trim());
  const courseId = e.parameter.course;
  if (assigned.indexOf(courseId) === -1) return jsonResponse({ ok: false, error: "Not assigned to this course" });

  const date = e.parameter.date || Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
  const students = readSheet("Students").filter((s) => s.CourseId === courseId);
  const attendance = readSheet("Attendance").filter((a) => a.CourseId === courseId && toDateKey(a.Date) === date);

  const data = students.map((s) => {
    const rec = attendance.find((a) => a.StudentId === s.StudentId);
    return { studentId: s.StudentId, admissionId: s.AdmissionId, name: s.Name, status: rec ? rec.Status : null };
  });

  return jsonResponse({ ok: true, data: { date, students: data } });
}

function markAttendance(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["teacher"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const teacher = findRowByKey("Teachers", "TeacherId", auth.userId);
  const assigned = String(teacher.CoursesAssigned || "").split(",").map((s) => s.trim());
  if (assigned.indexOf(body.courseId) === -1) return jsonResponse({ ok: false, error: "Not assigned to this course" });
  if (!body.date || !Array.isArray(body.records)) return jsonResponse({ ok: false, error: "Invalid payload" });

  const existing = readSheet("Attendance").filter((a) => a.CourseId === body.courseId && toDateKey(a.Date) === body.date);

  body.records.forEach((rec) => {
    const match = existing.find((a) => a.StudentId === rec.studentId);
    if (match) {
      updateRowByKey("Attendance", "AttendanceId", match.AttendanceId, {
        Status: rec.status,
        MarkedBy: auth.userId,
        Timestamp: new Date(),
      });
    } else {
      appendRow("Attendance", {
        AttendanceId: Utilities.getUuid(),
        StudentId: rec.studentId,
        CourseId: body.courseId,
        Date: body.date,
        Status: rec.status,
        MarkedBy: auth.userId,
        Timestamp: new Date(),
      });
    }
  });

  return jsonResponse({ ok: true, data: { saved: body.records.length } });
}
