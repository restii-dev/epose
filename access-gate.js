/**
 * Veil access gate — simple matte, no animations
 */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("worker")) {
      localStorage.setItem("veil_worker_url", q.get("worker").replace(/\/$/, ""));
    }
  } catch (e) {}

  var WORKER_URL = (
    localStorage.getItem("veil_worker_url") ||
    "https://veil-access.retropixel404.workers.dev"
  ).replace(/\/$/, "");

  var SESSION_KEY = "veil_access_token";
  var SESSION_META = "veil_access_meta";

  var gate = document.getElementById("accessGate");
  var appRoot = document.getElementById("browser") || document.getElementById("app");
  var keyInput = document.getElementById("accessKey");
  var keyBtn = document.getElementById("accessSubmit");
  var keyMsg = document.getElementById("accessMsg");
  var gateBox = gate && gate.querySelector(".box");

  var sessionMeta = null;
  try {
    sessionMeta = JSON.parse(localStorage.getItem(SESSION_META) || "null");
  } catch (e) {
    sessionMeta = null;
  }

  function setBodyLocked(locked) {
    document.body.classList.toggle("gate-lock", !!locked);
  }

  function ensureBlockedLayer() {
    var el = document.getElementById("accessBlocked");
    if (el) return el;
    el = document.createElement("div");
    el.id = "accessBlocked";
    el.innerHTML =
      '<div class="blocked-panel">' +
      "<h2>You are blocked from entering Veil</h2>" +
      '<p class="blocked-time" id="blockedTimeMsg"></p>' +
      "</div>";
    document.body.appendChild(el);
    return el;
  }

  function showBlack() {
    setBodyLocked(true);
    if (appRoot) appRoot.style.display = "none";
    var bl = document.getElementById("accessBlocked");
    if (bl) bl.style.display = "none";
    if (gate) {
      gate.style.display = "flex";
      gate.classList.add("checking");
      gate.classList.remove("is-blocked");
    }
    if (gateBox) gateBox.style.visibility = "hidden";
    if (keyMsg) keyMsg.textContent = "";
  }

  function flashMsg(msg, isErr) {
    if (!keyMsg) return;
    keyMsg.textContent = msg || "";
    keyMsg.style.color = isErr ? "#ff5c5c" : "#5dcc7a";
    clearTimeout(keyMsg._t);
    if (msg) {
      keyMsg._t = setTimeout(function () {
        keyMsg.textContent = "";
      }, 3500);
    }
  }

  function showGate(msg, isErr) {
    setBodyLocked(true);
    if (appRoot) appRoot.style.display = "none";
    var bl = document.getElementById("accessBlocked");
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
      keyMsg.style.color = isErr ? "#ff5c5c" : "#888888";
      if (isErr && msg) {
        clearTimeout(keyMsg._t);
        keyMsg._t = setTimeout(function () { keyMsg.textContent = ""; }, 3500);
      }
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
      gateBox.style.opacity = "0.2";
      gateBox.style.filter = "grayscale(1)";
    }
    if (keyInput) {
      keyInput.disabled = true;
      keyInput.value = "";
    }
    if (keyBtn) keyBtn.disabled = true;
    if (keyMsg) keyMsg.textContent = "";
    var layer = ensureBlockedLayer();
    layer.style.display = "flex";
    var tm = document.getElementById("blockedTimeMsg");
    if (tm) tm.textContent = message || "You are blocked from entering Veil.";
    window.__VEIL_ACCESS_OK = false;
  }

  function showApp() {
    setBodyLocked(false);
    if (gate) {
      gate.style.display = "none";
      gate.classList.remove("checking", "is-blocked");
    }
    var bl = document.getElementById("accessBlocked");
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
      document.querySelectorAll(".engine-frame, #browser iframe").forEach(function (el) {
        try { el.src = "about:blank"; } catch (e) {}
        try { el.remove(); } catch (e) {}
      });
    } catch (e) {}
    if (appRoot) appRoot.style.display = "none";
    if (blocked) showBlocked(msg);
    else showGate(msg || "Session ended. Enter a new key.", true);
  }

  function saveMeta(data) {
    sessionMeta = {
      expires: data.expires || null,
      infinite: !!data.infinite,
      timeLeft: data.timeLeft || null,
      key: data.key || null
    };
    try {
      localStorage.setItem(SESSION_META, JSON.stringify(sessionMeta));
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: sessionMeta }));
  }

  function checkSession() {
    var token = localStorage.getItem(SESSION_KEY) || "";
    if (!token) return Promise.resolve(false);
    return fetch(WORKER_URL + "/api/session/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token })
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.blocked) {
          forceUnloadToGate(data.error || "You are blocked from entering Veil.", true);
          return "blocked";
        }
        if (!data.ok) return false;
        saveMeta(data);
        return true;
      })
      .catch(function () { return false; });
  }

  function redeem() {
    var key = ((keyInput && keyInput.value) || "").trim();
    if (!key) {
      showGate("Enter a key", true);
      return;
    }
    if (keyBtn) keyBtn.disabled = true;
    fetch(WORKER_URL + "/api/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: key })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
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
      })
      .catch(function () {
        showGate("Could not reach access server", true);
      })
      .finally(function () {
        if (keyBtn) keyBtn.disabled = false;
      });
  }

  var watchTimer;
  function startWatch() {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(function () {
      checkSession().then(function (ok) {
        if (ok === true) return;
        if (ok === "blocked") return;
        forceUnloadToGate("Session ended. Enter a new key.", false);
      });
    }, 15000);
  }

  function boot() {
    showBlack();
    checkSession().then(function (ok) {
      if (ok === true) {
        showApp();
        startWatch();
        return;
      }
      if (ok === "blocked") return;
      showGate("Enter an access key to use Veil", false);
    });
  }

  if (keyBtn) keyBtn.addEventListener("click", redeem);
  if (keyInput) {
    keyInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") redeem();
    });
  }

  window.VeilAccess = {
    workerUrl: WORKER_URL,
    getMeta: function () { return sessionMeta; },
    logout: function () { forceUnloadToGate("Signed out.", false); }
  };

  boot();
})();
