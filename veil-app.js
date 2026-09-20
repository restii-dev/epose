"use strict";

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
const DEFAULT_WISP = "wss://wisp-backend-weyl.onrender.com/";
const MAX_TABS = 20;

const WISP_PRESETS = [
  { id: "default", name: "Default (Render)", url: DEFAULT_WISP },
  { id: "custom", name: "Custom…", url: "" }
];

const CLOAK_PRESETS = {
  docs: { title: "Google Docs", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" },
  classroom: { title: "Google Classroom", icon: "https://ssl.gstatic.com/classroom/favicon.png" },
  drive: { title: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png" },
  canvas: { title: "Dashboard", icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico" },
  veil: { title: "Veil", icon: FAVI }
};

let engineReady = false;
let engineController = null;
let engineInitPromise = null;
let muxConnection = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

/** Libcurl requires a trailing slash on the Wisp URL. */
function normalizeWispUrl(url) {
  const u = String(url || "").trim();
  if (!u) return DEFAULT_WISP;
  return u.endsWith("/") ? u : u + "/";
}

function currentWisp() {
  let url;
  if (settings.wispId === "custom" && settings.wispCustom) url = settings.wispCustom.trim();
  else {
    const preset = WISP_PRESETS.find((w) => w.id === settings.wispId);
    url = (preset && preset.url) || DEFAULT_WISP;
  }
  return normalizeWispUrl(url);
}

function transportModule() {
  return settings.transport === "libcurl" ? LIBCURL_MODULE : EPOXY_MODULE;
}

async function applyMuxTransport() {
  if (!muxConnection) muxConnection = new BareMux.BareMuxConnection(BAREMUX_WORKER);
  await muxConnection.setTransport(transportModule(), [{ wisp: currentWisp() }]);
}

/** Wipe a broken/empty $scramjet IndexedDB so init can recreate stores. */
function deleteScramjetDB() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase("$scramjet");
      const done = () => resolve(true);
      req.onsuccess = done;
      req.onerror = done;
      req.onblocked = done;
      setTimeout(done, 1500);
    } catch {
      resolve(false);
    }
  });
}

async function createController() {
  if (typeof window.$scramjetLoadController === "function") {
    const loaded = window.$scramjetLoadController();
    const Controller = loaded && loaded.ScramjetController;
    if (!Controller) throw new Error("ScramjetController not found.");
    engineController = new Controller({ files: SCRAMJET_FILES, prefix: SCRAMJET_PREFIX });
  } else if (typeof window.ScramjetController === "function") {
    engineController = new window.ScramjetController({ files: SCRAMJET_FILES, prefix: SCRAMJET_PREFIX });
  } else {
    throw new Error("Scramjet controller unavailable.");
  }
  if (typeof engineController.init === "function") {
    try {
      await engineController.init();
    } catch (err) {
      const msg = String(err && err.message || err);
      if (/object stores was not found|NotFoundError|IDBDatabase|Failed to execute 'transaction'/i.test(msg)) {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: "veil-reset-db" });
        }
        await deleteScramjetDB();
        await new Promise((r) => setTimeout(r, 300));
        await engineController.init();
      } else {
        throw err;
      }
    }
  }
}

async function registerServiceWorker() {
  // Wipe corrupt DB *before* the SW opens it
  await deleteScramjetDB();
  const reg = await navigator.serviceWorker.register(REPO_PATH + "sw.js?v=3", {
    scope: SCRAMJET_PREFIX,
    updateViaCache: "none"
  });
  try { await reg.update(); } catch {}
  await navigator.serviceWorker.ready;
  if (reg.active) {
    reg.active.postMessage({ type: "veil-reset-db" });
  }
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
      if (!window.BareMux) throw new Error("BareMux did not load.");

      if (status) status.textContent = "Resetting Scramjet DB…";
      await registerServiceWorker();

      if (status) status.textContent = "Connecting transport…";
      await applyMuxTransport();

      if (status) status.textContent = "Starting controller…";
      await createController();

      engineReady = true;
      status.textContent = "Ready • " + (settings.transport === "libcurl" ? "Libcurl" : "Epoxy") + " • " + currentWisp();
      return true;
    } catch (error) {
      console.error(error);
      status.textContent = "Engine error • " + (error.message || "check scramjet/baremux/libcurl files");
      engineInitPromise = null;
      engineReady = false;
      engineController = null;
      return false;
    }
  })();
  return engineInitPromise;
}

