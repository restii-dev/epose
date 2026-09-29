/**
 * Epose access gate — admin email + local keys
 */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("worker")) {
      localStorage.setItem("veil_worker_url", q.get("worker").replace(/\/$/, ""));
      localStorage.setItem("epose_worker_url", q.get("worker").replace(/\/$/, ""));
    }
  } catch (e) {}

  var WORKER_URL = (
    localStorage.getItem("epose_worker_url") ||
    localStorage.getItem("veil_worker_url") ||
    ""
  ).replace(/\/$/, "");

  var SESSION_KEY = "veil_access_token";
  var SESSION_META = "veil_access_meta";

  var ADMIN_EMAILS = [
    "nicholaspitner30@walkerschools.org"
  ];

  function isAdminEmail(email) {
    if (!email) return false;
    var e = String(email).trim().toLowerCase();
    for (var i = 0; i < ADMIN_EMAILS.length; i++) {
      if (String(ADMIN_EMAILS[i]).trim().toLowerCase() === e) return true;
    }
    return false;
  }

  function elevateIfAdmin(user) {
    if (!user) return user;
    var email = user.email || user.mail || "";
    if (!isAdminEmail(email)) return user;
    var u = {};
    for (var k in user) if (Object.prototype.hasOwnProperty.call(user, k)) u[k] = user[k];
    u.hasAccess = true;
    u.infinite = true;
    u.status = "allowed";
    u.role = "admin";
    u.name = u.name || "Administrator";
    u.expires = null;
    return u;
  }

  function getToken() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; }
  }
  function getMeta() {
    try { return JSON.parse(localStorage.getItem(SESSION_META) || "null"); } catch (e) { return null; }
  }
  function setSession(token, user) {
    user = elevateIfAdmin(user || {});
    try {
      if (token) localStorage.setItem(SESSION_KEY, token);
      localStorage.setItem(SESSION_META, JSON.stringify({
        email: user.email || "",
        name: user.name || "",
        role: user.role || "",
        hasAccess: !!user.hasAccess,
        infinite: !!user.infinite
      }));
    } catch (e) {}
  }
  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_META);
    } catch (e) {}
  }

  function hideGoogle() {
    try {
      var gw = document.getElementById("googleSignInWrap");
      if (gw) { gw.style.display = "none"; gw.innerHTML = ""; }
    } catch (e) {}
  }

  function unlockApp() {
    window.__VEIL_ACCESS_OK = true;
    window.__EPOSE_ACCESS_OK = true;
    try {
      document.body.classList.remove("gate-lock", "booting");
      var gate = document.getElementById("accessGate");
      if (gate) gate.style.display = "none";
      var boot = document.getElementById("veilBoot") || document.getElementById("eposeBoot");
      if (boot) { boot.classList.add("done"); boot.style.display = "none"; }
      var app = document.getElementById("appRoot") || document.getElementById("veilApp") || document.body;
      if (app) app.style.display = "";
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: getMeta() }));
    } catch (e) {}
  }

  function showGate(msg) {
    window.__VEIL_ACCESS_OK = false;
    try {
      document.body.classList.add("gate-lock");
      var gate = document.getElementById("accessGate");
      if (gate) gate.style.display = "";
      var m = document.getElementById("gateMsg") || document.querySelector("#accessGate .msg");
      if (m && msg) m.textContent = msg;
    } catch (e) {}
  }

  function redeemKey(code) {
    code = (code || "").trim();
    if (!code) return;
    if (window.EposeKeys && typeof window.EposeKeys.redeem === "function") {
      var r = window.EposeKeys.redeem(code);
      if (r && r.ok) {
        setSession(r.token || ("local-" + code), {
          name: r.name || "User",
          role: r.role || "user",
          hasAccess: true,
          infinite: !!r.infinite,
          email: r.email || ""
        });
        unlockApp();
        return;
      }
    }
    var masters = {
      "1212": { name: "Nick", role: "user", infinite: true },
      "1414": { name: "Administrator", role: "admin", infinite: true },
      "45ad": { name: "Nick", role: "user", infinite: true },
      "24bc": { name: "Administrator", role: "admin", infinite: true }
    };
    var m = masters[code.toLowerCase()] || masters[code];
    if (m) {
      setSession("master-" + code, {
        name: m.name,
        role: m.role,
        hasAccess: true,
        infinite: true,
        email: m.role === "admin" ? "pitnernicholas30@walkerschools.org" : ""
      });
      unlockApp();
      return;
    }
    if (WORKER_URL) {
      fetch(WORKER_URL + "/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: code })
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.ok && data.token) {
          var user = elevateIfAdmin(data.user || { hasAccess: true, name: "User" });
          setSession(data.token, user);
          unlockApp();
        } else {
          showGate((data && data.error) || "Invalid key");
        }
      }).catch(function () { showGate("Could not reach server"); });
      return;
    }
    showGate("Invalid key");
  }

  function checkSession() {
    hideGoogle();
    var meta = getMeta();
    if (meta && meta.email && isAdminEmail(meta.email)) {
      meta = elevateIfAdmin(meta);
      setSession(getToken() || "admin-local", meta);
      unlockApp();
      return;
    }
    if (meta && meta.hasAccess) {
      unlockApp();
      return;
    }
    if (getToken()) {
      if (WORKER_URL) {
        fetch(WORKER_URL + "/api/session/check", {
          headers: { authorization: "Bearer " + getToken() }
        }).then(function (res) { return res.json(); }).then(function (data) {
          if (data && data.user) data.user = elevateIfAdmin(data.user);
          if (data && data.ok && data.user && data.user.hasAccess) {
            setSession(getToken(), data.user);
            unlockApp();
          } else {
            showGate("Sign in or enter a key to use Epose");
          }
        }).catch(function () {
          showGate("Sign in or enter a key to use Epose");
        });
        return;
      }
    }
    showGate("Sign in or enter a key to use Epose");
  }

  window.EposeAccess = window.VeilAccess = {
    getToken: getToken,
    getMeta: getMeta,
    signOut: function () {
      clearSession();
      showGate("Signed out");
    },
    redeemKey: redeemKey,
    isAdminEmail: isAdminEmail
  };

  function bindKeyUI() {
    var btn = document.getElementById("redeemBtn") || document.getElementById("keySubmit");
    var input = document.getElementById("accessKey") || document.getElementById("keyInput") || document.getElementById("redeemKey");
    if (btn) btn.addEventListener("click", function () {
      redeemKey(input ? input.value : "");
    });
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") redeemKey(input.value);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindKeyUI();
      checkSession();
    });
  } else {
    bindKeyUI();
    checkSession();
  }
})();
