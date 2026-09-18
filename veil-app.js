"use strict";

/* =========================================================
   Veil — rewritten core
   Persistent frames · multi-server · safer URLs · cleaner UI
   ========================================================= */

const REPO_PATH = (() => {
  const p = location.pathname;
  if (p.endsWith("/")) return p;
  const last = p.lastIndexOf("/");
  return p.slice(0, last + 1);
})();

const IMG = REPO_PATH + "image/";
const FAVI = IMG + "favi.png";
const SCRAMJET_PREFIX = REPO_PATH + "service/";
const SCRAMJET_FILES = {
  all: REPO_PATH + "scramjet/scramjet.all.js",
  sync: REPO_PATH + "scramjet/scramjet.sync.js",
  wasm: REPO_PATH + "scramjet/scramjet.wasm.wasm"
};
const BAREMUX_SCRIPT = REPO_PATH + "baremux/index.js";
const BAREMUX_WORKER = REPO_PATH + "baremux/worker.js";
const EPOXY_MODULE = REPO_PATH + "epoxy/index.mjs";
const LIBCURL_MODULE = REPO_PATH + "libcurl/indexmjs.mjs";

/* ---- Multi-server list (first working wins, user can override) ---- */
const DEFAULT_WISP_SERVERS = [
  "wss://wisp-backend-weyl.onrender.com",
  "wss://wisp.mercurywork.shop",
  "wss://nebulaproxy.io/wisp/",
  "wss://wisp.reallyarandomdomain.xyz"
];

const MAX_TABS = 20;

/* =========================================================
   State
   ========================================================= */
let engineReady = false;
let engineController = null;
let engineInitPromise = null;
let activeWisp = null;

let settings = null;
let panic = null;
let bookmarks = [];
let cloak = { title: "Veil", icon: FAVI };

let tabs = [];          // { id, title, url, history, historyIndex, newTab, favicon, frameEl, pageEl, engineFrame }
let activeTabId = null;
let tabCounter = 0;
let bindingPanic = false;

const THEMES = {
  matte: {
    bg: "#101010", bg2: "#151515", bg3: "#1b1b1b", panel: "#181818", panel2: "#202020",
    border: "#2b2b2b", text: "#f2f2f2", muted: "#888888", accent: "#ffffff", accentText: "#111111", newtab: "#101010"
  },
  ember: {
    bg: "#1a0a0a", bg2: "#220e0e", bg3: "#3a1212", panel: "#2a1010", panel2: "#401818",
    border: "#5a2020", text: "#ffeaea", muted: "#b88888", accent: "#ff4d4d", accentText: "#1a0505", newtab: "#1a0a0a"
  },
  sunlight: {
    bg: "#191108", bg2: "#211609", bg3: "#32200c", panel: "#281a0a", panel2: "#3a250e",
    border: "#513716", text: "#fff8eb", muted: "#bca783", accent: "#ffb84d", accentText: "#241303", newtab: "#191108"
  },
  forest: {
    bg: "#0b140e", bg2: "#101b13", bg3: "#17291b", panel: "#132219", panel2: "#1b3020",
    border: "#29452f", text: "#effff1", muted: "#8da993", accent: "#73c982", accentText: "#071109", newtab: "#0b140e"
  },
  moonlight: {
    bg: "#080b12", bg2: "#0d111b", bg3: "#121827", panel: "#101521", panel2: "#171e2d",
    border: "#263047", text: "#eef3ff", muted: "#8490a7", accent: "#7aa2ff", accentText: "#08101f", newtab: "#080b12"
  },
  twilight: {
    bg: "#110d1a", bg2: "#171122", bg3: "#241936", panel: "#1c142b", panel2: "#2b1d40",
    border: "#412c5c", text: "#f7f0ff", muted: "#a89ab8", accent: "#b88cff", accentText: "#160c24", newtab: "#110d1a"
  },
  sakura: {
    bg: "#190e14", bg2: "#21111a", bg3: "#321725", panel: "#28131e", panel2: "#3a1b29",
    border: "#512538", text: "#fff0f6", muted: "#b991a3", accent: "#ff8fba", accentText: "#250b16", newtab: "#190e14"
  }
};

const DEFAULT_SETTINGS = {
  theme: "matte",
  transport: "epoxy",
  backgroundUrl: "",
  aboutBlankMode: "manual",
  customWisp: "",
  ...THEMES.matte
};

const DEFAULT_PANIC = { key: "", code: "", url: "https://classroom.google.com" };