async function reconnectTransport() {
  try {
    await applyMuxTransport();
    const status = document.getElementById("engineStatus");
    if (status) status.textContent = "Reconnected • " + (settings.transport === "libcurl" ? "Libcurl" : "Epoxy");
  } catch (e) {
    console.warn("reconnect failed", e);
  }
}

const THEMES = {
  matte: { bg: "#101010", bg2: "#151515", bg3: "#1b1b1b", panel: "#181818", panel2: "#202020", border: "#2b2b2b", text: "#f2f2f2", muted: "#888888", accent: "#ffffff", accentText: "#111111", newtab: "#101010" },
  ember: { bg: "#1a0a0a", bg2: "#220e0e", bg3: "#3a1212", panel: "#2a1010", panel2: "#401818", border: "#5a2020", text: "#ffeaea", muted: "#b88888", accent: "#ff4d4d", accentText: "#1a0505", newtab: "#1a0a0a" },
  sunlight: { bg: "#191108", bg2: "#211609", bg3: "#32200c", panel: "#281a0a", panel2: "#3a250e", border: "#513716", text: "#fff8eb", muted: "#bca783", accent: "#ffb84d", accentText: "#241303", newtab: "#191108" },
  forest: { bg: "#0b140e", bg2: "#101b13", bg3: "#17291b", panel: "#132219", panel2: "#1b3020", border: "#29452f", text: "#effff1", muted: "#8da993", accent: "#73c982", accentText: "#071109", newtab: "#0b140e" },
  moonlight: { bg: "#080b12", bg2: "#0d111b", bg3: "#121827", panel: "#101521", panel2: "#171e2d", border: "#263047", text: "#eef3ff", muted: "#8490a7", accent: "#7aa2ff", accentText: "#08101f", newtab: "#080b12" },
  twilight: { bg: "#110d1a", bg2: "#171122", bg3: "#241936", panel: "#1c142b", panel2: "#2b1d40", border: "#412c5c", text: "#f7f0ff", muted: "#a89ab8", accent: "#b88cff", accentText: "#160c24", newtab: "#110d1a" },
  sakura: { bg: "#190e14", bg2: "#21111a", bg3: "#321725", panel: "#28131e", panel2: "#3a1b29", border: "#512538", text: "#fff0f6", muted: "#b991a3", accent: "#ff8fba", accentText: "#250b16", newtab: "#190e14" }
};

const DEFAULT_SETTINGS = {
  theme: "matte", transport: "epoxy", wispId: "default", wispCustom: "",
  launchMode: "manual", backgroundUrl: "", ...THEMES.matte
};
const DEFAULT_PANIC = { key: "", code: "", url: "https://classroom.google.com" };

let settings = { ...DEFAULT_SETTINGS };
let panic = { ...DEFAULT_PANIC };
let bookmarks = [];
let cloak = { title: "Veil", icon: FAVI };
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let bindingPanic = false;

