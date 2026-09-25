(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get("worker")) {
      localStorage.setItem("veil_worker_url", q.get("worker").replace(/\/$/, ""));
    }
  } catch (e) {}
})();

var WORKER_URL = (
  localStorage.getItem("veil_worker_url") ||
  "https://veil-access.retropixel404.workers.dev"
).replace(/\/$/, "");

var adminToken = "";

function $(id) {
  return document.getElementById(id);
}

function flash(el, text, ok) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg " + (ok === true ? "ok" : ok === false ? "err" : "");
  if (text) {
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.textContent = "";
      el.className = "msg";
    }, 3500);
  }
}

function api(path, opts) {
  opts = opts || {};
  var headers = { "content-type": "application/json" };
  if (adminToken) headers["x-veil-admin"] = adminToken;
  return fetch(WORKER_URL + path, {
    method: opts.method || "GET",
    headers: headers,
    body: opts.body,
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
        data: {
          ok: false,
          error: "Could not reach server (" + (err && err.message ? err.message : "network") + ")",
        },
      };
    });
}

function showApp(ok) {
  $("loginView").classList.toggle("show", !ok);
  $("appView").classList.toggle("show", ok);
  $("brand").classList.toggle("show", ok);
}

$("loginBtn").onclick = function () {
  flash($("loginMsg"), "Checking…");
  api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: $("adminPass").value }),
  }).then(function (r) {
    if (!r.data.ok) {
      flash($("loginMsg"), r.data.error || "Wrong password", false);
      return;
    }
    adminToken = r.data.token || "";
    $("adminPass").value = "";
    flash($("loginMsg"), "");
    showApp(true);
    loadUsers();
  });
};

$("adminPass").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("loginBtn").click();
});

$("signoutAll").onclick = function () {
  if (!confirm("Sign out everyone?")) return;
  api("/api/admin/signout-all", { method: "POST", body: "{}" }).then(function (r) {
    flash($("globalMsg"), r.data.ok ? "Everyone signed out." : r.data.error || "Failed", !!r.data.ok);
  });
};

$("refreshUsers").onclick = function () {
  loadUsers();
};

var searchTimer = null;
$("userSearch").addEventListener("input", function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadUsers, 250);
});

function badge(status) {
  var s = status || "pending";
  return '<span class="badge ' + s + '">' + s + "</span>";
}

function fmtDate(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return "—";
  }
}

