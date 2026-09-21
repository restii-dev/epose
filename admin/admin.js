/* Veil Control — admin client */
(function () {
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("worker")) {
      localStorage.setItem("veil_worker_url", q.get("worker").replace(/\/$/, ""));
    }
  } catch (_) {}
})();

const WORKER_URL = (
  localStorage.getItem("veil_worker_url") ||
  "https://veil-access.retropixel404.workers.dev"
).replace(/\/$/, "");

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
  $("loginMsg").textContent = "Verifying credentials…";
  $("loginMsg").className = "msg";
  try {
    const { data } = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: $("adminPass").value }),
    });
    if (!data.ok) {
      $("loginMsg").textContent = data.error || "Authentication failed";
      $("loginMsg").className = "msg err";
      return;
    }
    sessionStorage.setItem(TOKEN_KEY, data.token);
    $("loginMsg").textContent = "";
    showApp(true);
    loadIps();
  } catch (e) {
    $("loginMsg").textContent = "Unable to reach control service";
    $("loginMsg").className = "msg err";
  }
};

$("adminPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("loginBtn").click();
});

$("genKey").onclick = async () => {
  $("keyMsg").textContent = "";
  const { data } = await api("/api/admin/generate-key", {
    method: "POST",
    body: JSON.stringify({ duration: $("keyDur").value }),
  });
  if (!data.ok) {
    $("keyMsg").textContent = data.error || "Issuance failed";
    $("keyMsg").className = "msg err";
    return;
  }
  $("keyOut").textContent = data.key;
  $("keyMsg").textContent =
    "Issued · validity " + data.duration + (data.infinite ? " (unlimited)" : "") + " · single use";
  $("keyMsg").className = "msg ok";
};

$("signoutAll").onclick = async () => {
  if (!confirm("Revoke every active Veil session?")) return;
  const { data } = await api("/api/admin/signout-all", { method: "POST", body: "{}" });
  $("globalMsg").textContent = data.ok ? "All sessions revoked." : data.error || "Failed";
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
    body.innerHTML = "<tr><td colspan=6>" + (data.error || "Unable to load ledger") + "</td></tr>";
    return;
  }
  if (!(data.ips || []).length) {
    body.innerHTML = "<tr><td colspan=6 style='color:var(--muted)'>No identities recorded yet.</td></tr>";
    return;
  }
  for (const row of data.ips || []) {
    const tr = document.createElement("tr");
    const accessOk = row.access && row.access.valid;
    tr.innerHTML =
      "<td style='font-family:ui-monospace,monospace'>" + row.ip + "</td>" +
      "<td>" +
      (row.blocked
        ? "<span class='tag bad'>restricted</span>"
        : accessOk
          ? "<span class='tag ok'>active</span>"
          : "<span class='tag mute'>idle</span>") +
      "</td>" +
      "<td>" + (accessOk ? "granted" : "none") + "</td>" +
      "<td>" + (row.blocked ? row.blockLeft : (row.access && row.access.timeLeft) || "—") + "</td>" +
      "<td style='font-family:ui-monospace,monospace;font-size:11px'>" +
      (row.access && row.access.key ? row.access.key : "—") +
      "</td>" +
      "<td class='actions'><button type='button' data-ip='" + row.ip + "'>Inspect</button></td>";
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
    $("ipDetailText").textContent = data.error || "Lookup failed";
    return;
  }
  const r = data.ip;
  const g = r.geo || {};
  $("ipDetailText").innerHTML =
    "<div><b>Address</b> — " + r.ip + "</div>" +
    "<div><b>Requests</b> — " + (r.hits || 0) + "</div>" +
    "<div><b>First observed</b> — " + new Date(r.firstSeen).toLocaleString() + "</div>" +
    "<div><b>Last observed</b> — " + new Date(r.lastSeen).toLocaleString() + "</div>" +
    "<div><b>Locale</b> — " +
    [g.city, g.region, g.country].filter(Boolean).join(", ") +
    (g.asOrganization ? " · " + g.asOrganization : "") +
    "</div>" +
    "<div><b>Restriction</b> — " + (data.blocked ? "yes (" + data.blockLeft + ")" : "none") + "</div>" +
    "<div><b>Credential</b> — " + (r.access && r.access.key ? r.access.key : "none") + "</div>" +
    "<div><b>Access began</b> — " + (r.access ? new Date(r.access.started).toLocaleString() : "—") + "</div>" +
    "<div><b>Granted for</b> — " + (r.access && r.access.durationLabel ? r.access.durationLabel : "—") + "</div>";
}

$("blockBtn").onclick = async () => {
  if (!selectedIp) return;
  const { data } = await api("/api/admin/block", {
    method: "POST",
    body: JSON.stringify({ ip: selectedIp, duration: $("blockDur").value }),
  });
  $("blockMsg").textContent = data.ok ? "Restriction applied · " + data.blockLeft : data.error || "Failed";
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
  $("blockMsg").textContent = data.ok ? "Restriction lifted" : data.error || "Failed";
  $("blockMsg").className = data.ok ? "msg ok" : "msg err";
  loadIps();
  viewIp(selectedIp);
};

if (token()) {
  showApp(true);
  loadIps();
} else {
  showApp(false);
}