const COOKIE = {
  consent: false,
  set(name, value, days = 365) {
    if (!this.consent) return;
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/; SameSite=Lax";
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
const STORAGE = { bookmarks: "veil_bookmarks", settings: "veil_settings", cloak: "veil_cloak", panic: "veil_panic" };

function uid() { return "tab_" + Date.now().toString(36) + "_" + (++tabCounter).toString(36); }
function escapeHTML(v) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  };
  return String(v ?? "").replace(/[&<>"']/g, function (m) { return map[m]; });
}
function getTab(id = activeTabId) { return tabs.find(t => t.id === id) || null; }
function getActiveTab() { return getTab(); }
function isBookmarked(url) { return bookmarks.some(b => b.url === url); }
function faviconFor(url) {
  try {
    const host = new URL(url).hostname;
    return "https://www.google.com/s2/favicons?sz=32&domain=" + encodeURIComponent(host);
  } catch { return FAVI; }
}

function save() {
  if (!COOKIE.consent) return;
  try {
    COOKIE.set(STORAGE.bookmarks, JSON.stringify(bookmarks));
    COOKIE.set(STORAGE.settings, JSON.stringify(settings));
    COOKIE.set(STORAGE.cloak, JSON.stringify(cloak));
    COOKIE.set(STORAGE.panic, JSON.stringify(panic));
  } catch (e) { console.warn("save failed", e); }
}
function loadSavedData() {
  try {
    const b = COOKIE.get(STORAGE.bookmarks), s = COOKIE.get(STORAGE.settings);
    const c = COOKIE.get(STORAGE.cloak), p = COOKIE.get(STORAGE.panic);
    if (b) bookmarks = JSON.parse(b) || [];
    if (s) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
    if (c) cloak = { ...cloak, ...JSON.parse(c) };
    if (p) panic = { ...DEFAULT_PANIC, ...JSON.parse(p) };
  } catch (e) { console.warn("load failed", e); }
}

function applyCSSVariables() {
  const root = document.documentElement;
  ["bg", "bg2", "bg3", "panel", "panel2", "border", "text", "muted", "accent", "accentText", "newtab"]
    .forEach(k => root.style.setProperty("--" + k, settings[k]));
}
function applyNewTabBackground() {
  document.querySelectorAll(".newtab-page").forEach(el => {
    el.style.backgroundImage = settings.backgroundUrl
      ? 'url("' + settings.backgroundUrl.replace(/"/g, "%22") + '")' : "none";
  });
}

function imgIcon(name) { return '<img src="' + IMG + name + '" alt="">'; }

function normalizeUrl(input) {
  let value = String(input || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return "https://" + value;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(value);
}

function bindFrameEvents(page, frameObj) {
  const el = frameObj.element || frameObj.frame || frameObj;
  const onUrl = (e) => {
    const u = (e && (e.url || e.detail && e.detail.url)) || "";
    if (!u || u === "about:blank") return;
    page.url = u;
    try { page.title = new URL(u).hostname; } catch {}
    page.favicon = faviconFor(u);
    if (page.id === activeTabId) {
      renderTabs();
      renderToolbar();
    } else renderTabs();
  };
  if (typeof frameObj.addEventListener === "function") {
    frameObj.addEventListener("urlchange", onUrl);
  }
  if (el && el.addEventListener) {
    el.addEventListener("load", () => {
      try {
        const loc = el.contentWindow && el.contentWindow.location && el.contentWindow.location.href;
        if (loc) onUrl({ url: loc });
      } catch {}
    });
  }
}

async function createEngineFrame(page, wrapper) {
  if (!engineReady) await initEngine();
  if (!engineReady) {
    wrapper.innerHTML = '<div class="engine-error"><div class="engine-error-box"><h2>Browser engine unavailable</h2><p>Check scramjet/, baremux/, epoxy/, libcurl/, and sw.js.</p><button data-retry-engine>Retry</button></div></div>';
    wrapper.querySelector("[data-retry-engine]").onclick = async () => {
      engineInitPromise = null;
      wrapper.innerHTML = "";
      await createEngineFrame(page, wrapper);
    };
    return;
  }
  try {
    if (page.engineFrame) {
      const existing = page.engineFrame.element || page.engineFrame.frame || page.engineFrame;
      if (existing && existing.isConnected) return;
    }
    let frameObj = engineController && engineController.createFrame && engineController.createFrame();
    if (!frameObj) throw new Error("Scramjet frame API unavailable.");
    const frame = frameObj.element || frameObj.frame || frameObj;
    if (frame.classList) frame.classList.add("engine-frame");
    if (frame.style) { frame.style.width = "100%"; frame.style.height = "100%"; frame.style.border = "0"; }
    wrapper.innerHTML = "";
    wrapper.appendChild(frame);
    page.engineFrame = frameObj;
    bindFrameEvents(page, frameObj);
    await goFrame(page, page.url);
  } catch (e) {
    console.error(e);
    wrapper.innerHTML = '<div class="engine-error"><div class="engine-error-box"><h2>Could not open this page</h2><p>' + escapeHTML(e.message) + '</p><button data-retry-engine>Retry</button></div></div>';
    const btn = wrapper.querySelector("[data-retry-engine]");
    if (btn) btn.onclick = async () => { await reconnectTransport(); wrapper.innerHTML = ""; await createEngineFrame(page, wrapper); };
  }
}

async function goFrame(page, url) {
  const frameObj = page.engineFrame;
  if (!frameObj || !url) return;
  try {
    if (typeof frameObj.go === "function") await frameObj.go(url);
    else if (typeof frameObj.navigate === "function") await frameObj.navigate(url);
    else {
      const el = frameObj.element || frameObj.frame || frameObj;
      if (el instanceof HTMLIFrameElement) el.src = SCRAMJET_PREFIX + encodeURIComponent(url);
    }
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/MuxTaskEnded|Invalid URL|Failed to fetch|network/i.test(msg)) {
      await reconnectTransport();
      try {
        if (typeof frameObj.go === "function") await frameObj.go(url);
      } catch (e2) { console.warn(e2); }
    }
  }
}

function renderTabs() {
  const c = document.getElementById("tabs");
  c.innerHTML = tabs.map(tab =>
    '<div class="tab ' + (tab.id === activeTabId ? "active " : "") + (tab.animOpen ? "opening" : "") + '" data-tab-id="' + tab.id + '">' +
    '<div class="tab-icon"><img src="' + escapeHTML(tab.favicon || FAVI) + '" alt=""></div>' +
    '<div class="tab-title">' + escapeHTML(tab.title) + '</div>' +
    '<button class="tab-close" data-close="' + tab.id + '" aria-label="Close">×</button></div>'
  ).join("");
  tabs.forEach(t => { t.animOpen = false; });
  c.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".tab-close")) return;
      switchTab(el.dataset.tabId);
    });
  });
  c.querySelectorAll("[data-close]").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); closeTab(btn.dataset.close); })
  );
  requestAnimationFrame(() => { c.scrollLeft = c.scrollWidth; });
}

