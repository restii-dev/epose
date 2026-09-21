/**
 * Veil access gate — must pass before browser engine loads.
 * Session token stored in localStorage (works cross-device until expiry / global sign-out).
 */
(function () {
  const WORKER_URL = (localStorage.getItem("veil_worker_url") || "").replace(/\/$/, "") || "https://YOUR-WORKER.workers.dev";
  const SESSION_KEY = "veil_access_token";

  const gate = document.getElementById("accessGate");
  const appRoot = document.getElementById("app");
  const keyInput = document.getElementById("accessKey");
  const keyBtn = document.getElementById("accessSubmit");
  const keyMsg = document.getElementById("accessMsg");

  function showGate(msg, isErr) {
    if (appRoot) appRoot.style.display = "none";
    if (gate) gate.style.display = "flex";
    if (keyMsg) {
      keyMsg.textContent = msg || "";
      keyMsg.style.color = isErr ? "#ff6b6b" : "#9aa";
    }
    // prevent engine scripts from mattering — app hidden
  }

  function showApp() {
    if (gate) gate.style.display = "none";
    if (appRoot) appRoot.style.display = "";
    window.__VEIL_ACCESS_OK = true;
    window.dispatchEvent(new Event("veil-access-ok"));
  }

  async function checkSession() {
    const token = localStorage.getItem(SESSION_KEY) || "";
    if (!token) return false;
    try {
      const res = await fetch(WORKER_URL + "/api/session/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.blocked) {
        localStorage.removeItem(SESSION_KEY);
        showGate(data.error || "Blocked", true);
        return "blocked";
      }
      if (!data.ok) {
        localStorage.removeItem(SESSION_KEY);
        return false;
      }
      return true;
    } catch (e) {
      console.warn("[veil-access]", e);
      // fail closed if worker unreachable after having a token? fail open for offline workers during setup:
      return false;
    }
  }

  async function redeem() {
    const key = (keyInput && keyInput.value || "").trim();
    if (!key) {
      showGate("Enter a key", true);
      return;
    }
    keyBtn.disabled = true;
    try {
      const res = await fetch(WORKER_URL + "/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (data.blocked) {
        showGate(data.error || "Blocked", true);
        return;
      }
      if (!data.ok || !data.token) {
        showGate(data.error || "Invalid key", true);
        return;
      }
      localStorage.setItem(SESSION_KEY, data.token);
      showApp();
      // re-check periodically
      startWatch();
    } catch (e) {
      showGate("Could not reach access server", true);
    } finally {
      keyBtn.disabled = false;
    }
  }

  let watchTimer;
  function startWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(async () => {
      const ok = await checkSession();
      if (ok === true) return;
      if (ok === "blocked") return;
      localStorage.removeItem(SESSION_KEY);
      showGate("Session ended. Enter a new key.", true);
      // hard stop engine
      try {
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          // do not unregister SW globally; just hide UI
        }
      } catch (_) {}
    }, 20000);
  }

  async function boot() {
    showGate("Checking access...", false);
    const ok = await checkSession();
    if (ok === true) {
      showApp();
      startWatch();
      return;
    }
    if (ok === "blocked") return;
    showGate("Enter an access key to use Veil", false);
  }

  if (keyBtn) keyBtn.addEventListener("click", redeem);
  if (keyInput) {
    keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") redeem();
    });
  }

  // optional worker override
  const q = new URLSearchParams(location.search);
  if (q.get("worker")) {
    localStorage.setItem("veil_worker_url", q.get("worker"));
  }

  window.VeilAccess = {
    workerUrl: WORKER_URL,
    logout() {
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    },
  };

  boot();
})();
