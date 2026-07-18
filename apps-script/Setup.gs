/**
 * One-time / re-runnable setup: creates every sheet tab this backend expects
 * with the correct header row, and seeds demo data (courses, students,
 * teachers, admin, notices, attendance, a few payments) so login + all
 * dashboards are testable immediately.
 *
 * Run manually from the Apps Script editor: select `runFirstTimeSetup` in
 * the function dropdown and click Run. First run will prompt for permission
 * to access this Sheet — that consent has to come from you, it can't be
 * scripted.
 */
function setupSheets() {
  const ss = getSpreadsheet();

  const schemas = {
    Settings: ["Key", "Value"],
    Courses: ["CourseId", "Name", "DepartmentId", "Level", "DurationYears", "Eligibility", "SeatsAvailable", "SyllabusUrl", "Featured", "Active"],
    Departments: ["DepartmentId", "Name", "HodName", "Description", "ImageUrl", "Active"],
    Faculty: ["FacultyId", "Name", "Designation", "DepartmentId", "Qualification", "PhotoUrl", "Email", "Active"],
    Gallery: ["ImageId", "Category", "ImageUrl", "Caption", "Order", "Active"],
    FAQ: ["FaqId", "Category", "Question", "Answer", "Order", "Active"],
    Admissions_Enquiries: ["EnquiryId", "Timestamp", "Name", "Phone", "Email", "CourseInterest", "Message", "Type", "Status", "Source"],
    Fee_Structures: ["FeeId", "CourseId", "Term", "Amount", "DueDate", "Active"],
    Payments_Log: ["OrderId", "PhonePeTransactionId", "StudentName", "StudentPhone", "StudentEmail", "CourseId", "FeeId", "Amount", "Status", "CreatedAt", "UpdatedAt", "RawCallbackPayload"],
    Students: ["StudentId", "AdmissionId", "Name", "Phone", "Email", "CourseId", "EnrollmentYear", "Status", "PasswordHash", "Salt"],
    Teachers: ["TeacherId", "Name", "Email", "Phone", "PasswordHash", "Salt", "DepartmentId", "CoursesAssigned", "Active"],
    Admins: ["AdminId", "Name", "Email", "PasswordHash", "Salt", "Active"],
    Sessions: ["Token", "Role", "UserId", "IssuedAt", "ExpiresAt"],
    Attendance: ["AttendanceId", "StudentId", "CourseId", "Date", "Status", "MarkedBy", "Timestamp"],
    Notices: ["NoticeId", "Title", "Body", "Date", "Active", "Order"],
  };

  Object.keys(schemas).forEach((name) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = schemas[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  });

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && defaultSheet.getLastRow() <= 1 && defaultSheet.getLastColumn() <= 1) {
    ss.deleteSheet(defaultSheet);
  }

  Logger.log("Sheet tabs + headers ready.");
}

/** Demo password used for every seeded account of that role — change in production. */
const DEMO_PASSWORDS = { student: "Student@123", teacher: "Teacher@123", admin: "Admin@123" };

function credential(password) {
  const salt = Utilities.getUuid();
  return { salt, hash: hashPassword(password, salt) };
}

/**
 * Clears and re-seeds all demo/reference data: Departments, Courses,
 * Fee_Structures, Students, Teachers, Admins, Notices, Attendance,
 * Payments_Log. Does NOT touch Admissions_Enquiries or Sessions (real
 * submitted data / live sessions). Safe to re-run — always overwrites with
 * a fresh known-good set rather than trying to merge.
 */