function homepageHTML(pageId) {
  return (
    '<div class="newtab-page"><div class="newtab-overlay"><div class="newtab-center">' +
    '<div class="veil-mark"><img src="' + FAVI + '" alt="Veil"></div>' +
    '<div class="newtab-title">Veil</div>' +
    '<div class="search-box"><span class="home-search-icon"></span><input class="newtab-search" data-page="' + pageId + '" placeholder="Browse the web freely…" autocomplete="off" spellcheck="false"></div>' +
    '<div class="quick-links">' +
    '<button class="quick-link" title="X" data-url="https://x.com">' + imgIcon("x.svg") + '</button>' +
    '<button class="quick-link" title="Discord" data-url="https://discord.com/">' + imgIcon("discord.svg") + '</button>' +
    '<button class="quick-link" title="Reddit" data-url="https://www.reddit.com/">' + imgIcon("reddit.svg") + '</button>' +
    '<button class="quick-link" title="GeForce NOW" data-url="https://play.geforcenow.com/mall">' + imgIcon("nvidia.svg") + '</button>' +
    '</div>' +
    '<div class="quick-links row2">' +
    '<button class="quick-link soon" title="Games (soon)" data-soon="1">' + imgIcon("games.svg") + '</button>' +
    '<button class="quick-link soon" title="Utilities (soon)" data-soon="1">' + imgIcon("util.svg") + '</button>' +
    '</div>' +
    '<button class="launch-btn" id="launchOptionsBtn" type="button">Launch Options…</button>' +
    '</div></div>' +
    '<div class="time-bar" id="timeBar">Time Remaining: — (auth coming soon)</div></div>'
  );
}

function wireHome(wrapper, page) {
  applyNewTabBackground();
  wrapper.querySelectorAll(".newtab-search").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { activeTabId = page.id; navigate(input.value); }
    });
  });
  wrapper.querySelectorAll(".quick-link[data-url]").forEach(btn => {
    btn.addEventListener("click", () => { activeTabId = page.id; navigate(btn.dataset.url); });
  });
  const lob = wrapper.querySelector("#launchOptionsBtn");
  if (lob) lob.onclick = () => openLaunchModal();
}

function ensurePage(page) {
  const viewport = document.getElementById("viewport");
  let wrapper = viewport.querySelector('.page[data-page-id="' + page.id + '"]');
  if (!wrapper) {
    wrapper = document.createElement("section");
    wrapper.className = "page";
    wrapper.dataset.pageId = page.id;
    viewport.appendChild(wrapper);
    if (page.newTab) {
      wrapper.innerHTML = homepageHTML(page.id);
      wireHome(wrapper, page);
    } else {
      const frame = document.createElement("div");
      frame.style.cssText = "width:100%;height:100%";
      frame.dataset.engineContainer = page.id;
      wrapper.appendChild(frame);
      createEngineFrame(page, frame);
    }
  }
  wrapper.classList.toggle("active", page.id === activeTabId);
  return wrapper;
}

function prunePages() {
  const viewport = document.getElementById("viewport");
  const ids = new Set(tabs.map(t => t.id));
  viewport.querySelectorAll(".page").forEach(el => {
    if (!ids.has(el.dataset.pageId)) el.remove();
  });
}

function showActiveOnly() {
  document.querySelectorAll(".page").forEach(el => {
    el.classList.toggle("active", el.dataset.pageId === activeTabId);
  });
}

