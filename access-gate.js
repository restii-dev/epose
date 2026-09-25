/**
 * Veil access gate — email accounts + pending approval
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
  var PENDING_EMAIL = "veil_pending_email";

  var gate = document.getElementById("accessGate");
  var appRoot = document.getElementById("browser") || document.getElementById("app");
  var keyMsg = document.getElementById("accessMsg");
  var gateBox = document.getElementById("gateAuthBox") || (gate && gate.querySelector(".box"));

  function readCookie(name) {
    try {
      var parts = document.cookie.split(";");
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p.indexOf(encodeURIComponent(name) + "=") === 0) {
          return decodeURIComponent(p.slice(encodeURIComponent(name).length + 1));
        }
      }
    } catch (e) {}
    return "";
  }

  function writeCookie(name, value, maxAgeSec) {
    try {
      var age = maxAgeSec == null ? 60 * 60 * 24 * 400 : maxAgeSec;
      document.cookie =
        encodeURIComponent(name) + "=" + encodeURIComponent(value || "") +
        "; path=/; max-age=" + age + "; SameSite=Lax";
    } catch (e) {}
  }

  function clearCookie(name) {
    try {
      document.cookie = encodeURIComponent(name) + "=; path=/; max-age=0; SameSite=Lax";
    } catch (e) {}
  }

  function getToken() {
    try {
      return localStorage.getItem(SESSION_KEY) || readCookie(SESSION_KEY) || "";
    } catch (e) {
      return readCookie(SESSION_KEY) || "";
    }
  }

  var livePollTimer = null;
  var lastUser = null;

  function stopLivePoll() {
    if (livePollTimer) {
      clearInterval(livePollTimer);
      livePollTimer = null;
    }
  }

  function setToken(token, user) {
    try {
      if (token) localStorage.setItem(SESSION_KEY, token);
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    if (!token) {
      clearCookie(SESSION_KEY);
      try { localStorage.removeItem(SESSION_META); } catch (e2) {}
      lastUser = null;
      stopLivePoll();
      return;
    }
    var maxAge = 60 * 60 * 24 * 400;
    if (user && !user.infinite && user.expires) {
      var left = Math.floor((Number(user.expires) - Date.now()) / 1000);
      if (left > 0) maxAge = left;
    }
    writeCookie(SESSION_KEY, token, maxAge);
    lastUser = user || null;
    try {
      localStorage.setItem(SESSION_META, JSON.stringify({
        email: user && user.email,
        expires: user && user.expires,
        infinite: user && user.infinite,
        status: user && user.status,
        remainingMs: user && user.remainingMs,
        remainingLabel: user && user.remainingLabel
      }));
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent("veil-session-meta", { detail: user }));
    } catch (e) {}
  }

  function clearToken() {
    setToken("", null);
    try { localStorage.removeItem(PENDING_EMAIL); } catch (e) {}
  }

  /** Ban / grant / expiry apply live without full page refresh */
  function startLivePoll() {
    stopLivePoll();
    livePollTimer = setInterval(function () {
      var token = getToken();
      if (!token) {
        stopLivePoll();
        return;
      }
      api("/api/session/check", { token: token }).then(function (r) {
        if (!r.data) return;
        if (r.data.ok && r.data.user) {
          setToken(token, r.data.user);
          return;
        }
        stopLivePoll();
        handleAuthResult(r.data, token);
        try {
          window.dispatchEvent(new CustomEvent("veil-access-revoked", { detail: r.data }));
        } catch (e) {}
      });
    }, 12000);
  }

  window.VeilAccess = {
    getToken: getToken,
    getMeta: function () {
      try {
        return lastUser || JSON.parse(localStorage.getItem(SESSION_META) || "null");
      } catch (e) {
        return null;
      }
    },
    getUser: function () {
      return lastUser;
    },
    checkNow: function () {
      return checkSession();
    },
  };

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

  var DEFAULT_MSG = "Sign in with your email to use Veil";

  function setMsg(msg, isErr, autoRestore) {
    if (!keyMsg) return;
    clearTimeout(keyMsg._t);
    keyMsg.textContent = msg || DEFAULT_MSG;
    keyMsg.style.color = isErr ? "#ff5c5c" : "#888888";
    if (autoRestore && isErr && msg) {
      keyMsg._t = setTimeout(function () {
        keyMsg.textContent = DEFAULT_MSG;
        keyMsg.style.color = "#888888";
      }, 4000);
    }
  }

  function showPanel(name) {
    document.querySelectorAll(".gate-panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel" + name.charAt(0).toUpperCase() + name.slice(1));
    });
    // panels: login, signup, verify, pending
    var map = { login: "panelLogin", signup: "panelSignup", verify: "panelVerify", pending: "panelPending" };
    document.querySelectorAll(".gate-panel").forEach(function (p) {
      p.classList.remove("active");
    });
    var el = document.getElementById(map[name] || "panelLogin");
    if (el) el.classList.add("active");
    document.querySelectorAll("[data-gate-tab]").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-gate-tab") === name);
    });
    var tabs = document.querySelector(".gate-tabs");
    if (tabs) tabs.style.display = name === "login" || name === "signup" ? "flex" : "none";
    var sub = document.getElementById("gateSub");
    if (sub) {
      if (name === "pending") sub.textContent = "";
      else if (name === "verify") sub.textContent = "Check your inbox for a code";
      else sub.textContent = "Sign in to continue";
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
    if (gateBox) gateBox.style.visibility = "visible";
    setMsg(msg || DEFAULT_MSG, !!isErr, !!isErr);
  }

  function showPending(user) {
    showGate("", false);
    showPanel("pending");
    var t = document.getElementById("pendingText");
    if (t) {
      var email = (user && user.email) || localStorage.getItem(PENDING_EMAIL) || "";
      t.textContent =
        (email ? email + " — " : "") +
        "Your account is pending. An admin must grant you access time before you can use Veil.";
    }
  }

  function showBlocked(msg) {
    setBodyLocked(true);
    if (appRoot) appRoot.style.display = "none";
    if (gate) {
      gate.style.display = "none";
    }
    var el = ensureBlockedLayer();
    el.style.display = "flex";
    var p = document.getElementById("blockedTimeMsg");
    if (p) p.textContent = msg || "Contact an admin if you think this is a mistake.";
  }

  function unlockApp() {
    setBodyLocked(false);
    if (gate) gate.style.display = "none";
    var bl = document.getElementById("accessBlocked");
    if (bl) bl.style.display = "none";
    if (appRoot) appRoot.style.display = "";
    startLivePoll();
    try {
      window.dispatchEvent(new CustomEvent("veil-access-ok"));
    } catch (e) {}
    try {
      if (typeof window.__veilStartApp === "function") window.__veilStartApp();
      else if (typeof window.bootVeilApp === "function") window.bootVeilApp();
    } catch (e) {
      console.error(e);
    }
  }

  function api(path, body) {
    return fetch(WORKER_URL + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (data) {
          return { res: res, data: data };
        });
      })
      .catch(function (err) {
        return {
          res: { ok: false, status: 0 },
          data: { ok: false, error: "Could not reach server" },
        };
      });
  }

  function handleAuthResult(data, tokenFromLogin) {
    var token = tokenFromLogin || data.token || getToken();
    var user = data.user;

    if (data.ok && user && user.hasAccess) {
      setToken(token, user);
      unlockApp();
      return;
    }

    if (data.reason === "banned" || (user && user.status === "banned")) {
      clearToken();
      showBlocked(data.error || "You are banned from Veil");
      return;
    }

    if (data.reason === "unverified" || (user && user.emailVerified === false)) {
      if (user && user.email) {
        try { localStorage.setItem(PENDING_EMAIL, user.email); } catch (e) {}
      }
      if (token) setToken(token, user);
      showGate(data.error || "Verify your email", true);
      showPanel("verify");
      return;
    }

    if (data.reason === "pending" || data.reason === "expired" || (user && user.status === "pending")) {
      if (token) setToken(token, user);
      if (user && user.email) {
        try { localStorage.setItem(PENDING_EMAIL, user.email); } catch (e) {}
      }
      showPending(user);
      if (data.reason === "expired") setMsg(data.error || "No time remaining", true, false);
      return;
    }

    if (!data.ok) {
      showGate(data.error || "Sign in failed", true);
      showPanel("login");
    }
  }

  function checkSession() {
    var token = getToken();
    if (!token) {
      showGate(DEFAULT_MSG, false);
      showPanel("login");
      return Promise.resolve();
    }
    showBlack();
    return api("/api/session/check", { token: token }).then(function (r) {
      if (r.data && r.data.ok) {
        setToken(token, r.data.user);
        unlockApp();
        return;
      }
      if (r.data && (r.data.reason === "pending" || r.data.reason === "expired" || r.data.reason === "unverified" || r.data.reason === "banned")) {
        handleAuthResult(r.data, token);
        return;
      }
      clearToken();
      showGate(DEFAULT_MSG, false);
      showPanel("login");
    });
  }

  // Tabs
  document.querySelectorAll("[data-gate-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      showPanel(btn.getAttribute("data-gate-tab"));
      setMsg(DEFAULT_MSG, false);
    });
  });

  var loginBtn = document.getElementById("loginBtn");
  var signupBtn = document.getElementById("signupBtn");
  var verifyBtn = document.getElementById("verifyBtn");
  var resendBtn = document.getElementById("resendVerifyBtn");
  var backBtn = document.getElementById("backToLoginBtn");
  var pendingRefresh = document.getElementById("pendingRefreshBtn");
  var pendingLogout = document.getElementById("pendingLogoutBtn");

  if (loginBtn) {
    loginBtn.onclick = function () {
      var email = (document.getElementById("loginEmail") || {}).value || "";
      var password = (document.getElementById("loginPass") || {}).value || "";
      setMsg("Signing in…", false);
      api("/api/auth/login", { email: email, password: password }).then(function (r) {
        if (r.data.token) setToken(r.data.token, r.data.user);
        handleAuthResult(r.data, r.data.token);
        if (!r.data.ok && !r.data.reason) setMsg(r.data.error || "Login failed", true, true);
      });
    };
  }

  if (signupBtn) {
    signupBtn.onclick = function () {
      var email = (document.getElementById("signupEmail") || {}).value || "";
      var password = (document.getElementById("signupPass") || {}).value || "";
      setMsg("Creating account…", false);
      api("/api/auth/signup", { email: email, password: password }).then(function (r) {
        if (!r.data.ok && !r.data.needsVerify) {
          setMsg(r.data.error || "Signup failed", true, true);
          return;
        }
        try { localStorage.setItem(PENDING_EMAIL, email.trim().toLowerCase()); } catch (e) {}
        showPanel("verify");
        if (r.data.emailSent) setMsg("Code sent — check your inbox (and spam)", false);
        else setMsg(r.data.error || "Account created, but email could not be sent", true, false);
      });
    };
  }

  if (verifyBtn) {
    verifyBtn.onclick = function () {
      var email =
        localStorage.getItem(PENDING_EMAIL) ||
        (document.getElementById("signupEmail") || {}).value ||
        (document.getElementById("loginEmail") || {}).value ||
        "";
      var code = (document.getElementById("verifyCode") || {}).value || "";
      setMsg("Verifying…", false);
      api("/api/auth/verify", { email: email, code: code }).then(function (r) {
        if (!r.data.ok) {
          setMsg(r.data.error || "Invalid code", true, true);
          return;
        }
        setMsg("Email verified. Log in to continue.", false);
        showPanel("login");
        var le = document.getElementById("loginEmail");
        if (le && email) le.value = email;
      });
    };
  }

  if (resendBtn) {
    resendBtn.onclick = function () {
      var email =
        localStorage.getItem(PENDING_EMAIL) ||
        (document.getElementById("signupEmail") || {}).value ||
        (document.getElementById("loginEmail") || {}).value ||
        "";
      setMsg("Sending…", false);
      api("/api/auth/resend-verify", { email: email }).then(function (r) {
        if (!r.data.ok) setMsg(r.data.error || "Could not resend", true, true);
        else setMsg("Code sent", false);
      });
    };
  }

  if (backBtn) {
    backBtn.onclick = function () {
      showPanel("login");
      setMsg(DEFAULT_MSG, false);
    };
  }

  if (pendingRefresh) {
    pendingRefresh.onclick = function () {
      setMsg("Checking…", false);
      checkSession();
    };
  }

  if (pendingLogout) {
    pendingLogout.onclick = function () {
      var token = getToken();
      if (token) api("/api/auth/logout", { token: token });
      clearToken();
      showGate(DEFAULT_MSG, false);
      showPanel("login");
    };
  }

  // Enter keys
  ["loginPass", "loginEmail"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && loginBtn) loginBtn.click();
    });
  });
  ["signupPass", "signupEmail"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && signupBtn) signupBtn.click();
    });
  });
  var vc = document.getElementById("verifyCode");
  if (vc) vc.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && verifyBtn) verifyBtn.click();
  });

  // ——— Google Sign-In ———
  var googleClientId = null;
  var googleReady = false;

  function onGoogleCredential(response) {
    if (!response || !response.credential) {
      setMsg("Google sign-in failed", true, true);
      return;
    }
    setMsg("Signing in with Google…", false);
    api("/api/auth/google", { credential: response.credential }).then(function (r) {
      if (r.data.token) setToken(r.data.token, r.data.user);
      handleAuthResult(r.data, r.data.token);
      if (!r.data.ok && !r.data.reason) {
        setMsg(r.data.error || "Google sign-in failed", true, true);
      }
    });
  }

  function initGoogleButton() {
    if (!googleClientId || googleReady) return;
    if (!window.google || !google.accounts || !google.accounts.id) return;
    try {
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: onGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      var host = document.getElementById("googleSignInBtn");
      var wrap = document.getElementById("googleSignInWrap");
      if (host && wrap) {
        host.innerHTML = "";
        var w = 320;
        try {
          if (gateBox && gateBox.clientWidth) w = Math.min(360, Math.max(240, gateBox.clientWidth - 56));
        } catch (e) {}
        google.accounts.id.renderButton(host, {
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          width: w,
        });
        wrap.style.display = "block";
        googleReady = true;
      }
    } catch (e) {
      console.warn("Google button init", e);
    }
  }

  function loadGoogleScript(clientId) {
    googleClientId = clientId;
    if (window.google && google.accounts) {
      initGoogleButton();
      return;
    }
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = function () {
      initGoogleButton();
    };
    document.head.appendChild(s);
  }

  function fetchAuthConfig() {
    return fetch(WORKER_URL + "/api/auth/config")
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (data) {
        if (data && data.googleClientId) loadGoogleScript(data.googleClientId);
      })
      .catch(function () {});
  }

  var _origShowPanel = showPanel;
  showPanel = function (name) {
    _origShowPanel(name);
    var wrap = document.getElementById("googleSignInWrap");
    if (wrap) {
      wrap.style.display =
        googleReady && (name === "login" || name === "signup") ? "block" : "none";
    }
  };

  // Boot
  showBlack();
  fetchAuthConfig();
  checkSession();
})();
