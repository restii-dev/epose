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
      div.innerHTML =
        '<div class="user-email">' +
        escapeHtml(u.email) +
        badge(u.status) +
        (u.emailVerified ? "" : '<span class="badge">unverified</span>') +
        "</div>" +
        '<div class="user-meta">Time: ' +
        escapeHtml(time) +
        (u.created ? " · joined " + new Date(u.created).toLocaleString() : "") +
        "</div>" +
        '<div class="detail">' +
        '<label class="hint">Grant time (30m, 2h, 1d, inf)</label>' +
        '<div class="row">' +
        '<input type="text" class="dur" placeholder="1d" value="1d" />' +
        '<select class="mode"><option value="set">Set</option><option value="add">Add</option></select>' +
        '<button type="button" class="primary grant">Grant</button>' +
        "</div>" +
        '<label class="hint">Set Veil password</label>' +
        '<div class="row">' +
        '<input type="text" class="newpass" placeholder="New password" />' +
        '<button type="button" class="setpass">Save password</button>' +
        "</div>" +
        '<div class="row" style="margin-top:10px">' +
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
          flash(msg, res.data.ok ? "Granted" : res.data.error || "Failed", !!res.data.ok);
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
        });
      };

      var banBtn = div.querySelector(".ban");
      if (banBtn) {
        banBtn.onclick = function (e) {
          e.stopPropagation();
          if (!confirm("Ban " + u.email + "?")) return;
          api("/api/admin/users/ban", {
            method: "POST",
            body: JSON.stringify({ email: u.email }),
          }).then(function (res) {
            flash(msg, res.data.ok ? "Banned" : res.data.error || "Failed", !!res.data.ok);
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