function switchTab(id) {
  activeTabId = id;
  showActiveOnly();
  renderTabs();
  renderToolbar();
}

function renderToolbar() {
  const page = getActiveTab();
  document.getElementById("address").value = page && page.url ? page.url : "";
  document.getElementById("backBtn").disabled = !page || !page.url;
  document.getElementById("forwardBtn").disabled = !page || !page.url;
  const b = document.getElementById("bookmarkBtn");
  if (page && page.url && isBookmarked(page.url)) b.classList.add("saved");
  else b.classList.remove("saved");
}

function renderChrome() {
  renderTabs();
  renderToolbar();
  renderBookmarks();
  loadColorInputs();
  loadCloakInputs();
  loadPanicInputs();
  highlightTheme();
  fillWispSelect();
}

async function navigate(raw) {
  const page = getActiveTab();
  if (!page) return;
  const value = normalizeUrl(raw);
  if (!value) return;
  page.url = value;
  page.newTab = false;
  page.favicon = faviconFor(value);
  try { page.title = new URL(value).hostname; } catch { page.title = "Veil"; }
  if (page.historyIndex < page.history.length - 1) page.history = page.history.slice(0, page.historyIndex + 1);
  page.history.push(value);
  page.historyIndex = page.history.length - 1;

  const wrapper = ensurePage(page);
  if (page.engineFrame) {
    await goFrame(page, value);
  } else {
    wrapper.innerHTML = "";
    const frame = document.createElement("div");
    frame.style.cssText = "width:100%;height:100%";
    frame.dataset.engineContainer = page.id;
    wrapper.appendChild(frame);
    await createEngineFrame(page, frame);
  }
  showActiveOnly();
  renderChrome();
}

async function goBack() {
  const p = getActiveTab();
  if (!p) return;
  if (p.engineFrame && typeof p.engineFrame.back === "function") {
    try { await p.engineFrame.back(); return; } catch {}
  }
  if (p.historyIndex <= 0) return;
  p.historyIndex--;
  p.url = p.history[p.historyIndex];
  p.newTab = false;
  await goFrame(p, p.url);
  renderChrome();
}
async function goForward() {
  const p = getActiveTab();
  if (!p) return;
  if (p.engineFrame && typeof p.engineFrame.forward === "function") {
    try { await p.engineFrame.forward(); return; } catch {}
  }
  if (p.historyIndex >= p.history.length - 1) return;
  p.historyIndex++;
  p.url = p.history[p.historyIndex];
  p.newTab = false;
  await goFrame(p, p.url);
  renderChrome();
}
function reload() {
  const p = getActiveTab();
  if (!p) return;
  if (!p.url) { goHome(); return; }
  if (p.engineFrame && typeof p.engineFrame.reload === "function") p.engineFrame.reload();
  else goFrame(p, p.url);
}

