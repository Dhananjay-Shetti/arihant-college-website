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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email || "")) return "Enter a valid email address";

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

/** Resizes/positions an inserted Slides image to fill the page, preserving its aspect ratio (centered, letterboxed). */
function fitImageToPage(image, pageWidth, pageHeight) {
  const w = image.getWidth();
  const h = image.getHeight();
  const scale = Math.min(pageWidth / w, pageHeight / h);
  const newW = w * scale;
  const newH = h * scale;
  image.setWidth(newW);
  image.setHeight(newH);
  image.setLeft((pageWidth - newW) / 2);
  image.setTop((pageHeight - newH) / 2);
}

function addPlaceholderPage(slide, pageWidth, pageHeight, text) {
  const box = slide.insertTextBox(text, pageWidth * 0.1, pageHeight * 0.4, pageWidth * 0.8, pageHeight * 0.2);
  box.getText().getTextStyle().setFontSize(16).setBold(true);
  box.getText().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
}

/**
 * Compiles one multi-page PDF: page 1 = the submitted-application
 * screenshot, then one page per required document in program order
 * (matches REQUIRED_DOCS_BY_PROGRAM, so PUC yields exactly the 3-document
 * order and Degree extends it with 12th Marks Card).
 *
 * Documents uploaded as JPG/PNG are embedded as real page images. Apps
 * Script has no native way to rasterize an existing PDF's pages into
 * another PDF — there's no PDF-page-extraction API in the platform, and
 * this project isn't reaching for a paid third-party PDF service just for
 * this — so a document uploaded AS a PDF gets a placeholder page here
 * instead, pointing at the original file. That original is uploaded
 * individually regardless (see the caller) and is never lost either way.
 *
 * Builds the pages in a throwaway Slides file (Slides is the one native
 * Apps Script service that can lay out full-bleed images per page and
 * export the whole thing as a real multi-page PDF via getAs(MimeType.PDF))
 * then trashes it — only the exported PDF is kept.
 */
function compileConsolidatedPdf(appFolder, applicationId, screenshotBase64, uploadedDocs, programType) {
  const presentation = SlidesApp.create(applicationId + "_temp_compile");
  try {
    const pageWidth = presentation.getPageWidth();
    const pageHeight = presentation.getPageHeight();
    const docOrder = REQUIRED_DOCS_BY_PROGRAM[programType];
    const totalPages = 1 + docOrder.length;

    const slides = presentation.getSlides();
    while (slides.length < totalPages) {
      slides.push(presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK));
    }

    const screenshotSlide = slides[0];
    screenshotSlide.getShapes().forEach((shape) => shape.remove());
    if (screenshotBase64) {
      const shotBlob = Utilities.newBlob(Utilities.base64Decode(screenshotBase64), "image/png", applicationId + "_screenshot.png");
      fitImageToPage(screenshotSlide.insertImage(shotBlob), pageWidth, pageHeight);
    } else {
      addPlaceholderPage(screenshotSlide, pageWidth, pageHeight, "Application screenshot was not captured.");
    }

    docOrder.forEach((docType, i) => {
      const slide = slides[i + 1];
      slide.getShapes().forEach((shape) => shape.remove());
      const doc = uploadedDocs.find((d) => d.docType === docType);
      if (!doc) {
        addPlaceholderPage(slide, pageWidth, pageHeight, docType + ": not uploaded.");
      } else if (doc.mimeType === "application/pdf") {
        addPlaceholderPage(slide, pageWidth, pageHeight, docType + "\n\nOriginal PDF attached separately\nin this Drive folder: " + doc.fileName);
      } else {
        fitImageToPage(slide.insertImage(doc.blob), pageWidth, pageHeight);
      }
    });

    const pdfBlob = DriveApp.getFileById(presentation.getId()).getAs(MimeType.PDF);
    pdfBlob.setName(applicationId + "_Consolidated_Admission_Application.pdf");
    const pdfFile = appFolder.createFile(pdfBlob);

    if (pdfFile.getSize() === 0) throw new Error("Compiled PDF export was empty");

    return { url: pdfFile.getUrl(), id: pdfFile.getId() };
  } finally {
    DriveApp.getFileById(presentation.getId()).setTrashed(true);
  }
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
      uploaded.push({ docType: doc.docType, fileName: doc.fileName || blob.getName(), mimeType: doc.mimeType, file: file, blob: blob });
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
      Email: body.email.trim(),
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

    // Save the screenshot as its own file in the folder — not just embedded
    // as page 1 of the compiled PDF below. An admin browsing the folder
    // listing directly (the common case) never opens a PDF to check its
    // first page; it needs to be a visible file on its own, and it needs to
    // exist independently of whether PDF compilation below succeeds.
    if (body.screenshotBase64) {
      try {
        const shotBlob = Utilities.newBlob(Utilities.base64Decode(body.screenshotBase64), "image/png", applicationId + "_Screenshot.png");
        const shotFile = appFolder.createFile(shotBlob);
        appendRow("Admission_Documents", {
          DocId: Utilities.getUuid(),
          ApplicationId: applicationId,
          DocType: "Screenshot",
          FileName: shotBlob.getName(),
          MimeType: "image/png",
          DriveFileId: shotFile.getId(),
          DriveFileUrl: shotFile.getUrl(),
          UploadedAt: new Date(),
        });
      } catch (shotErr) {
        logError("admin/admission/submit (screenshot save)", shotErr);
      }
    }

    // Core application + documents are safely saved at this point — a
    // compilation failure below must not look like a failed submission.
    const responseData = { applicationId: applicationId, driveFolderUrl: appFolder.getUrl(), documentsUploaded: uploaded.length };
    try {
      const compiled = compileConsolidatedPdf(appFolder, applicationId, body.screenshotBase64, uploaded, body.programType);
      updateRowByKey("Admission_Applications", "ApplicationId", applicationId, {
        ConsolidatedPdfUrl: compiled.url,
        ConsolidatedPdfStatus: "Compiled",
      });
      appendRow("Admission_Documents", {
        DocId: Utilities.getUuid(),
        ApplicationId: applicationId,
        DocType: "Consolidated PDF",
        FileName: applicationId + "_Consolidated_Admission_Application.pdf",
        MimeType: "application/pdf",
        DriveFileId: compiled.id,
        DriveFileUrl: compiled.url,
        UploadedAt: new Date(),
      });
      responseData.consolidatedPdfUrl = compiled.url;
    } catch (compileErr) {
      logError("admin/admission/submit (PDF compile)", compileErr);
      updateRowByKey("Admission_Applications", "ApplicationId", applicationId, {
        ConsolidatedPdfStatus: "Failed: " + compileErr.message,
      });
      responseData.consolidatedPdfWarning = "The application and individual documents were saved successfully, but the consolidated PDF could not be compiled: " + compileErr.message;
    }

    return jsonResponse({ ok: true, data: responseData });
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
      email: r.Email,
      programType: r.ProgramType,
      driveFolderUrl: r.DriveFolderUrl,
      consolidatedPdfUrl: r.ConsolidatedPdfUrl,
      consolidatedPdfStatus: r.ConsolidatedPdfStatus,
      createdAt: r.CreatedAt,
    }));

  return jsonResponse({ ok: true, data: rows });
}

