/**
 * WhatsApp click-to-chat helper.
 * Uses CONFIG.WHATSAPP_NUMBER (placeholder until the real business number is supplied).
 * No API/business account needed — plain wa.me deep link.
 */
function buildWhatsAppLink(message) {
  const phone = CONFIG.WHATSAPP_NUMBER;
  const text = message || `Hi ${CONFIG.COLLEGE_NAME}, I'd like to know more about admissions.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function openWhatsApp(message) {
  window.open(buildWhatsAppLink(message), "_blank", "noopener");
}

function injectWhatsAppFab() {
  const fab = document.createElement("a");
  fab.className = "wa-fab";
  fab.href = buildWhatsAppLink();
  fab.target = "_blank";
  fab.rel = "noopener";
  fab.setAttribute("aria-label", "Chat with us on WhatsApp");
  fab.innerHTML = "&#9990;";
  document.body.appendChild(fab);
}

document.addEventListener("DOMContentLoaded", injectWhatsAppFab);