function resetDemoData() {
  ["Departments", "Courses", "Fee_Structures", "Students", "Teachers", "Admins", "Notices", "Attendance", "Payments_Log"].forEach(clearDataRows);

  const ss = getSpreadsheet();

  ss.getSheetByName("Departments").getRange(2, 1, 4, 6).setValues([
    ["DEPT-SCI", "Science", "Dr. Meera Iyer", "Computer Science, Physics, Mathematics.", "", true],
    ["DEPT-COM", "Commerce", "Prof. Sanjay Rao", "Accounting, Finance, Business Studies.", "", true],
    ["DEPT-MGT", "Management", "Dr. Kavita Nair", "Business Administration and Management.", "", true],
    ["DEPT-ARTS", "Arts & Humanities", "Prof. Alok Desai", "Literature, Languages, Social Sciences.", "", true],
  ]);

  ss.getSheetByName("Courses").getRange(2, 1, 8, 10).setValues([
    ["BSC-CS", "B.Sc. Computer Science", "DEPT-SCI", "UG", 3, "10+2 with Science", 60, "", true, true],
    ["MSC-CS", "M.Sc. Computer Science", "DEPT-SCI", "PG", 2, "B.Sc. CS/IT", 30, "", false, true],
    ["BCA", "Bachelor of Computer Applications", "DEPT-SCI", "UG", 3, "10+2 any stream", 60, "", true, true],
    ["BCOM", "B.Com", "DEPT-COM", "UG", 3, "10+2 any stream", 120, "", true, true],
    ["MCOM", "M.Com", "DEPT-COM", "PG", 2, "B.Com", 40, "", false, true],
    ["BBA", "BBA", "DEPT-MGT", "UG", 3, "10+2 any stream", 80, "", true, true],
    ["BA-ENG", "BA English", "DEPT-ARTS", "UG", 3, "10+2 any stream", 50, "", false, true],
    ["BSC-PHY", "B.Sc. Physics", "DEPT-SCI", "UG", 3, "10+2 with Science", 40, "", false, true],
  ]);

  ss.getSheetByName("Fee_Structures").getRange(2, 1, 8, 6).setValues([
    ["FEE-BSC-CS-S1", "BSC-CS", "Semester 1", 45000, "2026-08-15", true],
    ["FEE-MSC-CS-S1", "MSC-CS", "Semester 1", 38000, "2026-08-15", true],
    ["FEE-BCA-Y1", "BCA", "Year 1", 50000, "2026-08-15", true],
    ["FEE-BCOM-Y1", "BCOM", "Year 1", 35000, "2026-08-15", true],
    ["FEE-MCOM-Y1", "MCOM", "Year 1", 32000, "2026-08-15", true],
    ["FEE-BBA-Y1", "BBA", "Year 1", 55000, "2026-08-15", true],
    ["FEE-BAENG-Y1", "BA-ENG", "Year 1", 28000, "2026-08-15", true],
    ["FEE-BSCPHY-Y1", "BSC-PHY", "Year 1", 42000, "2026-08-15", true],
  ]);

  const studentSeed = [
    ["STU-0001", "AC2026-0001", "Riya Sharma", "9812345670", "riya.sharma@example.com", "BSC-CS", 2026, "Enrolled"],
    ["STU-0002", "AC2026-0002", "Arjun Mehta", "9822233344", "arjun.mehta@example.com", "BCOM", 2026, "Enrolled"],
    ["STU-0003", "AC2026-0003", "Sneha Patil", "9900112233", "sneha.patil@example.com", "BBA", 2026, "Enrolled"],
    ["STU-0004", "AC2026-0004", "Karan Shah", "9911223344", "karan.shah@example.com", "BCA", 2026, "Enrolled"],
    ["STU-0005", "AC2026-0005", "Neha Joshi", "9922334455", "neha.joshi@example.com", "MSC-CS", 2026, "Enrolled"],
    ["STU-0006", "AC2026-0006", "Aditya Kulkarni", "9933445566", "aditya.kulkarni@example.com", "MCOM", 2026, "Enrolled"],
    ["STU-0007", "AC2026-0007", "Pooja Nair", "9944556677", "pooja.nair@example.com", "BA-ENG", 2026, "Enrolled"],
    ["STU-0008", "AC2026-0008", "Rahul Verma", "9955667788", "rahul.verma@example.com", "BSC-PHY", 2026, "Applied"],
  ].map((row) => {
    const c = credential(DEMO_PASSWORDS.student);
    return row.concat([c.hash, c.salt]);
  });
  ss.getSheetByName("Students").getRange(2, 1, studentSeed.length, 10).setValues(studentSeed);

  const teacherSeed = [
    ["TCH-0001", "Priya Verma", "priya.verma@arihantcollege.example", "9871234560", "DEPT-SCI", "BSC-CS,MSC-CS,BCA,BSC-PHY", true],
    ["TCH-0002", "Rohan Kulkarni", "rohan.kulkarni@arihantcollege.example", "9871234561", "DEPT-COM", "BCOM,MCOM", true],
    ["TCH-0003", "Ananya Rao", "ananya.rao@arihantcollege.example", "9871234562", "DEPT-MGT", "BBA,BA-ENG", true],
  ].map((row) => {
    const c = credential(DEMO_PASSWORDS.teacher);
    return [row[0], row[1], row[2], row[3], c.hash, c.salt, row[4], row[5], row[6]];
  });
  ss.getSheetByName("Teachers").getRange(2, 1, teacherSeed.length, 9).setValues(teacherSeed);

  const adminCred = credential(DEMO_PASSWORDS.admin);
  ss.getSheetByName("Admins").getRange(2, 1, 1, 6).setValues([
    ["ADM-0001", "Admin User", "admin@arihantcollege.example", adminCred.hash, adminCred.salt, true],
  ]);

  ss.getSheetByName("Notices").getRange(2, 1, 2, 6).setValues([
    ["NOTICE-0001", "Admissions Open — 2026 Batch", "Applications for the 2026 academic year are now open across all UG and PG programs. Apply online or visit the admissions office.", new Date(), true, 1],
    ["NOTICE-0002", "Semester 1 Exam Schedule Released", "The Semester 1 examination timetable has been published. Check with your department office for the full schedule.", new Date(), true, 2],
  ]);

  const attendanceDates = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];
  const riyaStatuses = ["Present", "Present", "Absent", "Present", "Present", "Present", "Absent", "Present", "Present", "Present"];
  const karanStatuses = ["Present", "Absent", "Present", "Present", "Present", "Present", "Present", "Absent", "Present", "Present"];
  const attendanceRows = [];
  attendanceDates.forEach((date, i) => {
    attendanceRows.push([Utilities.getUuid(), "STU-0001", "BSC-CS", date, riyaStatuses[i], "TCH-0001", new Date()]);
    attendanceRows.push([Utilities.getUuid(), "STU-0004", "BCA", date, karanStatuses[i], "TCH-0001", new Date()]);
  });
  ss.getSheetByName("Attendance").getRange(2, 1, attendanceRows.length, 7).setValues(attendanceRows);

  ss.getSheetByName("Payments_Log").getRange(2, 1, 3, 12).setValues([
    ["AC-SEED-0001", "", "Riya Sharma", "9812345670", "riya.sharma@example.com", "BSC-CS", "FEE-BSC-CS-S1", 45000, "SUCCESS", new Date("2026-06-01"), new Date("2026-06-01"), ""],
    ["AC-SEED-0002", "", "Arjun Mehta", "9822233344", "arjun.mehta@example.com", "BCOM", "FEE-BCOM-Y1", 35000, "PENDING", new Date("2026-07-10"), new Date("2026-07-10"), ""],
    ["AC-SEED-0003", "", "Sneha Patil", "9900112233", "sneha.patil@example.com", "BBA", "FEE-BBA-Y1", 55000, "FAILED", new Date("2026-07-05"), new Date("2026-07-05"), ""],
  ]);

  ensureSettingsKeys({
    hero_eyebrow: "Admissions Open — 2026 Batch",
    hero_title: "Shape Your Future at Arihant College",
    hero_subtitle: "Modern campus. Industry-aligned courses. A placement record that speaks for itself.",
  });

  Logger.log("Demo data reset complete.");
  Logger.log("Student login: AC2026-0001 / " + DEMO_PASSWORDS.student);
  Logger.log("Teacher login: priya.verma@arihantcollege.example / " + DEMO_PASSWORDS.teacher);
  Logger.log("Admin login: admin@arihantcollege.example / " + DEMO_PASSWORDS.admin);
}

