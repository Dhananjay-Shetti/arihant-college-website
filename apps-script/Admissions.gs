/**
 * Admin-only admission intake form: captures applicant details and uploads
 * their documents into Google Drive under CollegeData/AdmissionForms/<ApplicationId>/.
 *
 * Files arrive as base64 in the JSON POST body (Apps Script's doPost has no
 * clean multipart/form-data support, so this is the standard workaround —
 * the client reads each File as a data URL, strips the data: prefix, and
 * sends the base64 payload alongside its declared mimeType/fileName).
 *
 * This is intake for NEW applicants, distinct from the Students sheet
 * (which is for already-enrolled students with login credentials) — no
 * login account is created here, just the application record + documents.
 */

const ALLOWED_DOC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5MB per file, matches the client-side limit

const REQUIRED_DOCS_BY_PROGRAM = {
  PUC: ["10th Marks Card", "Leaving Certificate", "Caste/Income Certificate"],
  Degree: ["10th Marks Card", "12th Marks Card", "Leaving Certificate", "Caste/Income Certificate"],
};

/** Finds a folder by name under `parent`, creating it if it doesn't exist. Idempotent. */
function getOrCreateFolder(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

function getAdmissionFormsFolder() {
  const root = DriveApp.getRootFolder();
  const collegeData = getOrCreateFolder(root, "CollegeData");
  return getOrCreateFolder(collegeData, "AdmissionForms");
}

/** APP-<year>-<sequential>, e.g. APP-2026-0001. Lock-guarded so two near-simultaneous submissions can't collide. */
function generateApplicationId() {
  const year = new Date().getFullYear();
  const count = readSheet("Admission_Applications").filter(
    (r) => String(r.ApplicationId || "").indexOf("APP-" + year) === 0
  ).length;
  return "APP-" + year + "-" + String(count + 1).padStart(4, "0");
}

function isValidDob(dob) {
  // Expects DD/MM/YYYY from the client.
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob || "");
  if (!m) return false;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && year > 1900 && year < new Date().getFullYear();
}

function validateAdmissionPayload(body) {
  if (!body.firstName || !body.firstName.trim()) return "First name is required";
  if (!body.lastName || !body.lastName.trim()) return "Last name is required";
  if (!isValidDob(body.dob)) return "Date of birth must be a valid DD/MM/YYYY date";
  if (!body.fatherName || !body.fatherName.trim()) return "Father's name is required";
  if (!/^[6-9]\d{9}$/.test(body.mobileNumber || "")) return "Enter a valid 10-digit mobile number";

  if (!body.present || !body.present.address || !body.present.city || !body.present.state) return "Present address is incomplete";
  if (!/^\d{6}$/.test((body.present || {}).pincode || "")) return "Present address pincode must be 6 digits";

  if (!body.permanent || !body.permanent.address || !body.permanent.city || !body.permanent.state) return "Permanent address is incomplete";
  if (!/^\d{6}$/.test((body.permanent || {}).pincode || "")) return "Permanent address pincode must be 6 digits";

  if (["PUC", "Degree"].indexOf(body.programType) === -1) return "Program type must be PUC or Degree";

  const required = REQUIRED_DOCS_BY_PROGRAM[body.programType];
  const submittedTypes = (body.documents || []).map((d) => d.docType);
  const missing = required.filter((docType) => submittedTypes.indexOf(docType) === -1);
  if (missing.length) return "Missing required document(s): " + missing.join(", ");

  for (const doc of body.documents || []) {
    if (ALLOWED_DOC_MIME_TYPES.indexOf(doc.mimeType) === -1) {
      return doc.docType + ": file type must be PDF, JPG, or PNG";
    }
    // Base64 is ~4/3 the size of the decoded bytes — check before decoding.
    const approxBytes = (doc.base64Data || "").length * 0.75;
    if (approxBytes > MAX_DOC_BYTES) {
      return doc.docType + ": file exceeds the 5MB limit";
    }
  }

  return null;
}

function submitAdmissionApplication(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const error = validateAdmissionPayload(body);
  if (error) return jsonResponse({ ok: false, error: error });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let applicationId;
  try {
    applicationId = generateApplicationId();
    // Reserve the ID immediately (Status: "Processing") so a second submission
    // racing us reads a sheet that already accounts for this one.
    appendRow("Admission_Applications", { ApplicationId: applicationId, Status: "Processing", CreatedAt: new Date() });
  } finally {
    lock.releaseLock();
  }

  try {
    const formsFolder = getAdmissionFormsFolder();
    const appFolder = getOrCreateFolder(formsFolder, applicationId);

    const uploaded = [];
    (body.documents || []).forEach((doc) => {
      const bytes = Utilities.base64Decode(doc.base64Data);
      const ext = doc.mimeType === "application/pdf" ? "pdf" : doc.mimeType === "image/png" ? "png" : "jpg";
      const blob = Utilities.newBlob(bytes, doc.mimeType, doc.docType + "." + ext);
      const file = appFolder.createFile(blob);
      uploaded.push({ docType: doc.docType, fileName: doc.fileName || blob.getName(), mimeType: doc.mimeType, file: file });
    });

    updateRowByKey("Admission_Applications", "ApplicationId", applicationId, {
      FirstName: body.firstName.trim(),
      MiddleName: (body.middleName || "").trim(),
      LastName: body.lastName.trim(),
      DOB: body.dob,
      FatherName: body.fatherName.trim(),
      MotherName: (body.motherName || "").trim(),
      PresentAddress: body.present.address,
      PresentCity: body.present.city,
      PresentState: body.present.state,
      PresentPincode: body.present.pincode,
      PermanentAddress: body.permanent.address,
      PermanentCity: body.permanent.city,
      PermanentState: body.permanent.state,
      PermanentPincode: body.permanent.pincode,
      MobileNumber: body.mobileNumber,
      ProgramType: body.programType,
      DriveFolderId: appFolder.getId(),
      DriveFolderUrl: appFolder.getUrl(),
      Status: "Submitted",
      CreatedBy: auth.userId,
    });

    uploaded.forEach((u) => {
      appendRow("Admission_Documents", {
        DocId: Utilities.getUuid(),
        ApplicationId: applicationId,
        DocType: u.docType,
        FileName: u.fileName,
        MimeType: u.mimeType,
        DriveFileId: u.file.getId(),
        DriveFileUrl: u.file.getUrl(),
        UploadedAt: new Date(),
      });
    });

    return jsonResponse({
      ok: true,
      data: { applicationId: applicationId, driveFolderUrl: appFolder.getUrl(), documentsUploaded: uploaded.length },
    });
  } catch (err) {
    updateRowByKey("Admission_Applications", "ApplicationId", applicationId, { Status: "Failed: " + err.message });
    logError("admin/admission/submit", err);
    return jsonResponse({ ok: false, error: "Submission failed while creating the Drive folder or uploading documents. The application ID " + applicationId + " was reserved but not completed — contact an admin before resubmitting." });
  }
}

function listAdmissionApplications(e) {
  const auth = requireRole(e.parameter.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const rows = readSheet("Admission_Applications")
    .filter((r) => r.Status === "Submitted")
    .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
    .slice(0, 30)
    .map((r) => ({
      applicationId: r.ApplicationId,
      name: [r.FirstName, r.MiddleName, r.LastName].filter(Boolean).join(" "),
      mobileNumber: r.MobileNumber,
      programType: r.ProgramType,
      driveFolderUrl: r.DriveFolderUrl,
      createdAt: r.CreatedAt,
    }));

  return jsonResponse({ ok: true, data: rows });
}
