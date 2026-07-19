/**
 * Admin-only: upload a site media asset (images/video for the public
 * pages, not admission documents — those live under Admissions.gs) into a
 * specific Google Drive folder. Files travel as base64 in the JSON POST
 * body, same pattern as admission document uploads (Apps Script's doPost
 * has no multipart/form-data support).
 *
 * The uploaded file's sharing is set to "Anyone with the link can view" —
 * required for it to be fetchable by anonymous site visitors at all, since
 * the site itself has no Google identity to authenticate a private file
 * with. Only use this for content that's fine being publicly link-
 * accessible (marketing media), never for admission documents or anything
 * containing personal data.
 */

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25MB — generous for a short background-video clip

function uploadMediaFile(e) {
  const body = JSON.parse(e.postData.contents);
  const auth = requireRole(body.token, ["admin"]);
  if (!auth) return jsonResponse({ ok: false, error: "Unauthorized" });

  if (!body.folderId) return jsonResponse({ ok: false, error: "folderId is required" });
  if (!body.fileName || !body.mimeType || !body.base64Data) return jsonResponse({ ok: false, error: "fileName, mimeType, and base64Data are required" });

  const approxBytes = body.base64Data.length * 0.75;
  if (approxBytes > MAX_MEDIA_BYTES) return jsonResponse({ ok: false, error: "File exceeds the 25MB limit" });

  try {
    const folder = DriveApp.getFolderById(body.folderId);
    const blob = Utilities.newBlob(Utilities.base64Decode(body.base64Data), body.mimeType, body.fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return jsonResponse({
      ok: true,
      data: { fileId: file.getId(), fileUrl: file.getUrl(), fileName: file.getName(), size: file.getSize() },
    });
  } catch (err) {
    logError("admin/media/upload", err);
    return jsonResponse({ ok: false, error: "Upload failed: " + err.message });
  }
}
