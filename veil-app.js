"use strict";

const REPO_PATH = (() => {
  const p = location.pathname;
  if (p.endsWith("/")) return p;
  const last = p.lastIndexOf("/");
  return p.slice(0, last + 1);
})();
const SCRAMJET_PREFIX = REPO_PATH + "service/";
const SCRAMJET_FILES = {
  all: REPO_PATH + "scramjet/scramjet.all.js",
  sync: REPO_PATH + "scramjet/scramjet.sync.js",
  wasm: REPO_PATH + "scramjet/scramjet.wasm.wasm",
  config: REPO_PATH + "scramjet/scramjet.config.js"
};
const BAREMUX_SCRIPT = REPO_PATH + "baremux/index.js";
const BAREMUX_WORKER = REPO_PATH + "baremux/worker.js";
const WISP_URL = "wss://wisp-backend-weyl.onrender.com";
const DESIGN_W = 1280;
const DESIGN_H = 800;

let engineReady = false;
let engineController = null;
let engineInitPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
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
      await navigator.serviceWorker.register(REPO_PATH + "SW.js", { scope: SCRAMJET_PREFIX });

      if (!window.BareMux) throw new Error("BareMux did not load.");
      const mux = new BareMux.BareMuxConnection(BAREMUX_WORKER);
      try {
        await mux.setTransport(REPO_PATH + "epoxy/index.mjs", [{ wisp: WISP_URL }]);
      } catch {
        await mux.setTransport(BAREMUX_WORKER, [{ wisp: WISP_URL }]);
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
      status.textContent = "Ready • Wisp connected";
      return true;
    } catch (error) {
      console.error(error);
      status.textContent = "Engine error • " + (error.message || "check scram/baremux files");
      return false;
    }
  })();
  return engineInitPromise;
}

const THEMES = {
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

const DEFAULT_SETTINGS = { theme: "ember", ...THEMES.ember, backgroundUrl: "" };
const DEFAULT_PANIC = { key: "", code: "", url: "https://classroom.google.com" };

let settings = { ...DEFAULT_SETTINGS };
let panic = { ...DEFAULT_PANIC };
let bookmarks = [];
let cloak = { title: "Veil", icon: "" };
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
const STORAGE = {
  bookmarks: "veil_bookmarks",
  settings: "veil_settings",
  cloak: "veil_cloak",
  panic: "veil_panic"
};

function uid() { return "tab_" + Date.now().toString(36) + "_" + (++tabCounter).toString(36); }
function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}
function getTab(id = activeTabId) { return tabs.find(t => t.id === id) || null; }
function getActiveTab() { return getTab(); }
function isBookmarked(url) { return bookmarks.some(b => b.url === url); }

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

function applyScale() {
  const root = document.getElementById("scale-root");
  if (!root) return;
  const sw = window.innerWidth / DESIGN_W;
  const sh = window.innerHeight / DESIGN_H;
  const scale = Math.min(sw, sh);
  root.style.transform = "scale(" + scale + ")";
  const ox = (window.innerWidth - DESIGN_W * scale) / 2;
  const oy = (window.innerHeight - DESIGN_H * scale) / 2;
  root.style.left = Math.max(0, ox) + "px";
  root.style.top = Math.max(0, oy) + "px";
}
window.addEventListener("resize", applyScale);

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

function tabIcon() {
  return '<svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M50 14L81 27V47C81 69 68 84 50 91C32 84 19 69 19 47V27L50 14Z" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/></svg>';
}

const QUICK_ICONS = {
  x: '<svg viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  discord: '<svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  reddit: '<svg viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.672-3.123 4.844-6.972 4.844-3.849 0-6.972-2.172-6.972-4.844 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.914.614a1.25 1.25 0 0 1 1.146-.743zM9.25 12.25c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25zm5.5 0c-.69 0-1.25.56-1.25 1.25s.56 1.25 1.25 1.25 1.25-.56 1.25-1.25-.56-1.25-1.25-1.25z"/></svg>',
  geforce: '<svg viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>',
  games: '<svg viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>',
  utils: '<svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg>'
};

