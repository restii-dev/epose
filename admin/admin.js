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

function $(id) { return document.getElementById(id); }

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
    body: opts.body
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { res: res, data: data };
    });
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
    body: JSON.stringify({ password: $("adminPass").value })
  }).then(function (r) {
    if (!r.data.ok) {
      flash($("loginMsg"), r.data.error || "Wrong password", false);
      return;
    }
    adminToken = r.data.token || "";
    $("adminPass").value = "";
    flash($("loginMsg"), "");
    showApp(true);
    loadIps();
  }).catch(function () {
    flash($("loginMsg"), "Could not reach server", false);
  });
};

$("adminPass").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("loginBtn").click();
});

$("genKey").onclick = function () {
  api("/api/admin/generate-key", {
    method: "POST",
    body: JSON.stringify({ duration: $("keyDur").value })
  }).then(function (r) {
    if (!r.data.ok) {
      flash($("keyMsg"), r.data.error || "Failed", false);
      return;
    }
    $("keyOut").textContent = r.data.key;
    flash($("keyMsg"), "Created · " + r.data.duration + (r.data.infinite ? " (unlimited)" : "") + " · one-time", true);
  });
};

$("signoutAll").onclick = function () {
  if (!confirm("Sign out everyone?")) return;
  api("/api/admin/signout-all", { method: "POST", body: "{}" }).then(function (r) {
    flash($("globalMsg"), r.data.ok ? "Everyone signed out." : (r.data.error || "Failed"), !!r.data.ok);
    loadIps();
  });
};

$("refreshIps").onclick = function () { loadIps(); };

var openIp = null;

function loadIps() {
  api("/api/admin/ips").then(function (r) {
    var list = $("ipList");
    list.innerHTML = "";
    if (!r.data.ok) {
      list.innerHTML = '<div class="msg err">' + (r.data.error || "Failed") + "</div>";
      return;
    }
    var ips = r.data.ips || [];
    if (!ips.length) {
      list.innerHTML = '<div class="msg">No IPs yet</div>';
      return;
    }
    ips.forEach(function (row) {
      var box = document.createElement("div");
      box.className = "ip-row";
      var accessOk = row.access && row.access.valid;
      var status = row.blocked
        ? '<span class="tag bad">blocked</span>'
        : accessOk
          ? '<span class="tag ok">active</span>'
          : '<span class="tag mute">none</span>';
      var label = row.label ? '<span class="ip-label">' + escapeHtml(row.label) + "</span>" : "";
      box.innerHTML =
        '<div class="ip-main">' +
        '<div class="ip-addr">' + escapeHtml(row.ip) + "</div>" +
        label + status +
        "</div>" +
        '<div class="ip-detail" data-ip="' + escapeHtml(row.ip) + '"></div>';
      box.querySelector(".ip-main").onclick = function () {
        toggleDetail(box, row.ip);
      };
      list.appendChild(box);
      if (openIp === row.ip) {
        toggleDetail(box, row.ip, true);
      }
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

function toggleDetail(box, ip, forceOpen) {
  var detail = box.querySelector(".ip-detail");
  var wasOpen = detail.classList.contains("open");
  document.querySelectorAll(".ip-detail.open").forEach(function (el) {
    el.classList.remove("open");
    el.innerHTML = "";
  });
  if (wasOpen && !forceOpen) {
    openIp = null;
    return;
  }
  openIp = ip;
  detail.classList.add("open");
  detail.innerHTML = '<div class="msg">Loading…</div>';
  api("/api/admin/ip/" + encodeURIComponent(ip)).then(function (r) {
    if (!r.data.ok) {
      detail.innerHTML = '<div class="msg err">' + (r.data.error || "Failed") + "</div>";
      return;
    }
    var rec = r.data.ip;
    var g = rec.geo || {};
    detail.innerHTML =
      '<div class="detail">' +
      "<div><b>IP</b> — " + escapeHtml(rec.ip) + "</div>" +
      "<div><b>Name</b> — " + escapeHtml(rec.label || "—") + "</div>" +
      "<div><b>Hits</b> — " + (rec.hits || 0) + "</div>" +
      "<div><b>First seen</b> — " + new Date(rec.firstSeen).toLocaleString() + "</div>" +
      "<div><b>Last seen</b> — " + new Date(rec.lastSeen).toLocaleString() + "</div>" +
      "<div><b>Location</b> — " + escapeHtml([g.city, g.region, g.country].filter(Boolean).join(", ") || "—") + "</div>" +
      "<div><b>Blocked</b> — " + (r.data.blocked ? "yes (" + r.data.blockLeft + ")" : "no") + "</div>" +
      "<div><b>Key</b> — " + escapeHtml((rec.access && rec.access.key) || "none") + "</div>" +
      "</div>" +
      '<label>Rename this IP</label>' +
      '<div class="row">' +
      '<input class="rename-input" placeholder="e.g. School laptop" value="' + escapeHtml(rec.label || "") + '">' +
      '<button type="button" class="sm rename-btn">Save name</button>' +
      "</div>" +
      '<div class="row" style="margin-top:10px">' +
      '<input class="block-input" placeholder="Block time e.g. 30m, 2h, 1d">' +
      '<button type="button" class="sm red block-btn">Block</button>' +
      '<button type="button" class="sm unblock-btn">Unblock</button>' +
      '<button type="button" class="sm red kill-btn">Invalidate key</button>' +
      "</div>" +
      '<div class="msg detail-msg"></div>';

    detail.querySelector(".rename-btn").onclick = function () {
      var label = detail.querySelector(".rename-input").value;
      api("/api/admin/rename-ip", {
        method: "POST",
        body: JSON.stringify({ ip: ip, label: label })
      }).then(function (res) {
        flash(detail.querySelector(".detail-msg"), res.data.ok ? "Name saved" : (res.data.error || "Failed"), !!res.data.ok);
        loadIps();
      });
    };
    detail.querySelector(".block-btn").onclick = function () {
      api("/api/admin/block", {
        method: "POST",
        body: JSON.stringify({ ip: ip, duration: detail.querySelector(".block-input").value })
      }).then(function (res) {
        flash(detail.querySelector(".detail-msg"), res.data.ok ? "Blocked · " + res.data.blockLeft : (res.data.error || "Failed"), !!res.data.ok);
        loadIps();
      });
    };
    detail.querySelector(".unblock-btn").onclick = function () {
      api("/api/admin/unblock", {
        method: "POST",
        body: JSON.stringify({ ip: ip })
      }).then(function (res) {
        flash(detail.querySelector(".detail-msg"), res.data.ok ? "Unblocked" : (res.data.error || "Failed"), !!res.data.ok);
        loadIps();
      });
    };
    detail.querySelector(".kill-btn").onclick = function () {
      api("/api/admin/invalidate", {
        method: "POST",
        body: JSON.stringify({ ip: ip })
      }).then(function (res) {
        flash(detail.querySelector(".detail-msg"), res.data.ok ? "Key invalidated — they need a new key" : (res.data.error || "Failed"), !!res.data.ok);
        loadIps();
      });
    };
  });
}

showApp(false);
