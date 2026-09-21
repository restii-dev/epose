/**
 * Veil access gate — black boot, key entry, blocked lockout
 */
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("worker")) {
      localStorage.setItem("veil_worker_url", q.get("worker").replace(/\/$/, ""));
    }
  } catch (_) {}

  const WORKER_URL = (
    localStorage.getItem("veil_worker_url") ||
    "https://veil-access.retropixel404.workers.dev"
  ).replace(/\/$/, "");

  const SESSION_KEY = "veil_access_token";
  const SESSION_META = "veil_access_meta";

  const gate = document.getElementById("accessGate");
  const appRoot = document.getElementById("browser") || document.getElementById("app");
  const keyInput = document.getElementById("accessKey");
  const keyBtn = document.getElementById("accessSubmit");
  const keyMsg = document.getElementById("accessMsg");
  const gateBox = gate && gate.querySelector(".box");

  let sessionMeta = null;
  try {
    sessionMeta = JSON.parse(localStorage.getItem(SESSION_META) || "null");
  } catch (_) {
    sessionMeta = null;
  }

  function setBodyLocked(locked) {
    document.body.classList.toggle("gate-lock", !!locked);
  }

  function ensureBlockedLayer() {
    let el = document.getElementById("accessBlocked");
    if (el) return el;
    el = document.createElement("div");
    el.id = "accessBlocked";
    el.innerHTML =
      '<div class="blocked-panel">' +
      '<div class="blocked-badge">ACCESS DENIED</div>' +
      '<h2>You are blocked from entering Veil</h2>' +
      '<p class="blocked-time" id="blockedTimeMsg"></p>' +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function showBlack() {
    setBodyLocked(true);
    if (appRoot) appRoot.style.display = "none";
    const bl = document.getElementById("accessBlocked");
    if (bl) bl.style.display = "none";
    if (gate) {
      gate.style.display = "flex";
      gate.classList.add("checking");
      gate.classList.remove("is-blocked");
    }
    if (gateBox) gateBox.style.visibility = "hidden";
    if (keyMsg) keyMsg.textContent = "";
  }

  function showGate(msg, isErr) {
    setBodyLocked(true);
    if (appRoot) appRoot.style.display = "none";
    const bl = document.getElementById("accessBlocked");
    if (bl) bl.style.display = "none";
    if (gate) {
      gate.style.display = "flex";
      gate.classList.remove("checking", "is-blocked");
    }
    if (gateBox) {
      gateBox.style.visibility = "visible";
      gateBox.style.pointerEvents = "";
      gateBox.style.opacity = "";
      gateBox.style.filter = "";
    }
    if (keyInput) keyInput.disabled = false;
    if (keyBtn) keyBtn.disabled = false;
    if (keyMsg) {
      keyMsg.textContent = msg || "";
      keyMsg.style.color = isErr ? "#ff6b6b" : "#9aa";
    }
    window.__VEIL_ACCESS_OK = false;
  }

  function showBlocked(message) {
    setBodyLocked(true);
    if (appRoot) appRoot.style.display = "none";
    if (gate) {
      gate.style.display = "flex";
      gate.classList.remove("checking");
      gate.classList.add("is-blocked");
    }
    if (gateBox) {
      gateBox.style.visibility = "visible";
      gateBox.style.pointerEvents = "none";
      gateBox.style.opacity = "0.22";
      gateBox.style.filter = "grayscale(1)";
    }
    if (keyInput) {
      keyInput.disabled = true;
      keyInput.value = "";
    }
    if (keyBtn) keyBtn.disabled = true;
    if (keyMsg) keyMsg.textContent = "";

    const layer = ensureBlockedLayer();
    layer.style.display = "flex";
    const tm = document.getElementById("blockedTimeMsg");
    if (tm) tm.textContent = message || "You are blocked from entering Veil.";
    window.__VEIL_ACCESS_OK = false;
  }

  function showApp() {
    setBodyLocked(false);
    if (gate) {
      gate.style.display = "none";
      gate.classList.remove("checking", "is-blocked");
    }
    const bl = document.getElementById("accessBlocked");
    if (bl) bl.style.display = "none";
    if (appRoot) appRoot.style.display = "";
    window.__VEIL_ACCESS_OK = true;
    window.dispatchEvent(new Event("veil-access-ok"));
    window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: sessionMeta }));
  }

  function forceUnloadToGate(msg, blocked) {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_META);
    sessionMeta = null;
    window.__VEIL_ACCESS_OK = false;
    try {
      document.querySelectorAll(".engine-frame, #browser iframe").forEach((el) => {
        try { el.src = "about:blank"; } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}
    if (appRoot) appRoot.style.display = "none";
    if (blocked) showBlocked(msg);
    else showGate(msg || "Session ended. Enter a new key.", true);
  }

  function saveMeta(data) {
    sessionMeta = {
      expires: data.expires || null,
      infinite: !!data.infinite,
      timeLeft: data.timeLeft || null,
      key: data.key || null,
    };
    try {
      localStorage.setItem(SESSION_META, JSON.stringify(sessionMeta));
    } catch (_) {}
    window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: sessionMeta }));
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
        forceUnloadToGate(data.error || "You are blocked from entering Veil.", true);
        return "blocked";
      }
      if (!data.ok) return false;
      saveMeta(data);
      return true;
    } catch (e) {
      console.warn("[veil-access] check", e);
      return false;
    }
  }

  async function redeem() {
    const key = ((keyInput && keyInput.value) || "").trim();
    if (!key) {
      showGate("Enter a key", true);
      return;
    }
    if (keyBtn) keyBtn.disabled = true;
    try {
      const res = await fetch(WORKER_URL + "/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.blocked) {
        showBlocked(data.error || "You are blocked from entering Veil.");
        return;
      }
      if (!data.ok || !data.token) {
        showGate(data.error || "Invalid key", true);
        return;
      }
      localStorage.setItem(SESSION_KEY, data.token);
      saveMeta(data);
      if (keyInput) keyInput.value = "";
      showApp();
      startWatch();
    } catch (e) {
      console.warn("[veil-access] redeem", e);
      showGate("Could not reach access server", true);
    } finally {
      if (keyBtn) keyBtn.disabled = false;
    }
  }

  let watchTimer;
  function startWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(async () => {
      const ok = await checkSession();
      if (ok === true) return;
      if (ok === "blocked") return;
      forceUnloadToGate("Session ended. Enter a new key.", false);
    }, 15000);
  }

  async function boot() {
    showBlack();
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

  window.VeilAccess = {
    workerUrl: WORKER_URL,
    getMeta() { return sessionMeta; },
    logout() { forceUnloadToGate("Signed out.", false); },
  };

  boot();
})();
