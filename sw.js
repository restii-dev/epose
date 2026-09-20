// sw.js — Scramjet service worker for Veil
importScripts("./scramjet/scramjet.all.js");

const BASE = self.location.pathname.replace(/sw\.js$/i, "").replace(/\?.*$/, "");
const PROXY_PREFIX = BASE + "service/";
const ORIGIN = self.location.origin;

const AD_HOSTS = [
  "doubleclick.net", "googleadservices.com", "googlesyndication.com",
  "googletagmanager.com", "googletagservices.com", "adservice.google.com",
  "pagead2.googlesyndication.com", "adsystem.com", "amazon-adsystem.com",
  "adnxs.com", "adsrvr.org", "advertising.com", "adsafeprotected.com",
  "scorecardresearch.com", "quantserve.com", "hotjar.com", "hotjar.io",
  "facebook.net", "connect.facebook.net", "ads-twitter.com",
  "taboola.com", "outbrain.com", "criteo.com", "moatads.com",
  "adform.net", "openx.net", "pubmatic.com", "rubiconproject.com",
  "casalemedia.com", "smartadserver.com", "yieldmo.com"
];

let scramjet = null;

function deleteIdb(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      const done = () => resolve();
      req.onsuccess = done;
      req.onerror = done;
      req.onblocked = done;
      setTimeout(done, 1200);
    } catch {
      resolve();
    }
  });
}

async function getScramjet() {
  if (!scramjet) {
    const { ScramjetServiceWorker } = $scramjetLoadWorker();
    scramjet = new ScramjetServiceWorker();
  }
  try {
    await scramjet.loadConfig();
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/object stores was not found|NotFoundError|IDBDatabase|Failed to execute 'transaction'/i.test(msg)) {
      console.warn("[SW] repairing $scramjet IndexedDB");
      await deleteIdb("$scramjet");
      const { ScramjetServiceWorker } = $scramjetLoadWorker();
      scramjet = new ScramjetServiceWorker();
      await scramjet.loadConfig();
    } else {
      throw err;
    }
  }
  return scramjet;
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    await deleteIdb("$scramjet");
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    await deleteIdb("$scramjet");
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "veil-reset-db") {
    e.waitUntil(deleteIdb("$scramjet").then(() => {
      scramjet = null;
    }));
  }
});

function isStaticAsset(path) {
  if (path === BASE + "SW.js" || path === BASE + "sw.js") return true;
  if (path === BASE || path === BASE + "index.html" || path === BASE + "veil-app.js") return true;
  if (path.startsWith(BASE + "baremux/")) return true;
  if (path.startsWith(BASE + "epoxy/")) return true;
  if (path.startsWith(BASE + "libcurl/")) return true;
  if (path.startsWith(BASE + "scramjet/")) return true;
  if (path.startsWith(BASE + "image/")) return true;
  if (path.endsWith(".map") || path.endsWith(".png") || path.endsWith(".svg") || path.endsWith(".wasm") || path.endsWith(".ico")) return true;
  return false;
}

function isAdUrl(href) {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    return AD_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

function emptyAd() {
  return new Response("", { status: 204, statusText: "No Content" });
}

function decodeRest(rest) {
  let cur = rest;
  for (let i = 0; i < 4; i++) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch {
      break;
    }
  }
  return cur;
}

function unwrapDoubleProxy(pathname) {
  if (!pathname.startsWith(PROXY_PREFIX)) return null;
  const rest = pathname.slice(PROXY_PREFIX.length);
  let decoded = decodeRest(rest);
  const leakPrefix = ORIGIN + PROXY_PREFIX;
  if (!decoded.startsWith(leakPrefix) && !decoded.startsWith(PROXY_PREFIX)) return null;
  for (let i = 0; i < 5; i++) {
    if (decoded.startsWith(leakPrefix)) {
      decoded = decodeRest(decoded.slice(leakPrefix.length));
      continue;
    }
    if (decoded.startsWith(PROXY_PREFIX)) {
      decoded = decodeRest(decoded.slice(PROXY_PREFIX.length));
      continue;
    }
    break;
  }
  if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
    if (decoded.startsWith(leakPrefix) || decoded.includes(PROXY_PREFIX)) return null;
    return decoded;
  }
  return null;
}

function proxiedOriginFromReferrer(referrer) {
  if (!referrer) return null;
  try {
    const r = new URL(referrer);
    if (!r.pathname.startsWith(PROXY_PREFIX)) return null;
    let decoded = decodeRest(r.pathname.slice(PROXY_PREFIX.length));
    const leakPrefix = ORIGIN + PROXY_PREFIX;
    if (decoded.startsWith(leakPrefix)) decoded = decodeRest(decoded.slice(leakPrefix.length));
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      return decoded;
    }
  } catch {}
  return null;
}

function resolveRelativeProxy(request) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PROXY_PREFIX)) return null;
  const rest = url.pathname.slice(PROXY_PREFIX.length);
  if (!rest || rest.startsWith("http:") || rest.startsWith("https:") || rest.startsWith("http%") || rest.startsWith("https%")) {
    return null;
  }
  const base = proxiedOriginFromReferrer(request.referrer);
  if (!base) return null;
  try {
    const abs = new URL(rest + url.search + url.hash, base).href;
    return ORIGIN + PROXY_PREFIX + encodeURIComponent(abs);
  } catch {
    return null;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (isStaticAsset(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith((async () => {
    try {
      const relative = resolveRelativeProxy(event.request);
      if (relative) return Response.redirect(relative, 302);

      const unwrapped = unwrapDoubleProxy(url.pathname);
      if (unwrapped) {
        if (isAdUrl(unwrapped)) return emptyAd();
        const clean = ORIGIN + PROXY_PREFIX + encodeURIComponent(unwrapped) + (url.hash || "");
        if (clean !== url.href && !url.href.includes(encodeURIComponent(unwrapped))) {
          return Response.redirect(clean, 302);
        }
      }

      const rest = url.pathname.startsWith(PROXY_PREFIX)
        ? decodeRest(url.pathname.slice(PROXY_PREFIX.length))
        : "";
      if (rest.startsWith("http://") || rest.startsWith("https://")) {
        if (isAdUrl(rest)) return emptyAd();
      }

      const sj = await getScramjet();
      if (sj.route(event)) {
        try {
          return await sj.fetch(event);
        } catch (err) {
          const msg = String(err && err.message || err);
          if (/Invalid URL/i.test(msg)) {
            const fixed = resolveRelativeProxy(event.request);
            if (fixed) return Response.redirect(fixed, 302);
          }
          throw err;
        }
      }
    } catch (err) {
      console.warn("[SW]", err);
    }
    try {
      return await fetch(event.request);
    } catch {
      return new Response("Veil could not load this resource.", {
        status: 502,
        headers: { "content-type": "text/plain" }
      });
    }
  })());
});
