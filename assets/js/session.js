/**
 * Client-side session helper. Not a secure session mechanism on its own —
 * it just remembers the token the backend issued at login (see Auth.gs)
 * so dashboard pages can attach it to requests. Actual authorization is
 * enforced server-side on every call via requireRole(token, [...]).
 */
const Session = (() => {
  const KEY = "arihantSession";

  function get() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function set(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  /** Redirects to login.html if not logged in as one of `roles`. Returns the session if valid. */
  function require(roles) {
    const session = get();
    if (!session || roles.indexOf(session.role) === -1) {
      window.location.href = "login.html";
      return null;
    }
    return session;
  }

  async function logout() {
    const session = get();
    if (session) await Api.logout(session.token);
    clear();
    window.location.href = "login.html";
  }

  /**
   * Call with the result of any Api.* call made using the stored token.
   * If the backend rejected it as "Unauthorized" (token missing/expired/
   * invalidated — e.g. the Sessions row expired after 8h, or was cleared
   * by a demo data reset), the stale local session is dropped and the user
   * is sent back to login instead of the dashboard silently failing.
   * Returns true if it redirected (caller should stop rendering).
   */
  function handleAuthError(res) {
    if (!res.ok && res.error === "Unauthorized") {
      clear();
      window.location.href = "login.html?expired=1";
      return true;
    }
    return false;
  }

  return { get, set, clear, require, logout, handleAuthError };
})();