function ensureSettingsKeys(defaults) {
  const existing = readSheet("Settings");
  const existingKeys = existing.map((r) => r.Key);
  Object.keys(defaults).forEach((key) => {
    if (existingKeys.indexOf(key) === -1) {
      appendRow("Settings", { Key: key, Value: defaults[key] });
    }
  });
}

/**
 * Sets the Script Properties this backend needs to run. Safe to re-run —
 * it overwrites with whatever values are passed in.
 */
function setScriptProperties(props) {
  PropertiesService.getScriptProperties().setProperties(props, false);
  Logger.log("Script properties set: " + Object.keys(props).join(", "));
}

/**
 * Run this one manually from the Apps Script editor (function dropdown at
 * top → runFirstTimeSetup → Run). It has no parameters on purpose — the
 * editor's Run button can't pass arguments, and this is the function meant
 * to be clicked to (re-)initialize everything. It will prompt for permission
 * the first time; approve it (this account, not a script/API call, has to
 * click through Google's consent screen).
 *
 * Creates all sheet tabs + headers, sets Script Properties (SPREADSHEET_ID,
 * API_KEY), and resets demo data (courses, students, teachers, admin,
 * notices, attendance, a few payments).
 */
function runFirstTimeSetup() {
  setScriptProperties({
    SPREADSHEET_ID: "1roz3mrLS8ZDWrTIFRKi-2UU0lgH9Ij-yu2rTdTEoMQE",
    API_KEY: "e233408c2bf4318aae7c52d27ffc4619a24ef3247f449602",
  });
  setupSheets();
  resetDemoData();
}
