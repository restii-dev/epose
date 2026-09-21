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

/* Require password every page load — do not restore token */
var adminToken = "";

function $(id) { return document.getElementById(id); }

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
}

$("loginBtn").onclick = function () {
  $("loginMsg").textContent = "Checking…";
  $("loginMsg").className = "msg";
  api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: $("adminPass").value })
  }).then(function (r) {
    if (!r.data.ok) {
      $("loginMsg").textContent = r.data.error || "Wrong password";
      $("loginMsg").className = "msg err";
      return;
    }
    adminToken = r.data.token || "";
    $("adminPass").value = "";
    $("loginMsg").textContent = "";
    showApp(true);
    loadIps();
  }).catch(function () {
    $("loginMsg").textContent = "Could not reach server";
    $("loginMsg").className = "msg err";
  });
};

$("adminPass").addEventListener("keydown", function (e) {
  if (e.key === "Enter") $("loginBtn").click();
});

$("genKey").onclick = function () {
  $("keyMsg").textContent = "";
  api("/api/admin/generate-key", {
    method: "POST",
    body: JSON.stringify({ duration: $("keyDur").value })
  }).then(function (r) {
    if (!r.data.ok) {
      $("keyMsg").textContent = r.data.error || "Failed";
      $("keyMsg").className = "msg err";
      return;
    }
    $("keyOut").textContent = r.data.key;
    $("keyMsg").textContent = "Created · " + r.data.duration + (r.data.infinite ? " (unlimited)" : "") + " · one-time";
    $("keyMsg").className = "msg ok";
  });
};

$("signoutAll").onclick = function () {
  if (!confirm("Sign out everyone?")) return;
  api("/api/admin/signout-all", { method: "POST", body: "{}" }).then(function (r) {
    $("globalMsg").textContent = r.data.ok ? "Everyone signed out." : (r.data.error || "Failed");
    $("globalMsg").className = r.data.ok ? "msg ok" : "msg err";
    loadIps();
  });
};

$("refreshIps").onclick = function () { loadIps(); };

var selectedIp = null;

function loadIps() {
  api("/api/admin/ips").then(function (r) {
    var body = $("ipBody");
    body.innerHTML = "";
    if (!r.data.ok) {
      body.innerHTML = "<tr><td colspan='6'>" + (r.data.error || "Failed") + "</td></tr>";
      return;
    }
    var ips = r.data.ips || [];
    if (!ips.length) {
      body.innerHTML = "<tr><td colspan='6' style='color:var(--muted)'>No IPs yet</td></tr>";
      return;
    }
    ips.forEach(function (row) {
      var tr = document.createElement("tr");
      var accessOk = row.access && row.access.valid;
      var status = row.blocked
        ? "<span class='tag bad'>blocked</span>"
        : accessOk
          ? "<span class='tag ok'>active</span>"
          : "<span class='tag mute'>none</span>";
      tr.innerHTML =
        "<td style='font-family:monospace'>" + row.ip + "</td>" +
        "<td>" + status + "</td>" +
        "<td>" + (accessOk ? "yes" : "no") + "</td>" +
        "<td>" + (row.blocked ? row.blockLeft : ((row.access && row.access.timeLeft) || "—")) + "</td>" +
        "<td style='font-family:monospace;font-size:11px'>" + ((row.access && row.access.key) || "—") + "</td>" +
        "<td class='actions'><button type='button' data-ip='" + row.ip + "'>View</button></td>";
      body.appendChild(tr);
    });
    body.querySelectorAll("button[data-ip]").forEach(function (btn) {
      btn.onclick = function () { viewIp(btn.getAttribute("data-ip")); };
    });
  });
}

function viewIp(ip) {
  selectedIp = ip;
  $("ipDetail").style.display = "block";
  api("/api/admin/ip/" + encodeURIComponent(ip)).then(function (r) {
    if (!r.data.ok) {
      $("ipDetailText").textContent = r.data.error || "Failed";
      return;
    }
    var rec = r.data.ip;
    var g = rec.geo || {};
    $("ipDetailText").innerHTML =
      "<div><b>IP</b> — " + rec.ip + "</div>" +
      "<div><b>Hits</b> — " + (rec.hits || 0) + "</div>" +
      "<div><b>First seen</b> — " + new Date(rec.firstSeen).toLocaleString() + "</div>" +
      "<div><b>Last seen</b> — " + new Date(rec.lastSeen).toLocaleString() + "</div>" +
      "<div><b>Location</b> — " + [g.city, g.region, g.country].filter(Boolean).join(", ") + "</div>" +
      "<div><b>Blocked</b> — " + (r.data.blocked ? "yes (" + r.data.blockLeft + ")" : "no") + "</div>" +
      "<div><b>Key</b> — " + ((rec.access && rec.access.key) || "none") + "</div>";
  });
}

$("blockBtn").onclick = function () {
  if (!selectedIp) return;
  api("/api/admin/block", {
    method: "POST",
    body: JSON.stringify({ ip: selectedIp, duration: $("blockDur").value })
  }).then(function (r) {
    $("blockMsg").textContent = r.data.ok ? "Blocked · " + r.data.blockLeft : (r.data.error || "Failed");
    $("blockMsg").className = r.data.ok ? "msg ok" : "msg err";
    loadIps();
    viewIp(selectedIp);
  });
};

$("unblockBtn").onclick = function () {
  if (!selectedIp) return;
  api("/api/admin/unblock", {
    method: "POST",
    body: JSON.stringify({ ip: selectedIp })
  }).then(function (r) {
    $("blockMsg").textContent = r.data.ok ? "Unblocked" : (r.data.error || "Failed");
    $("blockMsg").className = r.data.ok ? "msg ok" : "msg err";
    loadIps();
    viewIp(selectedIp);
  });
};

/* Always show login on load */
showApp(false);