const CLOAK_PRESETS = [
  { name: "Google Docs", title: "Untitled document - Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" },
  { name: "Google Drive", title: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png" },
  { name: "Classroom", title: "Classes", icon: "https://ssl.gstatic.com/classroom/favicon.png" },
  { name: "Canvas", title: "Dashboard", icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico" },
  { name: "Wikipedia", title: "Wikipedia", icon: "https://en.wikipedia.org/static/favicon/wikipedia.ico" },
  { name: "Blank", title: " ", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" }
];

/* =========================================================
   Helpers
   ========================================================= */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

function uid() {
  return "tab_" + Date.now().toString(36) + "_" + (++tabCounter).toString(36);
}

function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m])
  );
}

function getTab(id = activeTabId) {
  return tabs.find(t => t.id === id) || null;
}

function isBookmarked(url) {
  return bookmarks.some(b => b.url === url);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return !!el.isContentEditable;
}

/** Safer URL normalizer — never returns an empty / relative / invalid URL */
function normalizeUrl(input) {
  let value = String(input || "").trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try { return new URL(value).href; } catch { return null; }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try { return new URL(value).href; } catch { return null; }
  }

  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)) {
    try { return new URL("https://" + value).href; } catch { return null; }
  }

  return "https://duckduckgo.com/?q=" + encodeURIComponent(value);
}

function proxySrc(absoluteUrl) {
  if (!absoluteUrl) return "";
  return SCRAMJET_PREFIX + encodeURIComponent(absoluteUrl);
}

/* =========================================================
   Persistence
   ========================================================= */
const COOKIE = {
  consent: false,
  set(name, value, days = 365) {
    if (!this.consent) return;
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) +
      "; expires=" + expires + "; path=/; SameSite=Lax";
  },
  get(name) {
    const target = encodeURIComponent(name) + "=";
    for (const part of document.cookie.split(";")) {
      const p = part.trim();
      if (p.startsWith(target)) return decodeURIComponent(p.slice(target.length));
    }
    return null;
  }
};

const STORAGE = {
  bookmarks: "veil_bookmarks",
  settings: "veil_settings",
  cloak: "veil_cloak",
  panic: "veil_panic"
};

function save() {
  if (!COOKIE.consent) return;
  try {
    COOKIE.set(STORAGE.bookmarks, JSON.stringify(bookmarks));
    COOKIE.set(STORAGE.settings, JSON.stringify(settings));
    COOKIE.set(STORAGE.cloak, JSON.stringify(cloak));
    COOKIE.set(STORAGE.panic, JSON.stringify(panic));
  } catch (e) {
    console.warn("[Veil] save failed", e);
  }
}

function loadSavedData() {
  try {
    const b = COOKIE.get(STORAGE.bookmarks);
    const s = COOKIE.get(STORAGE.settings);
    const c = COOKIE.get(STORAGE.cloak);
    const p = COOKIE.get(STORAGE.panic);
    if (b) bookmarks = JSON.parse(b) || [];
    if (s) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
    if (c) cloak = { ...cloak, ...JSON.parse(c) };
    if (p) panic = { ...DEFAULT_PANIC, ...JSON.parse(p) };
  } catch (e) {
    console.warn("[Veil] load failed", e);
  }
}

/* =========================================================
   Theme / CSS
   ========================================================= */
function applyCSSVariables() {
  const root = document.documentElement;
  ["bg", "bg2", "bg3", "panel", "panel2", "border", "text", "muted", "accent", "accentText", "newtab"]
    .forEach(k => root.style.setProperty("--" + k, settings[k]));
}

function applyNewTabBackground() {
  document.querySelectorAll(".newtab-page").forEach(el => {
    el.style.backgroundImage = settings.backgroundUrl
      ? 'url("' + settings.backgroundUrl.replace(/"/g, "%22") + '")'
      : "none";
  });
}

/* =========================================================
   Engine (Scramjet + BareMux + multi Wisp)
   ========================================================= */
function getWispList() {
  const list = [];
  if (settings.customWisp && settings.customWisp.trim()) {
    list.push(settings.customWisp.trim());
  }
  DEFAULT_WISP_SERVERS.forEach(s => {
    if (!list.includes(s)) list.push(s);
  });
  return list;
}

async function trySetTransport(mux, transportModule, wispUrl) {
  await mux.setTransport(transportModule, [{ wisp: wispUrl }]);
  return true;
}