function normalizeUrl(input) {
  let value = String(input || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return "https://" + value;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(value);
}

async function createEngineFrame(page, wrapper) {
  if (!engineReady) await initEngine();
  if (!engineReady) {
    wrapper.innerHTML = '<div class="engine-error"><div class="engine-error-box"><h2>Browser engine unavailable</h2><p>Make sure <b>scram/</b>, <b>baremux/</b>, and <b>SW.js</b> are deployed.</p><button data-retry-engine>Retry</button></div></div>';
    wrapper.querySelector("[data-retry-engine]").onclick = () => { engineInitPromise = null; renderViewport(); };
    return;
  }
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
      }
      wrapper.appendChild(frame);
      page.engineFrame = frameObj;
      if (typeof frameObj.go === "function") frameObj.go(page.url);
      else if (typeof frameObj.navigate === "function") frameObj.navigate(page.url);
      else if (frame instanceof HTMLIFrameElement) frame.src = SCRAMJET_PREFIX + encodeURIComponent(page.url);
      return;
    }
    throw new Error("Scramjet frame API unavailable.");
  } catch (e) {
    console.error(e);
    wrapper.innerHTML = '<div class="engine-error"><div class="engine-error-box"><h2>Could not open this page</h2><p>' + escapeHTML(e.message) + '</p><button data-retry-engine>Retry</button></div></div>';
    const btn = wrapper.querySelector("[data-retry-engine]");
    if (btn) btn.onclick = () => renderViewport();
  }
}

function renderTabs() {
  const c = document.getElementById("tabs");
  c.innerHTML = tabs.map(tab =>
    '<div class="tab ' + (tab.id === activeTabId ? "active" : "") + '" data-tab-id="' + tab.id + '">' +
    '<div class="tab-icon">' + tabIcon() + '</div>' +
    '<div class="tab-title">' + escapeHTML(tab.title) + '</div>' +
    '<button class="tab-close" data-close="' + tab.id + '" aria-label="Close">×</button></div>'
  ).join("");
  c.querySelectorAll(".tab").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".tab-close")) return;
      activeTabId = el.dataset.tabId;
      render();
    });
    el.addEventListener("dblclick", e => {
      if (!e.target.closest(".tab-close")) renameCurrentTab(el.dataset.tabId);
    });
  });
  c.querySelectorAll("[data-close]").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); closeTab(btn.dataset.close); })
  );
}

function homepageHTML(pageId) {
  return (
    '<div class="newtab-page"><div class="newtab-overlay"><div class="newtab-center">' +
    '<div class="veil-mark">' + tabIcon() + '</div>' +
    '<div class="newtab-title">Veil</div>' +
    '<div class="search-box"><input class="newtab-search" data-page="' + pageId + '" placeholder="Browse the web freely…" autocomplete="off" spellcheck="false"></div>' +
    '<div class="quick-links">' +
    '<button class="quick-link" title="X" data-url="https://x.com">' + QUICK_ICONS.x + '</button>' +
    '<button class="quick-link" title="Discord" data-url="https://discord.com/">' + QUICK_ICONS.discord + '</button>' +
    '<button class="quick-link" title="Reddit" data-url="https://www.reddit.com/">' + QUICK_ICONS.reddit + '</button>' +
    '<button class="quick-link" title="GeForce NOW" data-url="https://play.geforcenow.com/mall">' + QUICK_ICONS.geforce + '</button>' +
    '<button class="quick-link soon" title="Games (soon)" data-soon="1">' + QUICK_ICONS.games + '</button>' +
    '<button class="quick-link soon" title="Utilities (soon)" data-soon="1">' + QUICK_ICONS.utils + '</button>' +
    '</div>' +
    '<button class="launch-btn" id="launchOptionsBtn" type="button">Launch Options…</button>' +
    '</div></div>' +
    '<div class="time-bar" id="timeBar">Time Remaining: — (auth coming soon)</div></div>'
  );
}

