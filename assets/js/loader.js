/**
 * Loading-spinner helpers used while fetching from the Sheet backend.
 * - Loader.row(label): inline spinner + label HTML, for swapping into a
 *   content area's innerHTML while its data loads (e.g. a card that shows
 *   "Loading…").
 * - Loader.hide(el): a static full-page overlay (already in the page's
 *   markup, id="page-loader") gets faded out once the page's initial data
 *   fetch resolves. Used by pages whose entire content depends on one fetch
 *   (dashboards) rather than a single content area.
 */
const Loader = (() => {
  function row(label) {
    return `<div class="loading-row"><span class="spinner"></span>${label ? `<span>${label}</span>` : ""}</div>`;
  }

  function hide() {
    const el = document.getElementById("page-loader");
    if (el) el.classList.add("hidden");
  }

  return { row, hide };
})();
