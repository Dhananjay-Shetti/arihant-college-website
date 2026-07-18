/**
 * PhonePe Standard Checkout integration.
 *
 * NOT LIVE YET. Requires these Script Properties before this will work:
 *   PHONEPE_MID            - {{PHONEPE_MID}}
 *   PHONEPE_SALT_KEY       - {{PHONEPE_SALT_KEY}}
 *   PHONEPE_SALT_INDEX     - {{PHONEPE_SALT_INDEX}}
 *   PHONEPE_ENV            - "UAT" or "PROD"
 *   PHONEPE_REDIRECT_URL   - frontend page to land on after payment (e.g. fee-status.html)
 *   PHONEPE_CALLBACK_URL   - this Web App's /exec URL + "?path=payments/phonepe/callback"
 *
 * Until those are set, calling initiatePhonePePayment will fail fast with a
 * clear error rather than silently hitting a placeholder endpoint.
 */

function phonePeHost() {
  const env = PropertiesService.getScriptProperties().getProperty("PHONEPE_ENV");
  return env === "PROD"
    ? "https://api.phonepe.com/apis/hermes"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";
}

function assertPhonePeConfigured() {
  const props = PropertiesService.getScriptProperties();
  const required = ["PHONEPE_MID", "PHONEPE_SALT_KEY", "PHONEPE_SALT_INDEX", "PHONEPE_REDIRECT_URL", "PHONEPE_CALLBACK_URL"];
  const missing = required.filter((k) => !props.getProperty(k) || props.getProperty(k).indexOf("{{") === 0);
  if (missing.length) {
    throw new Error("PhonePe not configured. Missing Script Properties: " + missing.join(", "));
  }
}

function initiatePhonePePayment(e) {
  const body = JSON.parse(e.postData.contents);
  if (!requireApiKey(body)) return jsonResponse({ ok: false, error: "Unauthorized" });

  try {
    assertPhonePeConfigured();
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }

  const fee = findRowByKey("Fee_Structures", "FeeId", body.feeId);
  if (!fee) return jsonResponse({ ok: false, error: "Invalid fee plan" });
  if (!/^[6-9]\d{9}$/.test(body.studentPhone || "")) return jsonResponse({ ok: false, error: "Invalid phone" });

  const props = PropertiesService.getScriptProperties();
  const orderId = "AC-" + Date.now() + "-" + Math.floor(Math.random() * 10000);

  appendRow("Payments_Log", {
    OrderId: orderId,
    PhonePeTransactionId: "",
    StudentName: body.studentName,
    StudentPhone: body.studentPhone,
    StudentEmail: body.studentEmail || "",
    CourseId: body.courseId,
    FeeId: body.feeId,
    Amount: fee.Amount,
    Status: "INITIATED",
    CreatedAt: new Date(),
    UpdatedAt: new Date(),
    RawCallbackPayload: "",
  });

  const payload = {
    merchantId: props.getProperty("PHONEPE_MID"),
    merchantTransactionId: orderId,
    merchantUserId: "MU-" + body.studentPhone,
    amount: fee.Amount * 100, // paise
    redirectUrl: props.getProperty("PHONEPE_REDIRECT_URL") + "?orderId=" + orderId,
    redirectMode: "REDIRECT",
    callbackUrl: props.getProperty("PHONEPE_CALLBACK_URL"),
    mobileNumber: body.studentPhone,
    paymentInstrument: { type: "PAY_PAGE" },
  };

  const base64Payload = Utilities.base64Encode(JSON.stringify(payload));
  const saltKey = props.getProperty("PHONEPE_SALT_KEY");
  const saltIndex = props.getProperty("PHONEPE_SALT_INDEX");
  const checksum =
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, base64Payload + "/pg/v1/pay" + saltKey)
      .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
      .join("") + "###" + saltIndex;

  const resp = UrlFetchApp.fetch(phonePeHost() + "/pg/v1/pay", {
    method: "post",
    contentType: "application/json",
    headers: { "X-VERIFY": checksum, accept: "application/json" },
    payload: JSON.stringify({ request: base64Payload }),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(resp.getContentText());
  if (!result.success) {
    updateRowByKey("Payments_Log", "OrderId", orderId, { Status: "FAILED", UpdatedAt: new Date() });
    return jsonResponse({ ok: false, error: "PhonePe initiation failed" });
  }

  return jsonResponse({ ok: true, data: { orderId, redirectUrl: result.data.instrumentResponse.redirectInfo.url } });
}

function handlePhonePeCallback(e) {
  try {
    assertPhonePeConfigured();
  } catch (err) {
    logError("phonepe/callback", err);
    return jsonResponse({ ok: false, error: err.message });
  }

  const body = JSON.parse(e.postData.contents);
  const decoded = JSON.parse(Utilities.newBlob(Utilities.base64Decode(body.response)).getDataAsString());
  const orderId = decoded.data.merchantTransactionId;
  const status = decoded.data.state === "COMPLETED" ? "SUCCESS" : "FAILED";

  const row = findRowByKey("Payments_Log", "OrderId", orderId);
  if (!row) {
    logError("phonepe/callback", "Unknown orderId: " + orderId);
    return jsonResponse({ ok: false });
  }
  if (row.Status === "SUCCESS") return jsonResponse({ ok: true }); // idempotent no-op

  updateRowByKey("Payments_Log", "OrderId", orderId, {
    Status: status,
    PhonePeTransactionId: decoded.data.transactionId,
    UpdatedAt: new Date(),
    RawCallbackPayload: JSON.stringify(decoded),
  });

  return jsonResponse({ ok: true });
}
