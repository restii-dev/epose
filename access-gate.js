/**
 * Epose access gate — Google Sign-In + admin emails + keys (no boot screen)
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
    "pitnernicholas30@walkerschools.org",
    "nicholaspitner30@walkerschools.org"
  ];

  var googleClientId = null;
  var googleReady = false;
  var googleInitialized = false;
  var googleScriptLoading = false;

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
    try {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.disableAutoSelect();
        try { google.accounts.id.cancel(); } catch (e2) {}
      }
    } catch (e) {}
  }

  function injectSkipBootCss() {
    if (document.getElementById("skip-boot-css")) return;
    var s = document.createElement("style");
    s.id = "skip-boot-css";
    s.textContent = [
      "#veilBoot,#eposeBoot{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;z-index:-1!important}",
      "body.gate-lock #accessGate{display:flex!important}",
      "body.booting #accessGate{visibility:visible!important;display:flex!important}",
      "#googleSignInWrap{display:block}",
      ".google-btn-host{display:flex;justify-content:center;min-height:40px}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  function killBoot() {
    injectSkipBootCss();
    try {
      var boot = document.getElementById("veilBoot") || document.getElementById("eposeBoot");
      if (boot) {
        boot.classList.add("done");
        boot.style.display = "none";
        boot.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("booting");
    } catch (e) {}
  }

  function setGateMsg(msg, isErr) {
    try {
      var m = document.getElementById("gateMsg") || document.querySelector("#accessGate .msg");
      if (m) {
        m.textContent = msg || "";
        m.className = "msg" + (isErr ? " err" : "");
      }
    } catch (e) {}
  }

  function unlockApp() {
    killBoot();
    window.__VEIL_ACCESS_OK = true;
    window.__EPOSE_ACCESS_OK = true;
    try {
      document.body.classList.remove("gate-lock", "booting");
      var gate = document.getElementById("accessGate");
      if (gate) gate.style.display = "none";
      var app = document.getElementById("appRoot") || document.getElementById("veilApp") || document.body;
      if (app) app.style.display = "";
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: getMeta() }));
    } catch (e) {}
  }

  function showGate(msg) {
    killBoot();
    window.__VEIL_ACCESS_OK = false;
    try {
      document.body.classList.add("gate-lock");
      document.body.classList.remove("booting");
      var gate = document.getElementById("accessGate");
      if (gate) gate.style.display = "flex";
      if (msg) setGateMsg(msg, false);
      var login = document.getElementById("panelLogin");
      if (login) {
        login.classList.add("active");
        login.style.display = "";
      }
      var wrap = document.getElementById("googleSignInWrap");
      if (wrap) wrap.style.display = "block";
      initGoogleButton();
    } catch (e) {}
  }

  function onGoogleCredential(response) {
    if (!response || !response.credential) {
      setGateMsg("Google sign-in was cancelled or failed", true);
      return;
    }
    setGateMsg("Signing in with Google…", false);
    var url = WORKER_URL ? WORKER_URL + "/api/auth/google" : "";
    if (!url) {
      try {
        var parts = response.credential.split(".");
        var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        var email = payload.email || "";
        var name = payload.name || payload.given_name || "User";
        if (isAdminEmail(email)) {
          setSession("google-local-" + email, {
            email: email,
            name: name,
            hasAccess: true,
            infinite: true,
            role: "admin"
          });
          unlockApp();
          return;
        }
        setSession("google-local-" + email, {
          email: email,
          name: name,
          hasAccess: true,
          infinite: false,
          role: "user"
        });
        unlockApp();
        return;
      } catch (e) {
        setGateMsg("Google sign-in needs the access server configured", true);
        return;
      }
    }
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ credential: response.credential, origin: location.origin })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        data = data || {};
        if (data.user) data.user = elevateIfAdmin(data.user);
        if (data.token) setSession(data.token, data.user || { hasAccess: true });
        if (data.ok && data.user && data.user.hasAccess) {
          unlockApp();
          return;
        }
        if (data.user && isAdminEmail(data.user.email)) {
          setSession(data.token || "admin-google", elevateIfAdmin(data.user));
          unlockApp();
          return;
        }
        if (data.user || data.reason) {
          if (data.reason === "banned") {
            setGateMsg(data.error || "You are banned from Epose", true);
            return;
          }
          if (data.user && data.user.hasAccess) {
            unlockApp();
            return;
          }
          setGateMsg(data.error || "Waiting for admin approval", false);
          return;
        }
        setGateMsg(data.error || "Google sign-in failed", true);
      })
      .catch(function () {
        setGateMsg("Could not reach sign-in server", true);
      });
  }

  function initGoogleButton() {
    if (!googleClientId) return;
    if (!window.google || !google.accounts || !google.accounts.id) return;
    try {
      if (!googleInitialized) {
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: onGoogleCredential,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
          itp_support: true,
          context: "signin",
          ux_mode: "popup"
        });
        googleInitialized = true;
      }
      var host = document.getElementById("googleSignInBtn");
      var wrap = document.getElementById("googleSignInWrap");
      if (!host || !wrap) return;
      host.innerHTML = "";
      var w = 320;
      try {
        var box = document.getElementById("gateAuthBox") || document.querySelector("#accessGate .box");
        if (box && box.clientWidth) w = Math.min(400, Math.max(250, Math.floor(box.clientWidth - 56)));
      } catch (e) {}
      google.accounts.id.renderButton(host, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "rectangular",
        text: "continue_with",
        logo_alignment: "left",
        width: w
      });
      wrap.style.display = "block";
      googleReady = true;
    } catch (e) {
      console.warn("[epose] Google button init", e);
    }
  }

  function loadGoogleScript(clientId) {
    if (!clientId || typeof clientId !== "string") return;
    if (clientId.indexOf("apps.googleusercontent.com") === -1) {
      console.warn("[epose] Invalid Google client ID");
      return;
    }
    googleClientId = clientId.trim();
    if (window.google && google.accounts && google.accounts.id) {
      initGoogleButton();
      return;
    }
    if (googleScriptLoading) return;
    googleScriptLoading = true;
    if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
      var tries = 0;
      var wait = setInterval(function () {
        tries++;
        if (window.google && google.accounts && google.accounts.id) {
          clearInterval(wait);
          initGoogleButton();
        } else if (tries > 50) {
          clearInterval(wait);
          googleScriptLoading = false;
        }
      }, 100);
      return;
    }
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = function () {
      googleScriptLoading = false;
      initGoogleButton();
    };
    s.onerror = function () {
      googleScriptLoading = false;
      console.warn("[epose] Failed to load Google Identity Services");
    };
    document.head.appendChild(s);
  }

  function fetchAuthConfig() {
    if (!WORKER_URL) return;
    fetch(WORKER_URL + "/api/auth/config", {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" }
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.googleClientId) loadGoogleScript(data.googleClientId);
      })
      .catch(function () {});
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
          setGateMsg((data && data.error) || "Invalid key", true);
        }
      }).catch(function () { setGateMsg("Could not reach server", true); });
      return;
    }
    setGateMsg("Invalid key", true);
  }

  function checkSession() {
    killBoot();
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
    if (getToken() && WORKER_URL) {
      fetch(WORKER_URL + "/api/session/check", {
        headers: { authorization: "Bearer " + getToken() }
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.user) data.user = elevateIfAdmin(data.user);
        if (data && data.ok && data.user && data.user.hasAccess) {
          setSession(getToken(), data.user);
          unlockApp();
        } else {
          showGate("Sign in with Google or enter a key");
        }
      }).catch(function () {
        showGate("Sign in with Google or enter a key");
      });
      return;
    }
    showGate("Sign in with Google or enter a key");
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

  killBoot();
  fetchAuthConfig();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      killBoot();
      bindKeyUI();
      checkSession();
    });
  } else {
    bindKeyUI();
    checkSession();
  }
})();
