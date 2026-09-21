/**
 * Veil access control — Cloudflare Worker
 * Bindings: VEIL_KV, ADMIN_PASSWORD, ADMIN_SECRET, ALLOWED_ORIGINS (optional)
 */
const enc = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": extra.origin || "*",
      "access-control-allow-headers": "content-type, authorization, x-veil-admin",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
}

function cors(req) {
  return { origin: req.headers.get("Origin") || "*" };
}

function clientIp(req) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    (req.headers.get("X-Forwarded-For") || "").split(",")[0].trim() ||
    "0.0.0.0"
  );
}

function parseDuration(input) {
  if (input == null) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  if (["inf", "infinite", "perm", "permanent"].includes(raw)) {
    return { ms: null, infinite: true, label: "inf" };
  }
  let s = raw
    .replace(/days?/g, "d")
    .replace(/hours?/g, "h")
    .replace(/hrs?/g, "h")
    .replace(/minutes?/g, "m")
    .replace(/mins?/g, "m")
    .replace(/seconds?/g, "s")
    .replace(/secs?/g, "s")
    .replace(/,/g, ";")
    .replace(/\s+/g, "");
  const parts = s.split(";").filter(Boolean);
  let total = 0;
  const re = /^(\d+)(ms|s|m|h|hr|d)$/;
  for (const p of parts) {
    const m = p.match(re);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = m[2];
    if (u === "ms") total += n;
    else if (u === "s") total += n * 1000;
    else if (u === "m") total += n * 60 * 1000;
    else if (u === "h" || u === "hr") total += n * 3600 * 1000;
    else if (u === "d") total += n * 86400 * 1000;
  }
  if (total <= 0) return null;
  return { ms: total, infinite: false, label: s };
}

function formatLeft(ms) {
  if (ms == null || !Number.isFinite(ms)) return "inf";
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const out = [];
  if (d) out.push(d + "d");
  if (h) out.push(h + "h");
  if (m) out.push(m + "m");
  if (sec || !out.length) out.push(sec + "s");
  return out.join(";");
}

function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function genKeyCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeAdminToken(env, ttlMs = 12 * 3600 * 1000) {
  const exp = Date.now() + ttlMs;
  const nonce = randomToken(8);
  const payload = exp + "." + nonce;
  const sig = await hmac(env.ADMIN_SECRET || env.ADMIN_PASSWORD || "veil", payload);
  return payload + "." + sig;
}

async function verifyAdminToken(env, token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expect = await hmac(env.ADMIN_SECRET || env.ADMIN_PASSWORD || "veil", expStr + "." + nonce);
  return sig === expect;
}

async function getIpRecord(env, ip) {
  const raw = await env.VEIL_KV.get("ip:" + ip, "json");
  return (
    raw || {
      ip,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      hits: 0,
      blockedUntil: 0,
      blockInfinite: false,
      access: null,
      history: [],
      geo: null,
    }
  );
}

