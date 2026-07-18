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