/** Full stored record for one application — used to repopulate the print-summary template when regenerating a PDF (see recompileConsolidatedPdf). */
function getAdmissionApplication(e) {
  const auth = requireRole(e.parameter.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const r = findRowByKey("Admission_Applications", "ApplicationId", e.parameter.applicationId);
  if (!r) return jsonResponse({ ok: false, error: "Application not found" });

  return jsonResponse({
    ok: true,
    data: {
      applicationId: r.ApplicationId,
      firstName: r.FirstName,
      middleName: r.MiddleName,
      lastName: r.LastName,
      // DOB was written as a "DD/MM/YYYY" string, but Sheets auto-converts
      // date-looking strings into real Date cells on write (the same quirk
      // documented in CLAUDE.md for Attendance.Date/Fee_Structures.DueDate)
      // — read back, it's a Date object, not the original string. Reformat
      // rather than pass the raw ISO-with-timezone value through to the
      // regenerated screenshot.
      dob: r.DOB instanceof Date ? Utilities.formatDate(r.DOB, "Asia/Kolkata", "dd/MM/yyyy") : r.DOB,
      fatherName: r.FatherName,
      motherName: r.MotherName,
      mobileNumber: r.MobileNumber,
      email: r.Email,
      present: { address: r.PresentAddress, city: r.PresentCity, state: r.PresentState, pincode: r.PresentPincode },
      permanent: { address: r.PermanentAddress, city: r.PermanentCity, state: r.PermanentState, pincode: r.PermanentPincode },
      programType: r.ProgramType,
      driveFolderId: r.DriveFolderId,
      consolidatedPdfStatus: r.ConsolidatedPdfStatus,
    },
  });
}

/**
 * Rebuilds the consolidated PDF for an EXISTING application, using its
 * already-uploaded documents (re-fetched from Drive by the file IDs stored
 * in Admission_Documents — never re-uploaded, so this can't silently
 * substitute a different file for one already on record) plus a freshly
 * captured screenshot. For fixing an application whose first compile
 * attempt produced a broken page (e.g. a blank screenshot from the
 * off-screen html2canvas bug) without asking the admin to re-enter and
 * re-upload everything from scratch.
 */
/** Deletes every Admission_Documents row matching both applicationId and docType (Sheets.gs's deleteRowByKey only matches a single column, not enough here since one applicationId spans many rows). */
function deleteAdmissionDocumentRows(applicationId, docType) {
  const sheet = getSpreadsheet().getSheetByName("Admission_Documents");
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const appIdx = headers.indexOf("ApplicationId");
  const typeIdx = headers.indexOf("DocType");
  for (let r = values.length - 1; r >= 1; r--) {
    if (values[r][appIdx] === applicationId && values[r][typeIdx] === docType) {
      sheet.deleteRow(r + 1);
    }
  }
}

function recompileConsolidatedPdf(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const applicationId = body.applicationId;
  const appRow = findRowByKey("Admission_Applications", "ApplicationId", applicationId);
  if (!appRow) return jsonResponse({ ok: false, error: "Application not found" });
  if (!appRow.DriveFolderId) return jsonResponse({ ok: false, error: "Application has no Drive folder on record" });

  try {
    const appFolder = DriveApp.getFolderById(appRow.DriveFolderId);
    const docRows = readSheet("Admission_Documents").filter((d) => d.ApplicationId === applicationId);
    const requiredTypes = REQUIRED_DOCS_BY_PROGRAM[appRow.ProgramType] || [];

    const uploaded = requiredTypes
      .map((docType) => docRows.find((d) => d.DocType === docType))
      .filter(Boolean)
      .map((d) => ({
        docType: d.DocType,
        fileName: d.FileName,
        mimeType: d.MimeType,
        blob: DriveApp.getFileById(d.DriveFileId).getBlob(),
      }));

    const missing = requiredTypes.filter((t) => !uploaded.find((u) => u.docType === t));
    if (missing.length) {
      return jsonResponse({ ok: false, error: "Cannot recompile — missing original document(s) on record: " + missing.join(", ") });
    }

    // Trash the previous screenshot/consolidated-PDF files (if any) AND
    // remove their Admission_Documents rows — trashing the Drive file alone
    // (an earlier version of this function) left a dead row behind pointing
    // at a now-inaccessible file, which showed up as a confusing duplicate
    // "Consolidated PDF" entry with a broken link in the documents list.
    ["Screenshot", "Consolidated PDF"].forEach((docType) => {
      docRows
        .filter((d) => d.DocType === docType)
        .forEach((old) => {
          if (old.DriveFileId) {
            try { DriveApp.getFileById(old.DriveFileId).setTrashed(true); } catch (ignored) {}
          }
        });
      deleteAdmissionDocumentRows(applicationId, docType);
    });

    if (body.screenshotBase64) {
      const shotBlob = Utilities.newBlob(Utilities.base64Decode(body.screenshotBase64), "image/png", applicationId + "_Screenshot.png");
      const shotFile = appFolder.createFile(shotBlob);
      appendRow("Admission_Documents", {
        DocId: Utilities.getUuid(),
        ApplicationId: applicationId,
        DocType: "Screenshot",
        FileName: shotBlob.getName(),
        MimeType: "image/png",
        DriveFileId: shotFile.getId(),
        DriveFileUrl: shotFile.getUrl(),
        UploadedAt: new Date(),
      });
    }

    const compiled = compileConsolidatedPdf(appFolder, applicationId, body.screenshotBase64, uploaded, appRow.ProgramType);
    updateRowByKey("Admission_Applications", "ApplicationId", applicationId, {
      ConsolidatedPdfUrl: compiled.url,
      ConsolidatedPdfStatus: "Compiled",
    });
    appendRow("Admission_Documents", {
      DocId: Utilities.getUuid(),
      ApplicationId: applicationId,
      DocType: "Consolidated PDF",
      FileName: applicationId + "_Consolidated_Admission_Application.pdf",
      MimeType: "application/pdf",
      DriveFileId: compiled.id,
      DriveFileUrl: compiled.url,
      UploadedAt: new Date(),
    });

    return jsonResponse({ ok: true, data: { consolidatedPdfUrl: compiled.url } });
  } catch (err) {
    logError("admin/admission/recompile", err);
    return jsonResponse({ ok: false, error: "Recompile failed: " + err.message });
  }
}

/** Every file uploaded/generated for one application — individual documents, the screenshot, and the consolidated PDF. */
function listApplicationDocuments(e) {
  const auth = requireRole(e.parameter.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  const applicationId = e.parameter.applicationId;
  const rows = readSheet("Admission_Documents")
    .filter((r) => r.ApplicationId === applicationId)
    .map((r) => ({
      docType: r.DocType,
      fileName: r.FileName,
      mimeType: r.MimeType,
      driveFileUrl: r.DriveFileUrl,
      uploadedAt: r.UploadedAt,
    }));

  return jsonResponse({ ok: true, data: rows });
}