async function putIpRecord(env, rec) {
  if (rec.history && rec.history.length > 40) rec.history = rec.history.slice(-40);
  await env.VEIL_KV.put("ip:" + String(rec.ip || "0.0.0.0"), JSON.stringify(rec), {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}

async function listIpKeys(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.VEIL_KV.list({ prefix: "ip:", cursor });
    for (const k of page.keys) keys.push(k.name);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

async function getGlobalEpoch(env) {
  const v = await env.VEIL_KV.get("meta:globalEpoch");
  return v ? parseInt(v, 10) || 0 : 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const c = cors(req);
    if (req.method === "OPTIONS") return json({ ok: true }, 204, c);
    if (url.pathname === "/" || url.pathname === "/api/health") {
      return json({ ok: true, service: "veil-access" }, 200, c);
    }

    try {
      if (url.pathname === "/api/admin/login" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (!env.ADMIN_PASSWORD || body.password !== env.ADMIN_PASSWORD) {
          return json({ ok: false, error: "Invalid admin password" }, 401, c);
        }
        const token = await makeAdminToken(env);
        return json({ ok: true, token }, 200, c);
      }

      const adminHeader =
        req.headers.get("x-veil-admin") ||
        (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
        "";

      if (url.pathname === "/api/admin/generate-key" && req.method === "POST") {
        if (!(await verifyAdminToken(env, adminHeader))) {
          return json({ ok: false, error: "Unauthorized" }, 401, c);
        }
        const body = await req.json().catch(() => ({}));
        const dur = parseDuration(body.duration || body.ttl || "1h");
        if (!dur) return json({ ok: false, error: "Invalid duration format" }, 400, c);
        const code = genKeyCode();
        const record = {
          code,
          created: Date.now(),
          durationMs: dur.ms,
          infinite: !!dur.infinite,
          durationLabel: dur.label,
          used: false,
          usedAt: null,
          usedByIp: null,
        };
        await env.VEIL_KV.put("key:" + code, JSON.stringify(record), {
          expirationTtl: 60 * 60 * 24 * 30,
        });
        return json({ ok: true, key: code, duration: dur.label, infinite: dur.infinite }, 200, c);
      }

      if (url.pathname === "/api/admin/ips" && req.method === "GET") {
        if (!(await verifyAdminToken(env, adminHeader))) {
          return json({ ok: false, error: "Unauthorized" }, 401, c);
        }
        const names = await listIpKeys(env);
        const now = Date.now();
        const items = [];
        for (const name of names) {
          const rec = await env.VEIL_KV.get(name, "json");
          if (!rec) continue;
          const blocked = !!rec.blockInfinite || (rec.blockedUntil && rec.blockedUntil > now);
          let access = null;
          if (rec.access) {
            const left = rec.access.infinite ? null : Math.max(0, (rec.access.expires || 0) - now);
            const valid = rec.access.infinite || (rec.access.expires && rec.access.expires > now);
            access = {
              ...rec.access,
              valid,
              timeLeft: rec.access.infinite ? "inf" : formatLeft(left),
              timeLeftMs: left,
            };
          }
          items.push({
            ip: rec.ip,
            firstSeen: rec.firstSeen,
            lastSeen: rec.lastSeen,
            hits: rec.hits,
            blocked,
            blockedUntil: rec.blockedUntil || 0,
            blockInfinite: !!rec.blockInfinite,
            blockLeft: rec.blockInfinite ? "inf" : formatLeft(Math.max(0, (rec.blockedUntil || 0) - now)),
            access,
            geo: rec.geo || null,
          });
        }
        items.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
        return json({ ok: true, ips: items }, 200, c);
      }

      if (url.pathname.startsWith("/api/admin/ip/") && req.method === "GET") {
        if (!(await verifyAdminToken(env, adminHeader))) {
          return json({ ok: false, error: "Unauthorized" }, 401, c);
        }
        const ip = decodeURIComponent(url.pathname.slice("/api/admin/ip/".length));
        const rec = await getIpRecord(env, ip);
        const now = Date.now();
        const lat = rec.geo && rec.geo.lat;
        const lon = rec.geo && rec.geo.lon;
        let mapUrl = "https://www.openstreetmap.org/search?query=" + encodeURIComponent(ip);
        if (lat && lon) {
          mapUrl = "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon + "#map=10/" + lat + "/" + lon;
        }
        return json({
          ok: true,
          ip: rec,
          blocked: !!rec.blockInfinite || (rec.blockedUntil && rec.blockedUntil > now),
          blockLeft: rec.blockInfinite ? "inf" : formatLeft(Math.max(0, (rec.blockedUntil || 0) - now)),
          mapUrl,
        }, 200, c);
      }

      if (url.pathname === "/api/admin/block" && req.method === "POST") {
        if (!(await verifyAdminToken(env, adminHeader))) {
          return json({ ok: false, error: "Unauthorized" }, 401, c);
        }
        const body = await req.json().catch(() => ({}));
        const ip = String(body.ip || "").trim();
        if (!ip) return json({ ok: false, error: "Missing ip" }, 400, c);
        const dur = parseDuration(body.duration || "1h");
        if (!dur) return json({ ok: false, error: "Invalid duration" }, 400, c);
        const rec = await getIpRecord(env, ip);
        rec.blockInfinite = !!dur.infinite;
        rec.blockedUntil = dur.infinite ? 0 : Date.now() + dur.ms;
        rec.access = null;
        await putIpRecord(env, rec);
        return json({ ok: true, ip, blockLeft: dur.infinite ? "inf" : formatLeft(dur.ms) }, 200, c);
      }

      if (url.pathname === "/api/admin/unblock" && req.method === "POST") {
        if (!(await verifyAdminToken(env, adminHeader))) {
          return json({ ok: false, error: "Unauthorized" }, 401, c);
        }
        const body = await req.json().catch(() => ({}));
        const ip = String(body.ip || "").trim();
        const rec = await getIpRecord(env, ip);
        rec.blockInfinite = false;
        rec.blockedUntil = 0;
        await putIpRecord(env, rec);
        return json({ ok: true }, 200, c);
      }

      if (url.pathname === "/api/admin/signout-all" && req.method === "POST") {
        if (!(await verifyAdminToken(env, adminHeader))) {
          return json({ ok: false, error: "Unauthorized" }, 401, c);
        }
        const epoch = Date.now();
        await env.VEIL_KV.put("meta:globalEpoch", String(epoch));
        const names = await listIpKeys(env);
        for (const name of names) {
          const rec = await env.VEIL_KV.get(name, "json");
          if (rec) {
            rec.access = null;
            await env.VEIL_KV.put(name, JSON.stringify(rec));
          }
        }
        return json({ ok: true, epoch }, 200, c);
      }

      if (url.pathname === "/api/redeem" && req.method === "POST") {
        const ip = clientIp(req);
        const body = await req.json().catch(() => ({}));
        const code = String(body.key || body.code || "").trim().toUpperCase().replace(/\s+/g, "");
        if (!code) return json({ ok: false, error: "Enter a key" }, 400, c);

        const rec = await getIpRecord(env, ip);
        rec.lastSeen = Date.now();
        rec.hits = (rec.hits || 0) + 1;
        const cf = req.cf || {};
        rec.geo = {
          country: cf.country || null,
          region: cf.region || null,
          city: cf.city || null,
          lat: cf.latitude || null,
          lon: cf.longitude || null,
          asOrganization: cf.asOrganization || null,
          timezone: cf.timezone || null,
        };

        const now = Date.now();
        if (rec.blockInfinite || (rec.blockedUntil && rec.blockedUntil > now)) {
          const left = rec.blockInfinite ? "inf" : formatLeft(Math.max(0, rec.blockedUntil - now));
          await putIpRecord(env, rec);
          return json({
            ok: false,
            blocked: true,
            error: "You are blocked from entering Veil for " + left + ".",
            blockLeft: left,
          }, 403, c);
        }

        const keyRec = await env.VEIL_KV.get("key:" + code, "json");
        if (!keyRec || keyRec.used) {
          await putIpRecord(env, rec);
          return json({ ok: false, error: "Invalid or already used key" }, 400, c);
        }

        keyRec.used = true;
        keyRec.usedAt = now;
        keyRec.usedByIp = ip;
        await env.VEIL_KV.put("key:" + code, JSON.stringify(keyRec));

        const epoch = await getGlobalEpoch(env);
        const sessionId = randomToken(24);
        const infinite = !!keyRec.infinite;
        const expires = infinite ? null : now + (keyRec.durationMs || 0);
        const session = {
          id: sessionId,
          ip,
          key: code,
          started: now,
          expires,
          infinite,
          durationLabel: keyRec.durationLabel,
          durationMs: keyRec.durationMs,
          epoch,
        };
        const ttl = infinite
          ? 60 * 60 * 24 * 90
          : Math.max(60, Math.ceil((keyRec.durationMs || 0) / 1000) + 60);
        await env.VEIL_KV.put("session:" + sessionId, JSON.stringify(session), {
          expirationTtl: Math.min(ttl, 60 * 60 * 24 * 90),
        });

        rec.access = {
          sessionId,
          key: code,
          started: now,
          expires,
          infinite,
          durationLabel: keyRec.durationLabel,
          durationMs: keyRec.durationMs,
        };
        rec.history = rec.history || [];
        rec.history.push({ at: now, key: code, durationLabel: keyRec.durationLabel });
        await putIpRecord(env, rec);

        return json({
          ok: true,
          token: sessionId,
          expires,
          infinite,
          durationLabel: keyRec.durationLabel,
          timeLeft: infinite ? "inf" : formatLeft(keyRec.durationMs),
        }, 200, c);
      }

      if (url.pathname === "/api/session/check" && req.method === "POST") {
        const ip = clientIp(req);
        const body = await req.json().catch(() => ({}));
        const token = String(body.token || "").trim();
        const now = Date.now();
        const ipRec = await getIpRecord(env, ip);
        ipRec.lastSeen = now;

        if (ipRec.blockInfinite || (ipRec.blockedUntil && ipRec.blockedUntil > now)) {
          const left = ipRec.blockInfinite ? "inf" : formatLeft(Math.max(0, ipRec.blockedUntil - now));
          await putIpRecord(env, ipRec);
          return json({
            ok: false,
            blocked: true,
            error: "You are blocked from entering Veil for " + left + ".",
            blockLeft: left,
          }, 403, c);
        }

        if (!token) {
          await putIpRecord(env, ipRec);
          return json({ ok: false, error: "No session" }, 401, c);
        }

        const session = await env.VEIL_KV.get("session:" + token, "json");
        if (!session) {
          await putIpRecord(env, ipRec);
          return json({ ok: false, error: "Session expired or invalid" }, 401, c);
        }

        const epoch = await getGlobalEpoch(env);
        if ((session.epoch || 0) < epoch) {
          await env.VEIL_KV.delete("session:" + token);
          await putIpRecord(env, ipRec);
          return json({ ok: false, error: "Signed out globally" }, 401, c);
        }

        if (!session.infinite && session.expires && session.expires <= now) {
          await env.VEIL_KV.delete("session:" + token);
          if (ipRec.access && ipRec.access.sessionId === token) ipRec.access = null;
          await putIpRecord(env, ipRec);
          return json({ ok: false, error: "Session expired" }, 401, c);
        }

        session.lastIp = ip;
        session.lastSeen = now;
        await env.VEIL_KV.put("session:" + token, JSON.stringify(session));
        const left = session.infinite ? null : Math.max(0, session.expires - now);
        await putIpRecord(env, ipRec);

        return json({
          ok: true,
          expires: session.expires,
          infinite: !!session.infinite,
          timeLeft: session.infinite ? "inf" : formatLeft(left),
          key: session.key,
        }, 200, c);
      }

      return json({ ok: false, error: "Not found" }, 404, c);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message ? err.message : err) }, 500, c);
    }
  },
};