function renderViewport() {
  const viewport = document.getElementById("viewport");
  viewport.innerHTML = "";
  tabs.forEach(page => {
    const wrapper = document.createElement("section");
    wrapper.className = "page" + (page.id === activeTabId ? " active" : "");
    wrapper.dataset.pageId = page.id;
    if (page.newTab) {
      wrapper.innerHTML = homepageHTML(page.id);
    } else {
      const frame = document.createElement("div");
      frame.style.width = "100%";
      frame.style.height = "100%";
      frame.dataset.engineContainer = page.id;
      wrapper.appendChild(frame);
      createEngineFrame(page, frame);
    }
    viewport.appendChild(wrapper);
  });
  applyNewTabBackground();
  viewport.querySelectorAll(".newtab-search").forEach(input => {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        activeTabId = input.dataset.page;
        navigate(input.value);
      }
    });
  });
  viewport.querySelectorAll(".quick-link[data-url]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTabId = btn.closest(".page").dataset.pageId;
      navigate(btn.dataset.url);
    });
  });
  const lob = viewport.querySelector("#launchOptionsBtn");
  if (lob) lob.onclick = () => document.getElementById("launchMenu").classList.toggle("open");
}

function renderToolbar() {
  const page = getActiveTab();
  const address = document.getElementById("address");
  address.value = page && page.url ? page.url : "";
  document.getElementById("backBtn").disabled = !page || page.historyIndex <= 0;
  document.getElementById("forwardBtn").disabled = !page || page.historyIndex >= page.history.length - 1;
  const b = document.getElementById("bookmarkBtn");
  if (page && page.url && isBookmarked(page.url)) {
    b.classList.add("saved");
    b.textContent = "★";
  } else {
    b.classList.remove("saved");
    b.textContent = "☆";
  }
}

function render() {
  renderTabs();
  renderViewport();
  renderToolbar();
  renderBookmarks();
  loadColorInputs();
  loadCloakInputs();
  loadPanicInputs();
  highlightTheme();
}

async function navigate(raw) {
  const page = getActiveTab();
  if (!page) return;
  const value = normalizeUrl(raw);
  if (!value) return;
  page.newTab = false;
  if (page.historyIndex < page.history.length - 1) page.history = page.history.slice(0, page.historyIndex + 1);
  page.history.push(value);
  page.historyIndex = page.history.length - 1;
  page.url = value;
  try { page.title = new URL(value).hostname; } catch { page.title = "Veil"; }
  render();
  await initEngine();
}