function createTab(newTab) {
  if (newTab === undefined) newTab = true;
  if (tabs.length >= MAX_TABS) return;
  const tab = {
    id: uid(), title: "New Tab", url: "", history: [], historyIndex: -1,
    newTab: true, engineFrame: null, favicon: FAVI, animOpen: true
  };
  tabs.push(tab);
  activeTabId = tab.id;
  ensurePage(tab);
  showActiveOnly();
  renderChrome();
}
function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index < 0) return;
  const el = document.querySelector('[data-tab-id="' + id + '"]');
  const finish = () => {
    const t = tabs[index];
    if (t && t.engineFrame) {
      try {
        const f = t.engineFrame.element || t.engineFrame.frame;
        if (f && f.remove) f.remove();
      } catch {}
      t.engineFrame = null;
    }
    tabs.splice(index, 1);
    prunePages();
    if (!tabs.length) { createTab(true); return; }
    if (activeTabId === id) activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
    showActiveOnly();
    renderChrome();
  };
  if (el) { el.classList.add("closing"); setTimeout(finish, 160); }
  else finish();
}
function renameCurrentTab() {
  const p = getActiveTab();
  if (!p) return;
  const name = prompt("Tab name:", p.title);
  if (name && name.trim()) { p.title = name.trim(); renderTabs(); }
}
function goHome() {
  const p = getActiveTab();
  if (!p) { createTab(true); return; }
  if (p.engineFrame) {
    try {
      const f = p.engineFrame.element || p.engineFrame.frame;
      if (f && f.remove) f.remove();
    } catch {}
    p.engineFrame = null;
  }
  p.newTab = true; p.url = ""; p.title = "New Tab"; p.favicon = FAVI;
  p.history = []; p.historyIndex = -1;
  const wrapper = document.querySelector('.page[data-page-id="' + p.id + '"]');
  if (wrapper) { wrapper.innerHTML = homepageHTML(p.id); wireHome(wrapper, p); }
  renderChrome();
}
function toggleBookmark() {
  const p = getActiveTab();
  if (!p || !p.url) return;
  if (bookmarks.some(b => b.url === p.url)) bookmarks = bookmarks.filter(b => b.url !== p.url);
  else bookmarks.push({ id: uid(), title: p.title || p.url, url: p.url });
  save();
  renderToolbar();
  renderBookmarks();
}
function renderBookmarks() {
  const list = document.getElementById("bookmarkList");
  if (!bookmarks.length) { list.innerHTML = '<div class="empty">No bookmarks yet.</div>'; return; }
  list.innerHTML = bookmarks.map(b =>
    '<div class="bookmark-row"><div class="bookmark-main" data-open-bookmark="' + escapeHTML(b.url) + '">' +
    '<div class="bookmark-title">' + escapeHTML(b.title) + '</div>' +
    '<div class="bookmark-url">' + escapeHTML(b.url) + '</div></div>' +
    '<button class="bookmark-delete" data-delete-bookmark="' + escapeHTML(b.id) + '">×</button></div>'
  ).join("");
  list.querySelectorAll("[data-open-bookmark]").forEach(el =>
    el.onclick = () => { closePanels(); navigate(el.dataset.openBookmark); }
  );
  list.querySelectorAll("[data-delete-bookmark]").forEach(el =>
    el.onclick = () => {
      bookmarks = bookmarks.filter(b => b.id !== el.dataset.deleteBookmark);
      save(); renderBookmarks(); renderToolbar();
    }
  );
}

function openPanel(id) {
  closeMenu();
  document.getElementById("backdrop").classList.add("open");
  document.getElementById(id).classList.add("open");
}
function closePanels() {
  document.getElementById("backdrop").classList.remove("open");
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("open"));
}
function closeMenu() { document.getElementById("mainMenu").classList.remove("open"); }

function loadColorInputs() {
  document.getElementById("colorBg").value = settings.bg;
  document.getElementById("colorPanel").value = settings.panel;
  document.getElementById("colorAccent").value = settings.accent;
  document.getElementById("colorText").value = settings.text;
  document.getElementById("backgroundUrl").value = settings.backgroundUrl || "";
}
function loadCloakInputs() {
  document.getElementById("cloakTitle").value = cloak.title || "";
  document.getElementById("cloakIcon").value = cloak.icon || "";
}
function loadPanicInputs() {
  document.getElementById("panicKey").value = panic.key ? ("Bound: " + panic.key) : "Not bound";
  document.getElementById("panicUrl").value = panic.url || "";
}
function fillWispSelect() {
  const sel = document.getElementById("wispSelect");
  sel.innerHTML = WISP_PRESETS.map(w =>
    '<option value="' + w.id + '"' + (settings.wispId === w.id ? " selected" : "") + ">" + w.name + "</option>"
  ).join("");
  document.getElementById("wispCustom").value = settings.wispCustom || "";
}
function highlightTheme() {
  document.querySelectorAll("[data-theme]").forEach(b => b.classList.toggle("active", b.dataset.theme === settings.theme));
  const customCard = document.getElementById("customThemeCard");
  if (customCard) customCard.classList.toggle("active", settings.theme === "custom");
  const editor = document.getElementById("customColorCard");
  if (editor) editor.classList.toggle("open", settings.theme === "custom" || editor.classList.contains("force-open"));
  document.getElementById("transportEpoxy").classList.toggle("active", settings.transport !== "libcurl");
  document.getElementById("transportLibcurl").classList.toggle("active", settings.transport === "libcurl");
  document.getElementById("launchManual").classList.toggle("active", settings.launchMode !== "auto");
  document.getElementById("launchAuto").classList.toggle("active", settings.launchMode === "auto");
}

