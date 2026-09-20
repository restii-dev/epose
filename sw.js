// sw.js — same structure as working testprox
// https://github.com/retropixel101/testprox

const BASE = (() => {
  // /veil/sw.js → /veil ; /sw.js → ""
  let p = self.location.pathname.replace(/\/?sw\.js$/i, "");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p === "/" ? "" : p;
})();

importScripts((BASE || "") + "/scramjet/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

const PROXY_PREFIX = BASE + "/service/";
const ORIGIN = self.location.origin;

let AD_BLOCK_ENABLED = true;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "veil-adblock") {
    AD_BLOCK_ENABLED = !!e.data.enabled;
  }
});

function isStaticAsset(path) {
  if (path === BASE + "/sw.js" || path === "/sw.js") return true;
  if (path === BASE + "/" || path === BASE + "/index.html" || path === BASE || path === "/") return true;
  if (path === BASE + "/veil-app.js" || path === "/veil-app.js") return true;
  if (path.startsWith(BASE + "/baremux/") || path.startsWith("/baremux/")) return true;
  if (path.startsWith(BASE + "/epoxy/") || path.startsWith("/epoxy/")) return true;
  if (path.startsWith(BASE + "/libcurl/") || path.startsWith("/libcurl/")) return true;
  if (path.startsWith(BASE + "/scramjet/") || path.startsWith("/scramjet/")) return true;
  if (path.startsWith(BASE + "/image/") || path.startsWith("/image/")) return true;
  if (path.endsWith(".map")) return true;
  return false;
}

/**
 * Only true double-proxy (copied from testprox).
 * Normal /service/https%3A%2F%2Fexample.com is left alone.
 */
function unwrapDoubleProxy(pathname) {
  if (!pathname.startsWith(PROXY_PREFIX)) return null;

  let rest = pathname.slice(PROXY_PREFIX.length);
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }

  const leakPrefix = ORIGIN + PROXY_PREFIX;
  if (!decoded.startsWith(leakPrefix) && !decoded.startsWith(PROXY_PREFIX)) {
    return null;
  }

  for (let i = 0; i < 5; i++) {
    if (decoded.startsWith(leakPrefix)) {
      decoded = decoded.slice(leakPrefix.length);
      try { decoded = decodeURIComponent(decoded); } catch {}
      continue;
    }
    if (decoded.startsWith(ORIGIN + "/")) break;
    if (decoded.startsWith(PROXY_PREFIX)) {
      decoded = decoded.slice(PROXY_PREFIX.length);
      try { decoded = decodeURIComponent(decoded); } catch {}
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


const AD_HOSTS = [
  "doubleclick.net", "googleadservices.com", "googlesyndication.com",
  "googletagmanager.com", "adservice.google.com", "pagead2.googlesyndication.com",
  "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "scorecardresearch.com",
  "facebook.net", "connect.facebook.net", "ads-twitter.com", "taboola.com",
  "outbrain.com", "criteo.com", "moatads.com", "openx.net", "pubmatic.com"
];

function isAdUrl(href) {
  if (!AD_BLOCK_ENABLED) return false;
  try {
    const host = new URL(href).hostname.replace(/^www\./, "");
    return AD_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isStaticAsset(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const unwrapped = unwrapDoubleProxy(url.pathname);
        if (unwrapped) {
          const clean =
            ORIGIN + PROXY_PREFIX + encodeURIComponent(unwrapped) + (url.hash || "");
          if (clean !== url.href && !url.href.includes(encodeURIComponent(unwrapped))) {
            console.warn("[SW] unwrapped double-proxy →", unwrapped);
            return Response.redirect(clean, 302);
          }
        }

        // ad block on proxied absolute URLs
        if (url.pathname.startsWith(PROXY_PREFIX)) {
          let rest = url.pathname.slice(PROXY_PREFIX.length);
          try { rest = decodeURIComponent(rest); } catch {}
          if ((rest.startsWith("http://") || rest.startsWith("https://")) && isAdUrl(rest)) {
            return new Response("", { status: 204 });
          }
        }

        await scramjet.loadConfig();
        if (scramjet.route(event)) {
          return await scramjet.fetch(event);
        }
      } catch (err) {
        console.warn("[SW] Scramjet error, network fallback:", err);
      }
      return fetch(event.request);
    })()
  );
});
