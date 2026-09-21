/**
 * Domain lock + best-effort devtools detection.
 * Not perfect security — only a speed bump.
 */
(function () {
  const host = location.hostname || "";
  const path = location.pathname || "";
  const allowedHost =
    host === "rtpx101.github.io" ||
    host.endsWith(".pages.dev") ||
    host === "localhost" ||
    host === "127.0.0.1";
  const allowedPath =
    host === "localhost" ||
    host === "127.0.0.1" ||
    path.indexOf("/veil") === 0 ||
    path === "/" ||
    path.indexOf("/admin") >= 0;

  if (!allowedHost || (host === "rtpx101.github.io" && path.indexOf("/veil") !== 0 && path.indexOf("/admin") < 0 && path.indexOf("/testprox") !== 0)) {
    // Only hard-lock github project path
    if (host === "rtpx101.github.io" && path.indexOf("/veil") !== 0) {
      document.documentElement.innerHTML = "";
      try { location.replace("about:blank"); } catch (_) {}
      return;
    }
  }

  function wipe() {
    try {
      document.documentElement.innerHTML = "";
      for (let i = 0; i < 50; i++) document.write("");
    } catch (_) {}
    try { location.replace("about:blank"); } catch (_) {}
  }

  // DevTools heuristics (bypassable)
  let last = Date.now();
  setInterval(function () {
    const w = window.outerWidth - window.innerWidth;
    const h = window.outerHeight - window.innerHeight;
    if (w > 160 || h > 160) wipe();
    const t = Date.now();
    // debugger lag
    // eslint-disable-next-line no-debugger
    const before = performance.now();
    // no forced debugger — too aggressive for admin; only size check on veil main
    if (t - last > 5000) last = t;
  }, 1200);
})();