function loadUsers() {
  var q = ($("userSearch").value || "").trim();
  var path = "/api/admin/users" + (q ? "?q=" + encodeURIComponent(q) : "");
  api(path).then(function (r) {
    var list = $("userList");
    list.innerHTML = "";
    if (!r.data.ok) {
      list.innerHTML = '<div class="msg err">' + (r.data.error || "Failed") + "</div>";
      return;
    }
    var users = r.data.users || [];
    if (!users.length) {
      list.innerHTML = '<div class="msg">No users yet</div>';
      return;
    }
    users.forEach(function (u) {
      var div = document.createElement("div");
      div.className = "user";
      var time =
        u.infinite || u.remainingLabel === "inf"
          ? "unlimited"
          : u.remainingHuman || u.remainingLabel || "none";
      var banLine = "";
      if (u.banned || u.status === "banned") {
        banLine =
          " · ban: " +
          escapeHtml(u.banRemainingHuman || "permanent") +
          (u.banReason ? " — " + escapeHtml(u.banReason) : "");
      }
      div.innerHTML =
        '<div class="user-email">' +
        escapeHtml(u.email) +
        badge(u.status) +
        (u.emailVerified ? "" : '<span class="badge">unverified</span>') +
        (u.googleLinked ? '<span class="badge">google</span>' : "") +
        "</div>" +
        '<div class="user-meta">Access: ' +
        escapeHtml(time) +
        banLine +
        (u.created ? " · joined " + fmtDate(u.created) : "") +
        "</div>" +
        '<div class="detail">' +
        '<div class="user-meta" style="margin-bottom:10px">' +
        "ID: " +
        escapeHtml(u.id || "") +
        "<br>Last login: " +
        escapeHtml(fmtDate(u.lastLogin)) +
        "<br>Email verified: " +
        (u.emailVerified ? "yes" : "no") +
        "<br>Google linked: " +
        (u.googleLinked ? "yes" : "no") +
        "<br>Password set: " +
        (u.hasPassword ? "yes (hashed — cannot view)" : "no (Google-only or unset)") +
        (u.banned
          ? "<br>Ban: " +
            escapeHtml(u.banRemainingHuman || "permanent") +
            (u.banReason ? " — " + escapeHtml(u.banReason) : "")
          : "") +
        "</div>" +
        '<label class="hint">Grant access time (30m, 2h, 1d, inf)</label>' +
        '<div class="row">' +
        '<input type="text" class="dur" placeholder="1d" value="1d" />' +
        '<select class="mode"><option value="set">Set</option><option value="add">Add</option></select>' +
        '<button type="button" class="primary grant">Grant</button>' +
        "</div>" +
        '<label class="hint">Set Veil password (cannot view old password — hashed)</label>' +
        '<div class="row">' +
        '<input type="text" class="newpass" placeholder="New password (min 6)" />' +
        '<button type="button" class="setpass">Save password</button>' +
        "</div>" +
        '<label class="hint">Ban duration (30m, 2h, 1d, inf = permanent) + reason</label>' +
        '<div class="row">' +
        '<input type="text" class="bandur" placeholder="1d or inf" value="1d" />' +
        '<input type="text" class="banreason" placeholder="Reason (optional)" />' +
        "</div>" +
        '<div class="row" style="margin-top:8px">' +
        (u.status === "banned"
          ? '<button type="button" class="unban">Unban</button>'
          : '<button type="button" class="danger ban">Ban</button>') +
        "</div>" +
        '<div class="msg actmsg"></div>' +
        "</div>";

      div.addEventListener("click", function (e) {
        if (e.target.closest("button, input, select")) return;
        div.classList.toggle("open");
      });

      var msg = div.querySelector(".actmsg");

      div.querySelector(".grant").onclick = function (e) {
        e.stopPropagation();
        var duration = div.querySelector(".dur").value;
        var mode = div.querySelector(".mode").value;
        api("/api/admin/users/grant", {
          method: "POST",
          body: JSON.stringify({ email: u.email, duration: duration, mode: mode }),
        }).then(function (res) {
          flash(msg, res.data.ok ? "Granted (live within ~12s for user)" : res.data.error || "Failed", !!res.data.ok);
          if (res.data.ok) loadUsers();
        });
      };

      div.querySelector(".setpass").onclick = function (e) {
        e.stopPropagation();
        var password = div.querySelector(".newpass").value;
        api("/api/admin/users/set-password", {
          method: "POST",
          body: JSON.stringify({ email: u.email, password: password }),
        }).then(function (res) {
          flash(msg, res.data.ok ? "Password updated" : res.data.error || "Failed", !!res.data.ok);
          if (res.data.ok) loadUsers();
        });
      };

      var banBtn = div.querySelector(".ban");
      if (banBtn) {
        banBtn.onclick = function (e) {
          e.stopPropagation();
          var duration = (div.querySelector(".bandur") || {}).value || "inf";
          var reason = (div.querySelector(".banreason") || {}).value || "";
          if (!confirm("Ban " + u.email + " for " + duration + "?")) return;
          api("/api/admin/users/ban", {
            method: "POST",
            body: JSON.stringify({ email: u.email, duration: duration, reason: reason }),
          }).then(function (res) {
            flash(msg, res.data.ok ? "Banned (live within ~12s)" : res.data.error || "Failed", !!res.data.ok);
            if (res.data.ok) loadUsers();
          });
        };
      }
      var unbanBtn = div.querySelector(".unban");
      if (unbanBtn) {
        unbanBtn.onclick = function (e) {
          e.stopPropagation();
          api("/api/admin/users/unban", {
            method: "POST",
            body: JSON.stringify({ email: u.email }),
          }).then(function (res) {
            flash(msg, res.data.ok ? "Unbanned" : res.data.error || "Failed", !!res.data.ok);
            if (res.data.ok) loadUsers();
          });
        };
      }

      list.appendChild(div);
    });
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