async function goBack() {
  const p = getActiveTab();
  if (!p || p.historyIndex <= 0) return;
  p.historyIndex--;
  p.url = p.history[p.historyIndex];
  p.newTab = false;
  render();
  await navigateExisting(p);
}
async function goForward() {
  const p = getActiveTab();
  if (!p || p.historyIndex >= p.history.length - 1) return;
  p.historyIndex++;
  p.url = p.history[p.historyIndex];
  p.newTab = false;
  render();
  await navigateExisting(p);
}
async function navigateExisting(page) {
  if (!engineReady) await initEngine();
  if (page.engineFrame && typeof page.engineFrame.go === "function") {
    page.engineFrame.go(page.url);
    return;
  }
  const wrapper = document.querySelector('[data-engine-container="' + page.id + '"]');
  if (wrapper) {
    wrapper.innerHTML = "";
    await createEngineFrame(page, wrapper);
  }
}
function reload() {
  const p = getActiveTab();
  if (!p || !p.url) return;
  if (p.engineFrame && typeof p.engineFrame.reload === "function") p.engineFrame.reload();
  else if (p.engineFrame && p.engineFrame.frame instanceof HTMLIFrameElement) p.engineFrame.frame.contentWindow.location.reload();
  else navigateExisting(p);
}
function createTab(newTab) {
  if (newTab === undefined) newTab = true;
  const tab = {
    id: uid(), title: newTab ? "New Tab" : "Veil", url: "",
    history: [], historyIndex: -1, newTab: newTab, engineFrame: null
  };
  tabs.push(tab);
  activeTabId = tab.id;
  render();
}
function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index < 0) return;
  tabs.splice(index, 1);
  if (!tabs.length) { createTab(true); return; }
  if (activeTabId === id) activeTabId = tabs[Math.min(index, tabs.length - 1)].id;
  render();
}
function renameCurrentTab(id) {
  if (id === undefined) id = activeTabId;
  const p = getTab(id);
  if (!p) return;
  const name = prompt("Tab name:", p.title);
  if (name && name.trim()) { p.title = name.trim(); render(); }
}
function goHome() {
  const p = getActiveTab();
  if (!p) { createTab(true); return; }
  p.newTab = true;
  p.url = "";
  p.title = "New Tab";
  p.engineFrame = null;
  render();
}
function toggleBookmark() {
  const p = getActiveTab();
  if (!p || !p.url) return;
  if (bookmarks.some(b => b.url === p.url)) bookmarks = bookmarks.filter(b => b.url !== p.url);
  else bookmarks.push({ id: uid(), title: p.title || p.url, url: p.url });
  save();
  render();
}
function renderBookmarks() {
  const list = document.getElementById("bookmarkList");
  if (!bookmarks.length) {
    list.innerHTML = '<div class="empty">No bookmarks yet.</div>';
    return;
  }
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
      save();
      renderBookmarks();
      renderToolbar();
    }
  );
}

function openPanel(id) {
  closeMenu();
  document.getElementById("launchMenu").classList.remove("open");
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
function highlightTheme() {
  document.querySelectorAll("[data-theme]").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === settings.theme);
  });
}

function applyTheme(name) {
  if (!THEMES[name]) return;
  settings = Object.assign({}, settings, THEMES[name], { theme: name });
  applyCSSVariables();
  save();
  render();
}
function applyCustomColors() {
  settings.bg = document.getElementById("colorBg").value;
  settings.panel = document.getElementById("colorPanel").value;
  settings.accent = document.getElementById("colorAccent").value;
  settings.text = document.getElementById("colorText").value;
  settings.theme = "custom";
  settings.newtab = settings.bg;
  applyCSSVariables();
  save();
  render();
}
function applyBackground() {
  settings.backgroundUrl = document.getElementById("backgroundUrl").value.trim();
  save();
  render();
}
function applyCloak() {
  cloak.title = document.getElementById("cloakTitle").value.trim() || "Veil";
  cloak.icon = document.getElementById("cloakIcon").value.trim();
  document.title = cloak.title;
  if (cloak.icon) document.getElementById("favicon").href = cloak.icon;
  save();
}
function resetSettings() {
  settings = Object.assign({}, DEFAULT_SETTINGS);
  panic = Object.assign({}, DEFAULT_PANIC);
  cloak = { title: "Veil", icon: "" };
  document.title = "Veil";
  document.getElementById("favicon").href =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23101010'/%3E%3Cpath d='M50 15L80 28V48C80 69 67 84 50 90C33 84 20 69 20 48V28L50 15Z' fill='none' stroke='%23fff' stroke-width='7'/%3E%3C/svg%3E";
  applyCSSVariables();
  save();
  render();
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}
document.getElementById("bindPanic").onclick = () => {
  bindingPanic = true;
  document.getElementById("panicKey").value = "Press any key…";
};
document.getElementById("unbindPanic").onclick = () => {
  panic = { key: "", code: "", url: document.getElementById("panicUrl").value.trim() || DEFAULT_PANIC.url };
  save();
  loadPanicInputs();
};
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
  if (!panic.code) return;
  if (isTypingTarget(e.target)) return;
  if (e.code === panic.code || e.key === panic.key) {
    e.preventDefault();
    location.href = panic.url || DEFAULT_PANIC.url;
  }
}, true);