async function initEngine() {
  if (engineInitPromise) return engineInitPromise;

  engineInitPromise = (async () => {
    const status = document.getElementById("engineStatus");
    try {
      if (!window.BareMux) await loadScript(BAREMUX_SCRIPT);
      if (!window.$scramjetLoadController && !window.ScramjetController) {
        await loadScript(SCRAMJET_FILES.all);
      }
      if (!("serviceWorker" in navigator)) throw new Error("Service workers unavailable.");

      await navigator.serviceWorker.register(REPO_PATH + "sw.js", { scope: SCRAMJET_PREFIX });

      if (!window.BareMux) throw new Error("BareMux did not load.");

      const mux = new BareMux.BareMuxConnection(BAREMUX_WORKER);
      const transportModule = (settings.transport === "libcurl") ? LIBCURL_MODULE : EPOXY_MODULE;
      const servers = getWispList();

      let connected = false;
      let lastErr = null;
      for (const wisp of servers) {
        try {
          await trySetTransport(mux, transportModule, wisp);
          activeWisp = wisp;
          connected = true;
          break;
        } catch (err) {
          lastErr = err;
          console.warn("[Veil] Wisp failed:", wisp, err);
        }
      }
      if (!connected) {
        throw lastErr || new Error("No Wisp servers reachable");
      }

      if (typeof window.$scramjetLoadController === "function") {
        const loaded = window.$scramjetLoadController();
        const Controller = loaded && loaded.ScramjetController;
        if (!Controller) throw new Error("ScramjetController not found.");
        engineController = new Controller({ files: SCRAMJET_FILES, prefix: SCRAMJET_PREFIX });
        if (typeof engineController.init === "function") await engineController.init();
      } else if (typeof window.ScramjetController === "function") {
        engineController = new window.ScramjetController({ files: SCRAMJET_FILES, prefix: SCRAMJET_PREFIX });
        if (typeof engineController.init === "function") await engineController.init();
      } else {
        throw new Error("Scramjet controller unavailable.");
      }

      engineReady = true;
      const shortWisp = activeWisp.replace(/^wss?:\/\//, "").split("/")[0];
      if (status) {
        status.textContent = "Ready • " +
          (settings.transport === "libcurl" ? "Libcurl" : "Epoxy") +
          " • " + shortWisp;
      }
      return true;
    } catch (error) {
      console.error("[Veil] Engine init failed", error);
      engineReady = false;
      if (status) {
        status.textContent = "Engine error • " + (error.message || "check files / Wisp");
      }
      return false;
    }
  })();

  return engineInitPromise;
}

/**
 * Create a Scramjet frame for a tab. Frames stay alive for the life of the tab.
 */
async function createEngineFrame(page) {
  if (!engineReady) await initEngine();
  if (!engineReady) {
    return showFrameError(page, "Browser engine unavailable. Check scramjet/, baremux/, and sw.js.");
  }

  const container = page.frameEl;
  if (!container) return;
  container.innerHTML = "";

  try {
    let frameObj = null;
    if (engineController && typeof engineController.createFrame === "function") {
      frameObj = engineController.createFrame();
    }

    if (frameObj) {
      const frame = frameObj.element || frameObj.frame || frameObj;
      if (frame && frame.classList) frame.classList.add("engine-frame");
      if (frame && frame.style) {
        frame.style.width = "100%";
        frame.style.height = "100%";
        frame.style.border = "0";
        frame.style.display = "block";
      }
      container.appendChild(frame);
      page.engineFrame = frameObj;

      const target = page.url;
      if (target) {
        if (typeof frameObj.go === "function") {
          frameObj.go(target);
        } else if (typeof frameObj.navigate === "function") {
          frameObj.navigate(target);
        } else if (frame instanceof HTMLIFrameElement) {
          frame.src = proxySrc(target);
        }
      }

      attachFrameListeners(page, frame);
      return;
    }

    throw new Error("Scramjet frame API unavailable.");
  } catch (e) {
    console.error("[Veil] createEngineFrame", e);
    showFrameError(page, e.message || "Could not open this page");
  }
}

function showFrameError(page, message) {
  if (!page.frameEl) return;
  page.frameEl.innerHTML =
    '<div class="engine-error"><div class="engine-error-box">' +
    "<h2>Could not open this page</h2>" +
    "<p>" + escapeHTML(message) + "</p>" +
    '<button data-retry-engine type="button">Retry</button></div></div>';
  const btn = page.frameEl.querySelector("[data-retry-engine]");
  if (btn) {
    btn.onclick = async () => {
      engineInitPromise = null;
      engineReady = false;
      await createEngineFrame(page);
    };
  }
}

function attachFrameListeners(page, frame) {
  try {
    if (!(frame instanceof HTMLIFrameElement)) return;
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        const t = doc.title;
        if (t && t.trim()) {
          page.title = t.trim().slice(0, 80);
          renderTabsOnly();
        }
        const link = doc.querySelector('link[rel*="icon"]');
        if (link && link.href) {
          page.favicon = link.href;
          renderTabsOnly();
        }
      } catch (_) {}
    });
  } catch (_) {}
}

/* =========================================================
   Tab management — persistent pages
   ========================================================= */
function createTab(newTab = true) {
  if (tabs.length >= MAX_TABS) return null;

  const tab = {
    id: uid(),
    title: newTab ? "New Tab" : "Veil",
    url: "",
    history: [],
    historyIndex: -1,
    newTab: !!newTab,
    favicon: null,
    pageEl: null,
    frameEl: null,
    engineFrame: null
  };

  tabs.push(tab);
  activeTabId = tab.id;
  ensurePageElement(tab);
  showActivePage();
  renderTabsOnly();
  renderToolbar();
  return tab;
}