function applyTheme(name) {
  if (!THEMES[name]) return;
  const keep = { transport: settings.transport, wispId: settings.wispId, wispCustom: settings.wispCustom, launchMode: settings.launchMode, backgroundUrl: settings.backgroundUrl };
  settings = Object.assign({}, settings, THEMES[name], keep, { theme: name });
  const editor = document.getElementById("customColorCard");
  if (editor) editor.classList.remove("open", "force-open");
  applyCSSVariables(); save(); highlightTheme(); loadColorInputs(); applyNewTabBackground();
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
  applyCSSVariables(); save(); highlightTheme();
}
function applyBackground() {
  settings.backgroundUrl = document.getElementById("backgroundUrl").value.trim();
  save(); applyNewTabBackground();
}
function applyCloakPreset(id) {
  const p = CLOAK_PRESETS[id];
  if (!p) return;
  cloak = { title: p.title, icon: p.icon };
  document.title = cloak.title;
  document.getElementById("favicon").href = cloak.icon;
  loadCloakInputs();
  save();
}
function applyCloak() {
  cloak.title = document.getElementById("cloakTitle").value.trim() || "Veil";
  cloak.icon = document.getElementById("cloakIcon").value.trim() || FAVI;
  document.title = cloak.title;
  document.getElementById("favicon").href = cloak.icon;
  save();
}
function resetSettings() {
  settings = Object.assign({}, DEFAULT_SETTINGS);
  panic = Object.assign({}, DEFAULT_PANIC);
  cloak = { title: "Veil", icon: FAVI };
  document.title = "Veil";
  document.getElementById("favicon").href = FAVI;
  applyCSSVariables(); save(); renderChrome(); applyNewTabBackground();
}

async function setTransport(kind) {
  settings.transport = kind === "libcurl" ? "libcurl" : "epoxy";
  save(); highlightTheme();
  engineReady = false; engineController = null; engineInitPromise = null; muxConnection = null;
  document.getElementById("engineStatus").textContent = "Switching engine…";
  await initEngine();
}

async function applyWisp() {
  settings.wispId = document.getElementById("wispSelect").value;
  settings.wispCustom = document.getElementById("wispCustom").value.trim();
  save();
  engineReady = false; engineController = null; engineInitPromise = null; muxConnection = null;
  document.getElementById("engineStatus").textContent = "Switching server…";
  await initEngine();
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}
document.getElementById("bindPanic").onclick = () => {
  bindingPanic = true;
  document.getElementById("panicKey").value = "Press any key…";
  document.getElementById("panicKey").focus();
};
document.getElementById("unbindPanic").onclick = () => {
  panic = { key: "", code: "", url: document.getElementById("panicUrl").value.trim() || DEFAULT_PANIC.url };
  save(); loadPanicInputs();
};
document.addEventListener("keydown", e => {
  if (bindingPanic) {
    e.preventDefault(); e.stopPropagation();
    bindingPanic = false;
    if (e.key === "Escape") { loadPanicInputs(); return; }
    panic.key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    panic.code = e.code;
    panic.url = document.getElementById("panicUrl").value.trim() || DEFAULT_PANIC.url;
    save(); loadPanicInputs();
    return;
  }
  if (!panic.code) return;
  if (isTypingTarget(e.target)) return;
  if (e.code === panic.code || e.key === panic.key || (panic.key && e.key.toUpperCase() === panic.key)) {
    e.preventDefault();
    location.replace(panic.url || DEFAULT_PANIC.url);
  }
}, true);

function openAboutBlank(kind) {
  const features = kind === "window" ? "popup=yes,width=1280,height=800" : "";
  const w = window.open("about:blank", "_blank", features);
  if (!w) { alert("Popup blocked — allow popups for this site."); return; }
  const appUrl = location.origin + REPO_PATH;
  w.document.open();
  w.document.write('<!DOCTYPE html><html><head><title> </title><style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:#111}</style></head><body><iframe src="' + appUrl + '" allow="fullscreen"></iframe></body></html>');
  w.document.close();
}

function openLaunchModal() {
  closeMenu();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal-box">' +
    "<h2>How would you like to launch?</h2>" +
    "<p>Open Veil inside about:blank so the real URL is hidden.</p>" +
    '<select id="launchKind" class="text-input">' +
    '<option value="tab">New about:blank tab</option>' +
    '<option value="window">New about:blank window</option>' +
    "</select>" +
    '<div class="modal-actions">' +
    '<button class="modal-cancel" type="button">Cancel</button>' +
    '<button class="modal-go" type="button">Launch</button>' +
    "</div></div>";
  document.body.appendChild(overlay);
  overlay.querySelector(".modal-cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector(".modal-go").onclick = () => {
    const kind = overlay.querySelector("#launchKind").value;
    overlay.remove();
    openAboutBlank(kind === "window" ? "window" : "tab");
  };
}

