/* admin.js — talks to Cloudflare Worker */
const WORKER_URL = (localStorage.getItem("veil_worker_url") || "").replace(/\/$/, "") || "https://YOUR-WORKER.workers.dev";
const TOKEN_KEY = "veil_admin_token";

const $ = (id) => document.getElementById(id);

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

async function api(path, opts = {}) {
  const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
  if (token()) headers["x-veil-admin"] = token();
  const res = await fetch(WORKER_URL + path, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function showApp(ok) {
  $("loginView").classList.toggle("show", !ok);
  $("appView").classList.toggle("show", ok);
}

$("loginBtn").onclick = async () => {
  $("loginMsg").textContent = "Checking...";
  $("loginMsg").className = "msg";
  const { data } = await api("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ password: $("adminPass").value }),
  });
  if (!data.ok) {
    $("loginMsg").textContent = data.error || "Login failed";
    $("loginMsg").className = "msg err";
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, data.token);
  $("loginMsg").textContent = "";
  showApp(true);
  loadIps();
};

$("genKey").onclick = async () => {
  $("keyMsg").textContent = "";
  const { data } = await api("/api/admin/generate-key", {
    method: "POST",
    body: JSON.stringify({ duration: $("keyDur").value }),
  });
  if (!data.ok) {
    $("keyMsg").textContent = data.error || "Failed";
    $("keyMsg").className = "msg err";
    return;
  }
  $("keyOut").textContent = data.key;
  $("keyMsg").textContent = "Duration: " + data.duration + (data.infinite ? " (infinite)" : "") + " — one-time use";
  $("keyMsg").className = "msg ok";
};

$("signoutAll").onclick = async () => {
  if (!confirm("Sign out ALL users?")) return;
  const { data } = await api("/api/admin/signout-all", { method: "POST", body: "{}" });
  $("globalMsg").textContent = data.ok ? "Everyone signed out." : (data.error || "Failed");
  $("globalMsg").className = data.ok ? "msg ok" : "msg err";
  loadIps();
};

$("refreshIps").onclick = () => loadIps();

let selectedIp = null;

async function loadIps() {
  const { data } = await api("/api/admin/ips");
  const body = $("ipBody");
  body.innerHTML = "";
  if (!data.ok) {
    body.innerHTML = "<tr><td colspan=6>" + (data.error || "Failed") + "</td></tr>";
    return;
  }
  for (const row of data.ips || []) {
    const tr = document.createElement("tr");
    const accessOk = row.access && row.access.valid;
    tr.innerHTML =
      "<td>" + row.ip + "</td>" +
      "<td>" + (row.blocked ? "<span class='tag bad'>blocked</span>" : accessOk ? "<span class='tag ok'>access</span>" : "<span class='tag mute'>none</span>") + "</td>" +
      "<td>" + (accessOk ? "yes" : "no") + "</td>" +
      "<td>" + (row.blocked ? row.blockLeft : (row.access && row.access.timeLeft) || "-") + "</td>" +
      "<td>" + (row.access && row.access.key ? row.access.key : "-") + "</td>" +
      "<td class='actions'><button type='button' data-ip='" + row.ip + "'>View</button></td>";
    body.appendChild(tr);
  }
  body.querySelectorAll("button[data-ip]").forEach((btn) => {
    btn.onclick = () => viewIp(btn.dataset.ip);
  });
}

async function viewIp(ip) {
  selectedIp = ip;
  $("ipDetail").style.display = "block";
  const { data } = await api("/api/admin/ip/" + encodeURIComponent(ip));
  if (!data.ok) {
    $("ipDetailText").textContent = data.error || "Failed";
    return;
  }
  const r = data.ip;
  const g = r.geo || {};
  $("ipDetailText").innerHTML =
    "<div><b>IP:</b> " + r.ip + "</div>" +
    "<div><b>Hits:</b> " + (r.hits || 0) + "</div>" +
    "<div><b>First seen:</b> " + new Date(r.firstSeen).toLocaleString() + "</div>" +
    "<div><b>Last seen:</b> " + new Date(r.lastSeen).toLocaleString() + "</div>" +
    "<div><b>Country:</b> " + (g.country || "?") + " <b>Region:</b> " + (g.region || "?") + " <b>City:</b> " + (g.city || "?") + "</div>" +
    "<div><b>Org:</b> " + (g.asOrganization || "?") + "</div>" +
    "<div><b>Blocked:</b> " + (data.blocked ? "yes (" + data.blockLeft + ")" : "no") + "</div>" +
    "<div><b>Access key:</b> " + (r.access && r.access.key ? r.access.key : "none") + "</div>" +
    "<div><b>Access started:</b> " + (r.access ? new Date(r.access.started).toLocaleString() : "-") + "</div>" +
    "<div><b>Access duration:</b> " + (r.access && r.access.durationLabel ? r.access.durationLabel : "-") + "</div>";
  if (data.mapUrl) $("ipMap").src = data.mapUrl;
}

$("blockBtn").onclick = async () => {
  if (!selectedIp) return;
  const { data } = await api("/api/admin/block", {
    method: "POST",
    body: JSON.stringify({ ip: selectedIp, duration: $("blockDur").value }),
  });
  $("blockMsg").textContent = data.ok ? "Blocked for " + data.blockLeft : (data.error || "Failed");
  $("blockMsg").className = data.ok ? "msg ok" : "msg err";
  loadIps();
  viewIp(selectedIp);
};

$("unblockBtn").onclick = async () => {
  if (!selectedIp) return;
  const { data } = await api("/api/admin/unblock", {
    method: "POST",
    body: JSON.stringify({ ip: selectedIp }),
  });
  $("blockMsg").textContent = data.ok ? "Unblocked" : (data.error || "Failed");
  $("blockMsg").className = data.ok ? "msg ok" : "msg err";
  loadIps();
  viewIp(selectedIp);
};

// boot
if (token()) {
  showApp(true);
  loadIps();
} else {
  showApp(false);
}

// optional: set worker URL via ?worker=
const q = new URLSearchParams(location.search);
if (q.get("worker")) {
  localStorage.setItem("veil_worker_url", q.get("worker"));
  location.search = "";
}