function ensurePageElement(tab) {
  const viewport = document.getElementById("viewport");
  if (tab.pageEl && document.body.contains(tab.pageEl)) return;

  const section = document.createElement("section");
  section.className = "page";
  section.dataset.pageId = tab.id;

  if (tab.newTab) {
    section.innerHTML = homepageHTML(tab.id);
  } else {
    const frame = document.createElement("div");
    frame.className = "engine-container";
    frame.dataset.engineContainer = tab.id;
    section.appendChild(frame);
    tab.frameEl = frame;
  }

  viewport.appendChild(section);
  tab.pageEl = section;
  wireHomepageEvents(section, tab);
  applyNewTabBackground();
}

function wireHomepageEvents(section, tab) {
  section.querySelectorAll(".newtab-search").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        activeTabId = tab.id;
        navigate(input.value);
      }
    });
  });
  section.querySelectorAll(".quick-link[data-url]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTabId = tab.id;
      navigate(btn.dataset.url);
    });
  });
  const lob = section.querySelector("[data-launch-options]");
  if (lob) {
    lob.onclick = () => openLaunchModal();
  }
}

function showActivePage() {
  tabs.forEach(t => {
    if (!t.pageEl) return;
    if (t.id === activeTabId) {
      t.pageEl.classList.add("active");
      t.pageEl.style.display = "block";
    } else {
      t.pageEl.classList.remove("active");
      t.pageEl.style.display = "none";
    }
  });
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index < 0) return;

  const tab = tabs[index];
  if (tab.pageEl) {
    tab.pageEl.remove();
    tab.pageEl = null;
  }
  tab.engineFrame = null;
  tab.frameEl = null;

  tabs.splice(index, 1);

  if (!tabs.length) {
    createTab(true);
    return;
  }
  if (activeTabId === id) {
    activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
  }
  showActivePage();
  renderTabsOnly();
  renderToolbar();
}

function switchTab(id) {
  if (activeTabId === id) return;
  const tab = getTab(id);
  if (!tab) return;
  activeTabId = id;
  showActivePage();
  renderTabsOnly();
  renderToolbar();
}

/* =========================================================
   Navigation
   ========================================================= */
async function navigate(raw) {
  const page = getTab();
  if (!page) return;

  const value = normalizeUrl(raw);
  if (!value) return;

  if (page.historyIndex < page.history.length - 1) {
    page.history = page.history.slice(0, page.historyIndex + 1);
  }
  page.history.push(value);
  page.historyIndex = page.history.length - 1;
  page.url = value;
  page.newTab = false;

  try {
    page.title = new URL(value).hostname.replace(/^www\./, "");
  } catch {
    page.title = "Veil";
  }
  page.favicon = null;

  if (page.pageEl && page.pageEl.querySelector(".newtab-page")) {
    page.pageEl.innerHTML = "";
    const frame = document.createElement("div");
    frame.className = "engine-container";
    frame.dataset.engineContainer = page.id;
    page.pageEl.appendChild(frame);
    page.frameEl = frame;
  }

  ensurePageElement(page);
  showActivePage();
  renderTabsOnly();
  renderToolbar();

  await createEngineFrame(page);
}

async function navigateExisting(page) {
  if (!page) return;
  if (page.engineFrame && typeof page.engineFrame.go === "function") {
    try {
      page.engineFrame.go(page.url);
      return;
    } catch (e) {
      console.warn("[Veil] frame.go failed, recreating", e);
    }
  }
  await createEngineFrame(page);
}

async function goBack() {
  const p = getTab();
  if (!p || p.historyIndex <= 0) return;
  p.historyIndex--;
  p.url = p.history[p.historyIndex];
  p.newTab = false;
  try { p.title = new URL(p.url).hostname.replace(/^www\./, ""); } catch { p.title = "Veil"; }
  renderTabsOnly();
  renderToolbar();
  await navigateExisting(p);
}

async function goForward() {
  const p = getTab();
  if (!p || p.historyIndex >= p.history.length - 1) return;
  p.historyIndex++;
  p.url = p.history[p.historyIndex];
  p.newTab = false;
  try { p.title = new URL(p.url).hostname.replace(/^www\./, ""); } catch { p.title = "Veil"; }
  renderTabsOnly();
  renderToolbar();
  await navigateExisting(p);
}

function reload() {
  const p = getTab();
  if (!p || !p.url) return;
  if (p.engineFrame && typeof p.engineFrame.reload === "function") {
    try { p.engineFrame.reload(); return; } catch (_) {}
  }
  if (p.engineFrame && p.engineFrame.frame instanceof HTMLIFrameElement) {
    try {
      p.engineFrame.frame.contentWindow.location.reload();
      return;
    } catch (_) {}
  }
  navigateExisting(p);
}

