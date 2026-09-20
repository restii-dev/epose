// sw.js — aligned with working testprox, relative paths for Cloudflare Pages root
importScripts("./scramjet/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

const BASE = self.location.pathname.replace(/\/?sw\.js$/i, "").replace(/\/$/, "") || "";
const PROXY_PREFIX = (BASE ? BASE + "/service/" : "/service/");
const ORIGIN = self.location.origin;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function isStaticAsset(path) {
  if (path === "/sw.js" || path === "/SW.js" || path.endsWith("/sw.js")) return true;
  if (path === "/" || path === "/index.html" || path === "") return true;
  if (path === "/veil-app.js" || path.endsWith("/veil-app.js")) return true;
  if (path.startsWith("/baremux/") || path.includes("/baremux/")) return true;
  if (path.startsWith("/epoxy/") || path.includes("/epoxy/")) return true;
  if (path.startsWith("/libcurl/") || path.includes("/libcurl/")) return true;
  if (path.startsWith("/scramjet/") || path.includes("/scramjet/")) return true;
  if (path.startsWith("/image/") || path.includes("/image/")) return true;
  if (path.endsWith(".map") || path.endsWith(".png") || path.endsWith(".svg") || path.endsWith(".wasm")) return true;
  return false;
}

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
