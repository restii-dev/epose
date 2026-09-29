/**
 * Epose access gate — email login/signup + Google + no boot
 */
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("worker")) {
      var w = q.get("worker").replace(/\/$/, "");
      localStorage.setItem("veil_worker_url", w);
      localStorage.setItem("epose_worker_url", w);
    }
  } catch (e) {}

  var WORKER_URL = (
    localStorage.getItem("epose_worker_url") ||
    localStorage.getItem("veil_worker_url") ||
    "https://veil-access.retropixel404.workers.dev"
  ).replace(/\/$/, "");

  var SESSION_KEY = "veil_access_token";
  var SESSION_META = "veil_access_meta";
  var PENDING_EMAIL = "veil_pending_email";

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
  function setToken(token, user) {
    user = elevateIfAdmin(user || {});
    try {
      if (token) localStorage.setItem(SESSION_KEY, token);
      localStorage.setItem(SESSION_META, JSON.stringify({
        email: user.email || "",
        name: user.name || "",
        role: user.role || "",
        hasAccess: !!user.hasAccess,
        infinite: !!user.infinite,
        status: user.status || ""
      }));
      if (user.email) localStorage.setItem(PENDING_EMAIL, user.email);
    } catch (e) {}
  }
  function clearToken() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_META);
      localStorage.removeItem(PENDING_EMAIL);
    } catch (e) {}
  }

  function $(id) { return document.getElementById(id); }

  function setMsg(text, isErr) {
    var m = $("accessMsg");
    if (!m) return;
    m.textContent = text || "";
    m.className = "amsg" + (isErr ? " err" : "");
  }

  function injectSkipBootCss() {
    if ($("skip-boot-css")) return;
    var s = document.createElement("style");
    s.id = "skip-boot-css";
    s.textContent =
      "#veilBoot,#eposeBoot,.boot-card{display:none!important;visibility:hidden!important;pointer-events:none!important}" +
      "body.gate-lock #accessGate,body.booting #accessGate{display:flex!important;visibility:visible!important}" +
      "#googleSignInWrap{display:block}";
    (document.head || document.documentElement).appendChild(s);
  }

  function rebrandToEpose() {
    try {
      if (document.title === "Veil" || /veil/i.test(document.title)) document.title = "Epose";
      document.querySelectorAll(".boot-title, #gateAuthBox h1, #accessGate h1").forEach(function (el) {
        if (el && String(el.textContent).trim() === "Veil") el.textContent = "Epose";
      });
    } catch (e) {}
  }

  function killBoot() {
    injectSkipBootCss();
    rebrandToEpose();
    try {
      var boot = $("veilBoot") || $("eposeBoot");
      if (boot) { boot.classList.add("done"); boot.style.display = "none"; }
      document.body.classList.remove("booting");
    } catch (e) {}
  }

  function showPanel(name) {
    ["panelLogin", "panelSignup", "panelVerify", "panelPending"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var match =
        (name === "login" && id === "panelLogin") ||
        (name === "signup" && id === "panelSignup") ||
        (name === "verify" && id === "panelVerify") ||
        (name === "pending" && id === "panelPending");
      if (match) {
        el.classList.add("active");
        el.style.display = "";
      } else {
        el.classList.remove("active");
        el.style.display = "none";
      }
    });
    document.querySelectorAll(".gate-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-gate-tab") === name);
    });
    var wrap = $("googleSignInWrap");
    if (wrap) wrap.style.display = (name === "login" || name === "signup") ? "block" : "none";
    if (name === "login" || name === "signup") initGoogleButton();
  }

  function unlockApp() {
    killBoot();
    window.__VEIL_ACCESS_OK = true;
    window.__EPOSE_ACCESS_OK = true;
    try {
      document.body.classList.remove("gate-lock", "booting");
      var gate = $("accessGate");
      if (gate) gate.style.display = "none";
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: getMeta() }));
    } catch (e) {}
  }

  function showGate() {
    killBoot();
    window.__VEIL_ACCESS_OK = false;
    try {
      document.body.classList.add("gate-lock");
      var gate = $("accessGate");
      if (gate) gate.style.display = "flex";
    } catch (e) {}
  }

  function api(path, body) {
    return fetch(WORKER_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { res: res, data: data || {} };
      });
    }).catch(function () {
      return { res: { ok: false }, data: { error: "Could not reach server. Check your connection." } };
    });
  }

  function handleAuthResult(data, token) {
    data = data || {};
    var user = data.user || null;
    if (user) user = elevateIfAdmin(user);
    token = token || data.token || "";

    if (data.ok && user && user.hasAccess) {
      if (token) setToken(token, user);
      unlockApp();
      return;
    }
    if (data.reason === "banned") {
      setMsg(data.error || "You are banned from Epose", true);
      showPanel("login");
      return;
    }
    if (user && user.emailVerified === false) {
      showPanel("verify");
      setMsg("Check your email for a verification code", false);
      return;
    }
    if (user && (user.status === "pending" || !user.hasAccess)) {
      var pe = $("pendingEmail");
      if (pe) pe.textContent = user.email || "";
      showPanel("pending");
      setMsg("", false);
      return;
    }
    setMsg(data.error || "Sign-in failed", true);
    showPanel("login");
  }

  function doLogin() {
    var email = ($("loginEmail") || {}).value || "";
    var password = ($("loginPass") || {}).value || "";
    if (!email || !password) {
      setMsg("Enter email and password", true);
      return;
    }
    setMsg("Signing in…", false);
    api("/api/auth/login", { email: email, password: password }).then(function (r) {
      var data = r.data || {};
      if (data.token) setToken(data.token, data.user);
      handleAuthResult(data, data.token);
    });
  }

  function doSignup() {
    var email = ($("signupEmail") || {}).value || "";
    var password = ($("signupPass") || {}).value || "";
    if (!email || !password) {
      setMsg("Enter email and password", true);
      return;
    }
    if (password.length < 6) {
      setMsg("Password must be at least 6 characters", true);
      return;
    }
    setMsg("Creating account…", false);
    api("/api/auth/signup", { email: email, password: password }).then(function (r) {
      var data = r.data || {};
      if (data.token) setToken(data.token, data.user);
      if (data.ok || data.user) {
        handleAuthResult(data, data.token);
      } else {
        setMsg(data.error || "Sign up failed", true);
      }
    });
  }

  function doVerify() {
    var code = ($("verifyCode") || {}).value || "";
    if (!code) {
      var digits = document.querySelectorAll(".otp-digit");
      code = "";
      digits.forEach(function (d) { code += d.value || ""; });
    }
    if (code.length < 6) {
      setMsg("Enter the 6-digit code", true);
      return;
    }
    setMsg("Verifying…", false);
    api("/api/auth/verify", { code: code, email: localStorage.getItem(PENDING_EMAIL) || "" }).then(function (r) {
      var data = r.data || {};
      if (data.token) setToken(data.token, data.user);
      handleAuthResult(data, data.token);
    });
  }

  function onGoogleCredential(response) {
    if (!response || !response.credential) {
      setMsg("Google sign-in failed", true);
      return;
    }
    setMsg("Signing in with Google…", false);
    api("/api/auth/google", { credential: response.credential, origin: location.origin }).then(function (r) {
      var data = r.data || {};
      if (data.user) data.user = elevateIfAdmin(data.user);
      if (data.token) setToken(data.token, data.user);
      handleAuthResult(data, data.token);
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
          context: "signin",
          ux_mode: "popup"
        });
        googleInitialized = true;
      }
      var host = $("googleSignInBtn");
      var wrap = $("googleSignInWrap");
      if (!host || !wrap) return;
      host.innerHTML = "";
      google.accounts.id.renderButton(host, {
        type: "standard", theme: "outline", size: "large",
        shape: "rectangular", text: "continue_with", width: 320
      });
      wrap.style.display = "block";
      googleReady = true;
    } catch (e) {
      console.warn("[epose] Google init", e);
    }
  }

  function loadGoogleScript(clientId) {
    if (!clientId || clientId.indexOf("apps.googleusercontent.com") === -1) return;
    googleClientId = clientId.trim();
    if (window.google && google.accounts && google.accounts.id) {
      initGoogleButton();
      return;
    }
    if (googleScriptLoading) return;
    googleScriptLoading = true;
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = function () { googleScriptLoading = false; initGoogleButton(); };
    s.onerror = function () { googleScriptLoading = false; };
    document.head.appendChild(s);
  }

  function fetchAuthConfig() {
    fetch(WORKER_URL + "/api/auth/config", {
      headers: { Accept: "application/json" }
    }).then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.googleClientId) loadGoogleScript(data.googleClientId);
      }).catch(function () {});
  }

  function checkSession() {
    killBoot();
    var meta = getMeta();
    if (meta && meta.email && isAdminEmail(meta.email)) {
      setToken(getToken() || "admin-local", elevateIfAdmin(meta));
      unlockApp();
      return;
    }
    if (meta && meta.hasAccess) {
      unlockApp();
      return;
    }
    var token = getToken();
    if (token) {
      fetch(WORKER_URL + "/api/session/check", {
        headers: { authorization: "Bearer " + token, Accept: "application/json" }
      }).then(function (res) { return res.json().catch(function () { return {}; }); })
        .then(function (data) {
          if (data && data.user) data.user = elevateIfAdmin(data.user);
          if (data && data.ok && data.user && data.user.hasAccess) {
            setToken(token, data.user);
            unlockApp();
          } else {
            showGate();
            showPanel("login");
          }
        }).catch(function () {
          showGate();
          showPanel("login");
        });
      return;
    }
    showGate();
    showPanel("login");
  }

  function bindUI() {
    var loginBtn = $("loginBtn");
    var signupBtn = $("signupBtn");
    var verifyBtn = $("verifyBtn");
    var backBtn = $("backToLoginBtn");
    var pendingRefresh = $("pendingRefreshBtn");
    var pendingLogout = $("pendingLogoutBtn");

    if (loginBtn) loginBtn.onclick = doLogin;
    if (signupBtn) signupBtn.onclick = doSignup;
    if (verifyBtn) verifyBtn.onclick = doVerify;
    if (backBtn) backBtn.onclick = function () { showPanel("login"); };
    if (pendingRefresh) pendingRefresh.onclick = checkSession;
    if (pendingLogout) pendingLogout.onclick = function () {
      clearToken();
      showPanel("login");
      setMsg("", false);
    };

    document.querySelectorAll(".gate-tab").forEach(function (tab) {
      tab.onclick = function () {
        var name = tab.getAttribute("data-gate-tab");
        if (name) showPanel(name);
      };
    });

    var loginPass = $("loginPass");
    if (loginPass) loginPass.addEventListener("keydown", function (e) {
      if (e.key === "Enter") doLogin();
    });
    var signupPass = $("signupPass");
    if (signupPass) signupPass.addEventListener("keydown", function (e) {
      if (e.key === "Enter") doSignup();
    });

    document.querySelectorAll(".otp-digit").forEach(function (digit, i, all) {
      digit.addEventListener("input", function () {
        if (digit.value && all[i + 1]) all[i + 1].focus();
        var code = "";
        all.forEach(function (d) { code += d.value || ""; });
        var hidden = $("verifyCode");
        if (hidden) hidden.value = code;
      });
    });
  }

  window.EposeAccess = window.VeilAccess = {
    getToken: getToken,
    getMeta: getMeta,
    signOut: function () {
      clearToken();
      showGate();
      showPanel("login");
      setMsg("Signed out", false);
    }
  };

  killBoot();
  fetchAuthConfig();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      killBoot();
      bindUI();
      checkSession();
    });
  } else {
    bindUI();
    checkSession();
  }
})();