function goHome() {
  const p = getTab();
  if (!p) {
    createTab(true);
    return;
  }
  p.newTab = true;
  p.url = "";
  p.title = "New Tab";
  p.favicon = null;
  p.engineFrame = null;
  if (p.pageEl) {
    p.pageEl.innerHTML = homepageHTML(p.id);
    p.frameEl = null;
    wireHomepageEvents(p.pageEl, p);
    applyNewTabBackground();
  }
  showActivePage();
  renderTabsOnly();
  renderToolbar();
}

/* =========================================================
   Rendering (tabs + toolbar only — pages stay alive)
   ========================================================= */
function tabIconHTML(tab) {
  const src = tab.favicon || FAVI;
  return '<img src="' + escapeHTML(src) + '" alt="" onerror="this.src=\'' + FAVI + '\'">';
}

function renderTabsOnly() {
  const c = document.getElementById("tabs");
  if (!c) return;

  c.innerHTML = tabs.map(tab =>
    '<div class="tab' + (tab.id === activeTabId ? " active" : "") + '" data-tab-id="' + tab.id + '">' +
    '<div class="tab-icon">' + tabIconHTML(tab) + '</div>' +
    '<div class="tab-title">' + escapeHTML(tab.title) + '</div>' +
    '<button class="tab-close" data-close="' + tab.id + '" aria-label="Close">×</button></div>'
  ).join("");

  c.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".tab-close")) return;
      switchTab(el.dataset.tabId);
    });
  });
  c.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      closeTab(btn.dataset.close);
    });
  });
}

function renderToolbar() {
  const page = getTab();
  const address = document.getElementById("address");
  if (address) address.value = page && page.url ? page.url : "";

  const back = document.getElementById("backBtn");
  const fwd = document.getElementById("forwardBtn");
  if (back) back.disabled = !page || page.historyIndex <= 0;
  if (fwd) fwd.disabled = !page || page.historyIndex >= page.history.length - 1;

  const b = document.getElementById("bookmarkBtn");
  if (b) {
    if (page && page.url && isBookmarked(page.url)) b.classList.add("saved");
    else b.classList.remove("saved");
  }
}

function homepageHTML(pageId) {
  return (
    '<div class="newtab-page"><div class="newtab-overlay"><div class="newtab-center">' +
    '<div class="veil-mark"><img src="' + FAVI + '" alt="Veil"></div>' +
    '<div class="newtab-title">Veil</div>' +
    '<div class="search-box"><span class="home-search-icon"></span>' +
    '<input class="newtab-search" data-page="' + pageId + '" placeholder="Browse the web freely…" autocomplete="off" spellcheck="false"></div>' +
    '<div class="quick-links">' +
    '<button class="quick-link" title="X" data-url="https://x.com">' + imgIcon("x.svg") + "</button>" +
    '<button class="quick-link" title="Discord" data-url="https://discord.com/">' + imgIcon("discord.svg") + "</button>" +
    '<button class="quick-link" title="Reddit" data-url="https://www.reddit.com/">' + imgIcon("reddit.svg") + "</button>" +
    '<button class="quick-link" title="GeForce NOW" data-url="https://play.geforcenow.com/mall">' + imgIcon("nvidia.svg") + "</button>" +
    "</div>" +
    '<div class="quick-links row2">' +
    '<button class="quick-link soon" title="Games (soon)" data-soon="1"><svg viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg></button>' +
    '<button class="quick-link soon" title="Utilities (soon)" data-soon="1"><svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></button>' +
    "</div>" +
    '<button class="launch-btn" data-launch-options type="button">Launch Options…</button>' +
    "</div></div>" +
    '<div class="time-bar" id="timeBar">Time Remaining: — (auth coming soon)</div></div>'
  );
}

function imgIcon(name) {
  return '<img src="' + IMG + name + '" alt="">';
}

/* =========================================================
   Bookmarks
   ========================================================= */
function toggleBookmark() {
  const p = getTab();
  if (!p || !p.url) return;
  if (bookmarks.some(b => b.url === p.url)) {
    bookmarks = bookmarks.filter(b => b.url !== p.url);
  } else {
    bookmarks.push({ id: uid(), title: p.title || p.url, url: p.url });
  }
  save();
  renderToolbar();
  renderBookmarks();
}