document.getElementById("newTabBtn").onclick = () => createTab(true);
document.getElementById("backBtn").onclick = goBack;
document.getElementById("forwardBtn").onclick = goForward;
document.getElementById("refreshBtn").onclick = reload;
document.getElementById("homeBtn").onclick = goHome;
document.getElementById("settingsOpenBtn").onclick = () => openPanel("settingsPanel");
document.getElementById("bookmarkBtn").onclick = toggleBookmark;
document.getElementById("address").addEventListener("keydown", e => { if (e.key === "Enter") navigate(e.target.value); });
document.getElementById("menuBtn").onclick = e => { e.stopPropagation(); document.getElementById("mainMenu").classList.toggle("open"); };
document.getElementById("menuNewTab").onclick = () => { closeMenu(); createTab(true); };
document.getElementById("menuBookmarks").onclick = () => openPanel("bookmarksPanel");
document.getElementById("menuRename").onclick = () => { closeMenu(); renameCurrentTab(); };
document.getElementById("menuAboutBlank").onclick = () => openLaunchModal();
document.getElementById("backdrop").onclick = closePanels;
document.querySelectorAll("[data-close-panel]").forEach(b => b.onclick = closePanels);
document.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => applyTheme(b.dataset.theme));
document.getElementById("customThemeCard").onclick = () => {
  const editor = document.getElementById("customColorCard");
  editor.classList.toggle("open");
  editor.classList.toggle("force-open", editor.classList.contains("open"));
  document.getElementById("customThemeCard").classList.add("active");
};
document.getElementById("applyColors").onclick = applyCustomColors;
document.getElementById("transportEpoxy").onclick = () => setTransport("epoxy");
document.getElementById("transportLibcurl").onclick = () => setTransport("libcurl");
document.getElementById("launchManual").onclick = () => { settings.launchMode = "manual"; save(); highlightTheme(); };
document.getElementById("launchAuto").onclick = () => { settings.launchMode = "auto"; save(); highlightTheme(); };
document.getElementById("applyBackground").onclick = applyBackground;
document.getElementById("applyCloak").onclick = applyCloak;
document.getElementById("applyWisp").onclick = applyWisp;
document.getElementById("resetSettings").onclick = resetSettings;
document.querySelectorAll("[data-cloak]").forEach(b => b.onclick = () => applyCloakPreset(b.dataset.cloak));
document.addEventListener("click", e => {
  if (!e.target.closest("#mainMenu") && !e.target.closest("#menuBtn")) closeMenu();
});
document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "l") { e.preventDefault(); document.getElementById("address").focus(); document.getElementById("address").select(); }
  if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); createTab(true); }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); toggleBookmark(); }
  if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goForward(); }
  if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); reload(); }
});
window.addEventListener("beforeunload", () => { if (COOKIE.consent) save(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconnectTransport();
});

function showCookieConsent() {
  const overlay = document.createElement("div");
  overlay.className = "cookie-overlay";
  overlay.innerHTML = '<div class="cookie-box"><h2>Allow cookies?</h2><p>Veil can remember bookmarks, theme, cloak, and panic key.</p><div class="cookie-buttons"><button class="cookie-no" id="cookieNo">No</button><button class="cookie-yes" id="cookieYes">Yes</button></div></div>';
  document.body.appendChild(overlay);
  document.getElementById("cookieYes").onclick = () => {
    COOKIE.consent = true; COOKIE.set("veil_cookie_consent", "yes");
    loadSavedData(); save(); overlay.remove();
    applyCSSVariables();
    document.title = cloak.title || "Veil";
    document.getElementById("favicon").href = cloak.icon || FAVI;
    renderChrome();
  };
  document.getElementById("cookieNo").onclick = () => { COOKIE.consent = false; overlay.remove(); renderChrome(); };
}

(async function init() {
  const consent = COOKIE.get("veil_cookie_consent");
  if (consent === "yes") { COOKIE.consent = true; loadSavedData(); }
  if (!cloak.icon) cloak.icon = FAVI;
  applyCSSVariables();
  document.title = cloak.title || "Veil";
  document.getElementById("favicon").href = cloak.icon || FAVI;
  createTab(true);
  initEngine();
  if (consent !== "yes") showCookieConsent();
  if (settings.launchMode === "auto") {
    setTimeout(() => openAboutBlank("tab"), 400);
  }
})();
