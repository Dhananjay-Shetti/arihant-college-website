/**
 * Scroll-reveal for [data-reveal] elements + nav blur-on-scroll.
 * Pure IntersectionObserver, no dependencies.
 */
(function () {
  const nav = document.querySelector(".site-nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  // Re-scannable: call after injecting dynamic [data-reveal] content (e.g. after an Api.* call resolves).
  window.initReveal = function () {
    document.querySelectorAll("[data-reveal]:not(.is-visible)").forEach((el, i) => {
      if (el.dataset.revealBound) return;
      el.dataset.revealBound = "1";
      el.style.transitionDelay = (i % 4) * 80 + "ms";
      observer.observe(el);
    });
  };

  window.initReveal();
})();