function renderBookmarks() {
  const list = document.getElementById("bookmarkList");
  if (!list) return;
  if (!bookmarks.length) {
    list.innerHTML = '<div class="empty">No bookmarks yet.</div>';
    return;
  }
  list.innerHTML = bookmarks.map(b =>
    '<div class="bookmark-row"><div class="bookmark-main" data-open-bookmark="' + escapeHTML(b.url) + '">' +
    '<div class="bookmark-title">' + escapeHTML(b.title) + "</div>" +
    '<div class="bookmark-url">' + escapeHTML(b.url) + "</div></div>" +
    '<button class="bookmark-delete" data-delete-bookmark="' + escapeHTML(b.id) + '">×</button></div>'
  ).join("");

  list.querySelectorAll("[data-open-bookmark]").forEach(el => {
    el.onclick = () => {
      closePanels();
      navigate(el.dataset.openBookmark);
    };
  });
  list.querySelectorAll("[data-delete-bookmark]").forEach(el => {
    el.onclick = () => {
      bookmarks = bookmarks.filter(b => b.id !== el.dataset.deleteBookmark);
      save();
      renderBookmarks();
      renderToolbar();
    };
  });
}

/* =========================================================
   Panels / menus
   ========================================================= */
function openPanel(id) {
  closeMenu();
  document.getElementById("backdrop").classList.add("open");
  document.getElementById(id).classList.add("open");
}

function closePanels() {
  document.getElementById("backdrop").classList.remove("open");
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("open"));
}

function closeMenu() {
  document.getElementById("mainMenu").classList.remove("open");
}

/* =========================================================
   Settings helpers
   ========================================================= */
function loadColorInputs() {
  const el = id => document.getElementById(id);
  if (el("colorBg")) el("colorBg").value = settings.bg;
  if (el("colorPanel")) el("colorPanel").value = settings.panel;
  if (el("colorAccent")) el("colorAccent").value = settings.accent;
  if (el("colorText")) el("colorText").value = settings.text;
  if (el("backgroundUrl")) el("backgroundUrl").value = settings.backgroundUrl || "";
  if (el("customWisp")) el("customWisp").value = settings.customWisp || "";
  if (el("aboutBlankMode")) el("aboutBlankMode").value = settings.aboutBlankMode || "manual";
}

function loadCloakInputs() {
  const el = id => document.getElementById(id);
  if (el("cloakTitle")) el("cloakTitle").value = cloak.title || "";
  if (el("cloakIcon")) el("cloakIcon").value = cloak.icon || "";
}

function loadPanicInputs() {
  const el = id => document.getElementById(id);
  if (el("panicKey")) el("panicKey").value = panic.key ? ("Bound: " + panic.key) : "Not bound";
  if (el("panicUrl")) el("panicUrl").value = panic.url || "";
}

function highlightTheme() {
  document.querySelectorAll("[data-theme]").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === settings.theme);
  });
  const customCard = document.getElementById("customThemeCard");
  if (customCard) customCard.classList.toggle("active", settings.theme === "custom");

  const epoxy = document.getElementById("transportEpoxy");
  const libcurl = document.getElementById("transportLibcurl");
  if (epoxy) epoxy.classList.toggle("active", settings.transport !== "libcurl");
  if (libcurl) libcurl.classList.toggle("active", settings.transport === "libcurl");
}

function setTheme(name) {
  if (!THEMES[name]) return;
  const transport = settings.transport;
  settings = Object.assign({}, settings, THEMES[name], { theme: name, transport });
  const editor = document.getElementById("customColorCard");
  if (editor) editor.classList.remove("open", "force-open");
  applyCSSVariables();
  save();
  highlightTheme();
}

function applyCustomColors() {
  settings.bg = document.getElementById("colorBg").value;
  settings.panel = document.getElementById("colorPanel").value;
  settings.accent = document.getElementById("colorAccent").value;
  settings.text = document.getElementById("colorText").value;
  settings.theme = "custom";
  settings.newtab = settings.bg;
  settings.bg2 = settings.bg;
  settings.bg3 = settings.panel;
  settings.panel2 = settings.panel;
  applyCSSVariables();
  save();
  highlightTheme();
}

function applyBackground() {
  settings.backgroundUrl = document.getElementById("backgroundUrl").value.trim();
  save();
  applyNewTabBackground();
}

function applyCloak() {
  cloak.title = document.getElementById("cloakTitle").value.trim() || "Veil";
  cloak.icon = document.getElementById("cloakIcon").value.trim() || FAVI;
  document.title = cloak.title;
  document.getElementById("favicon").href = cloak.icon;
  save();
}

function applyCloakPreset(preset) {
  cloak.title = preset.title;
  cloak.icon = preset.icon;
  document.title = cloak.title;
  document.getElementById("favicon").href = cloak.icon;
  loadCloakInputs();
  save();
}

function resetSettings() {
  settings = Object.assign({}, DEFAULT_SETTINGS);
  panic = Object.assign({}, DEFAULT_PANIC);
  cloak = { title: "Veil", icon: FAVI };
  document.title = "Veil";
  document.getElementById("favicon").href = FAVI;
  applyCSSVariables();
  save();
  loadColorInputs();
  loadCloakInputs();
  loadPanicInputs();
  highlightTheme();
  applyNewTabBackground();
}

