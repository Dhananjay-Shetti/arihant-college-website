/**
 * Marks the nav link matching the current page with aria-current="page" so
 * screen reader users (and the .active CSS hook, if any page wants one) can
 * tell which section they're in — previously nothing indicated this at all.
 */
(function () {
  const links = document.getElementById("nav-links");
  if (!links) return;
  const current = window.location.pathname.split("/").pop() || "index.html";
  links.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href").split("/").pop();
    if (href === current) a.setAttribute("aria-current", "page");
  });
})();

/**
 * Mobile hamburger menu. Toggles the .nav-links drawer + backdrop, locks
 * body scroll while open, and closes on link click / backdrop click / Esc.
 */
(function () {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  const backdrop = document.getElementById("nav-backdrop");
  if (!toggle || !links) return;

  function setOpen(open) {
    links.classList.toggle("open", open);
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (backdrop) backdrop.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
  }

  toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
  if (backdrop) backdrop.addEventListener("click", () => setOpen(false));
  links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) setOpen(false);
  });
})();