function openAboutBlankBrowser() {
  const w = window.open("about:blank", "_blank");
  if (!w) {
    alert("Popup blocked — allow popups for this site.");
    return;
  }
  const appUrl = location.origin + REPO_PATH;
  w.document.open();
  w.document.write('<!DOCTYPE html><html><head><title> </title><style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:#111}</style></head><body><iframe src="' + appUrl + '" allow="fullscreen"></iframe></body></html>');
  w.document.close();
}

document.getElementById("newTabBtn").onclick = () => createTab(true);
document.getElementById("backBtn").onclick = goBack;
document.getElementById("forwardBtn").onclick = goForward;
document.getElementById("refreshBtn").onclick = reload;
document.getElementById("homeBtn").onclick = goHome;
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
document.getElementById("menuAboutBlank").onclick = () => { closeMenu(); openAboutBlankBrowser(); };
document.getElementById("launchAB").onclick = () => {
  document.getElementById("launchMenu").classList.remove("open");
  openAboutBlankBrowser();
};
document.getElementById("launchSame").onclick = () => {
  document.getElementById("launchMenu").classList.remove("open");
};
document.getElementById("backdrop").onclick = closePanels;
document.querySelectorAll("[data-close-panel]").forEach(b => b.onclick = closePanels);
document.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => applyTheme(b.dataset.theme));
document.getElementById("applyColors").onclick = applyCustomColors;
document.getElementById("applyBackground").onclick = applyBackground;
document.getElementById("applyCloak").onclick = applyCloak;
document.getElementById("resetSettings").onclick = resetSettings;
document.addEventListener("click", e => {
  if (!e.target.closest("#mainMenu") && !e.target.closest("#menuBtn")) closeMenu();
  if (!e.target.closest("#launchMenu") && !e.target.closest("#launchOptionsBtn")) {
    document.getElementById("launchMenu").classList.remove("open");
  }
});
document.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "l") {
    e.preventDefault();
    document.getElementById("address").focus();
    document.getElementById("address").select();
  }
  if (mod && e.key.toLowerCase() === "t") { e.preventDefault(); createTab(true); }
  if (mod && e.key.toLowerCase() === "w") { e.preventDefault(); if (activeTabId) closeTab(activeTabId); }
  if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); toggleBookmark(); }
  if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
  if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); goForward(); }
  if (mod && e.key.toLowerCase() === "r") { e.preventDefault(); reload(); }
});
window.addEventListener("beforeunload", () => { if (COOKIE.consent) save(); });

function showCookieConsent() {
  const overlay = document.createElement("div");
  overlay.className = "cookie-overlay";
  overlay.innerHTML = '<div class="cookie-box"><h2>Allow cookies?</h2><p>Veil can remember bookmarks, theme, cloak, and panic key.<br><br>Choose No to browse without saving preferences.</p><div class="cookie-buttons"><button class="cookie-no" id="cookieNo">No</button><button class="cookie-yes" id="cookieYes">Yes</button></div></div>';
  document.body.appendChild(overlay);
  document.getElementById("cookieYes").onclick = () => {
    COOKIE.consent = true;
    COOKIE.set("veil_cookie_consent", "yes");
    loadSavedData();
    save();
    overlay.remove();
    applyCSSVariables();
    document.title = cloak.title || "Veil";
    if (cloak.icon) document.getElementById("favicon").href = cloak.icon;
    render();
  };
  document.getElementById("cookieNo").onclick = () => {
    COOKIE.consent = false;
    overlay.remove();
    render();
  };
}

(async function init() {
  applyScale();
  const consent = COOKIE.get("veil_cookie_consent");
  if (consent === "yes") {
    COOKIE.consent = true;
    loadSavedData();
  }
  applyCSSVariables();
  document.title = cloak.title || "Veil";
  if (cloak.icon) document.getElementById("favicon").href = cloak.icon;
  createTab(true);
  initEngine();
  if (consent !== "yes") showCookieConsent();
})();