async function setTransport(kind) {
  settings.transport = kind === "libcurl" ? "libcurl" : "epoxy";
  save();
  highlightTheme();
  engineReady = false;
  engineController = null;
  engineInitPromise = null;
  const status = document.getElementById("engineStatus");
  if (status) status.textContent = "Switching transport…";
  await initEngine();
}

function applyCustomWisp() {
  settings.customWisp = (document.getElementById("customWisp") || {}).value.trim() || "";
  save();
  engineReady = false;
  engineController = null;
  engineInitPromise = null;
  const status = document.getElementById("engineStatus");
  if (status) status.textContent = "Wisp updated — will reconnect on next load";
}

function applyAboutBlankMode() {
  const sel = document.getElementById("aboutBlankMode");
  if (sel) {
    settings.aboutBlankMode = sel.value === "auto" ? "auto" : "manual";
    save();
  }
}

/* =========================================================
   About:blank launcher (improved)
   ========================================================= */
function openLaunchModal() {
  const modal = document.getElementById("aboutBlankModal");
  if (modal) modal.classList.add("open");
}

function closeLaunchModal() {
  const modal = document.getElementById("aboutBlankModal");
  if (modal) modal.classList.remove("open");
}

function openAboutBlank(mode) {
  closeLaunchModal();
  const appUrl = location.origin + REPO_PATH;

  const w = window.open("about:blank", "_blank");
  if (!w) {
    alert("Popup blocked — allow popups for this site.");
    return;
  }
  w.document.open();
  w.document.write(
    '<!DOCTYPE html><html><head><title> </title>' +
    "<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:#111}</style>" +
    '</head><body><iframe src="' + appUrl + '" allow="fullscreen; clipboard-read; clipboard-write"></iframe></body></html>'
  );
  w.document.close();
}

/* =========================================================
   Rename (menu only)
   ========================================================= */
function renameCurrentTab(id) {
  if (id === undefined) id = activeTabId;
  const p = getTab(id);
  if (!p) return;
  const name = prompt("Tab name:", p.title);
  if (name && name.trim()) {
    p.title = name.trim();
    renderTabsOnly();
  }
}

/* =========================================================
   Cookie consent
   ========================================================= */
function showCookieConsent() {
  const overlay = document.createElement("div");
  overlay.className = "cookie-overlay";
  overlay.innerHTML =
    '<div class="cookie-box"><h2>Allow cookies?</h2>' +
    "<p>Veil can remember bookmarks, theme, cloak, and panic key.<br><br>" +
    "Choose No to browse without saving preferences.</p>" +
    '<div class="cookie-buttons">' +
    '<button class="cookie-no" id="cookieNo">No</button>' +
    '<button class="cookie-yes" id="cookieYes">Yes</button></div></div>';
  document.body.appendChild(overlay);

  document.getElementById("cookieYes").onclick = () => {
    COOKIE.consent = true;
    COOKIE.set("veil_cookie_consent", "yes");
    loadSavedData();
    save();
    overlay.remove();
    applyCSSVariables();
    document.title = cloak.title || "Veil";
    document.getElementById("favicon").href = cloak.icon || FAVI;
    loadColorInputs();
    loadCloakInputs();
    loadPanicInputs();
    highlightTheme();
  };
  document.getElementById("cookieNo").onclick = () => {
    COOKIE.consent = false;
    overlay.remove();
  };
}

/* =========================================================
   Wire UI once
   ========================================================= */
function wireUI() {
  document.getElementById("newTabBtn").onclick = () => createTab(true);
  document.getElementById("backBtn").onclick = goBack;
  document.getElementById("forwardBtn").onclick = goForward;
  document.getElementById("refreshBtn").onclick = reload;
  document.getElementById("homeBtn").onclick = goHome;
  document.getElementById("bookmarksOpenBtn").onclick = () => openPanel("bookmarksPanel");
  document.getElementById("settingsOpenBtn").onclick = () => openPanel("settingsPanel");
  document.getElementById("bookmarkBtn").onclick = toggleBookmark;

  document.getElementById("address").addEventListener("keydown", e => {
    if (e.key === "Enter") navigate(e.target.value);
  });

  document.getElementById("menuBtn").onclick = e => {
    e.stopPropagation();
    document.getElementById("mainMenu").classList.toggle("open");
  };
  document.getElementById("menuNewTab").onclick = () => { closeMenu(); createTab(true); };
  document.getElementById("menuBookmark").onclick = () => { toggleBookmark(); closeMenu(); };
  document.getElementById("menuBookmarks").onclick = () => openPanel("bookmarksPanel");
  document.getElementById("menuRename").onclick = () => { closeMenu(); renameCurrentTab(); };
  document.getElementById("menuSettings").onclick = () => openPanel("settingsPanel");
  document.getElementById("menuAboutBlank").onclick = () => { closeMenu(); openLaunchModal(); };

  const abTab = document.getElementById("abOpenTab");
  const abWin = document.getElementById("abOpenWindow");
  const abCancel = document.getElementById("abCancel");
  if (abTab) abTab.onclick = () => openAboutBlank("tab");
  if (abWin) abWin.onclick = () => openAboutBlank("window");
  if (abCancel) abCancel.onclick = closeLaunchModal;

  document.querySelectorAll("[data-theme]").forEach(btn => {
    btn.onclick = () => setTheme(btn.dataset.theme);
  });
  const customThemeCard = document.getElementById("customThemeCard");
  if (customThemeCard) {
    customThemeCard.onclick = () => {
      const editor = document.getElementById("customColorCard");
      if (editor) editor.classList.toggle("open");
    };
  }
  const applyColors = document.getElementById("applyColors");
  if (applyColors) applyColors.onclick = applyCustomColors;
  const applyBg = document.getElementById("applyBackground");
  if (applyBg) applyBg.onclick = applyBackground;
  const applyCloakBtn = document.getElementById("applyCloak");
  if (applyCloakBtn) applyCloakBtn.onclick = applyCloak;

  document.querySelectorAll("[data-cloak-preset]").forEach(btn => {
    btn.onclick = () => {
      const name = btn.dataset.cloakPreset;
      const preset = CLOAK_PRESETS.find(p => p.name === name);
      if (preset) applyCloakPreset(preset);
    };
  });

  document.getElementById("bindPanic").onclick = () => {
    bindingPanic = true;
    document.getElementById("panicKey").value = "Press any key…";
  };
  document.getElementById("unbindPanic").onclick = () => {
    panic = {
      key: "",
      code: "",
      url: document.getElementById("panicUrl").value.trim() || DEFAULT_PANIC.url
    };
    save();
    loadPanicInputs();
  };

  document.getElementById("transportEpoxy").onclick = () => setTransport("epoxy");
  document.getElementById("transportLibcurl").onclick = () => setTransport("libcurl");

  const applyWisp = document.getElementById("applyWisp");
  if (applyWisp) applyWisp.onclick = applyCustomWisp;

  const aboutBlankMode = document.getElementById("aboutBlankMode");
  if (aboutBlankMode) aboutBlankMode.onchange = applyAboutBlankMode;

  const resetBtn = document.getElementById("resetSettings");
  if (resetBtn) resetBtn.onclick = resetSettings;

  document.querySelectorAll("[data-close-panel]").forEach(btn => {
    btn.onclick = closePanels;
  });
  document.getElementById("backdrop").onclick = closePanels;

  document.addEventListener("click", e => {
    if (!e.target.closest("#mainMenu") && !e.target.closest("#menuBtn")) closeMenu();
  });

  document.addEventListener("keydown", e => {
    if (bindingPanic) {
      e.preventDefault();
      e.stopPropagation();
      bindingPanic = false;
      if (e.key === "Escape") {
        loadPanicInputs();
        return;
      }
      panic.key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      panic.code = e.code;
      panic.url = document.getElementById("panicUrl").value.trim() || DEFAULT_PANIC.url;
      save();
      loadPanicInputs();
      return;
    }

    if (panic.code && !isTypingTarget(e.target)) {
      if (e.code === panic.code || e.key === panic.key) {
        e.preventDefault();
        location.href = panic.url || DEFAULT_PANIC.url;
        return;
      }
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "l") {
      e.preventDefault();
      document.getElementById("address").focus();
      document.getElementById("address").select();
    }
    if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); createTab(true); }
    if (mod && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); toggleBookmark(); }
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goForward(); }
    if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); reload(); }
  }, true);

  window.addEventListener("beforeunload", () => {
    if (COOKIE.consent) save();
  });
}

/* =========================================================
   Boot
   ========================================================= */
(async function init() {
  settings = { ...DEFAULT_SETTINGS };
  panic = { ...DEFAULT_PANIC };

  const consent = COOKIE.get("veil_cookie_consent");
  if (consent === "yes") {
    COOKIE.consent = true;
    loadSavedData();
  }

  if (!cloak.icon) cloak.icon = FAVI;
  applyCSSVariables();
  document.title = cloak.title || "Veil";
  document.getElementById("favicon").href = cloak.icon || FAVI;

  wireUI();
  loadColorInputs();
  loadCloakInputs();
  loadPanicInputs();
  highlightTheme();

  createTab(true);
  initEngine();

  if (settings.aboutBlankMode === "auto" && window.self === window.top) {
    setTimeout(() => openAboutBlank("tab"), 400);
  }

  if (consent !== "yes") showCookieConsent();
})();
