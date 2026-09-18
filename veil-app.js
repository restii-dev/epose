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
const WISP_URL = "wss://wisp-backend-weyl.onrender.com";
const MAX_TABS = 20;


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
      await navigator.serviceWorker.register(REPO_PATH + "sw.js", { scope: SCRAMJET_PREFIX });

      if (!window.BareMux) throw new Error("BareMux did not load.");
      const mux = new BareMux.BareMuxConnection(BAREMUX_WORKER);
      const transport = (settings.transport === "libcurl") ? LIBCURL_MODULE : EPOXY_MODULE;
      await mux.setTransport(transport, [{ wisp: WISP_URL }]);


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
      status.textContent = "Ready • " + (settings.transport === "libcurl" ? "Libcurl" : "Epoxy") + " • Wisp connected";

      return true;
    } catch (error) {
      console.error(error);
      status.textContent = "Engine error • " + (error.message || "check scramjet/baremux files");

      return false;
    }
  })();
  return engineInitPromise;
}

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

const DEFAULT_SETTINGS = { theme: "matte", transport: "epoxy", ...THEMES.matte, backgroundUrl: "" };

const DEFAULT_PANIC = { key: "", code: "", url: "https://classroom.google.com" };

let settings = { ...DEFAULT_SETTINGS };
let panic = { ...DEFAULT_PANIC };
let bookmarks = [];
let cloak = { title: "Veil", icon: "image/favi.png" };

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
  return '<img src="' + FAVI + '" alt="">';
}

function imgIcon(name) {
  return '<img src="' + IMG + name + '" alt="">';
}


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
    wrapper.innerHTML = '<div class="engine-error"><div class="engine-error-box"><h2>Browser engine unavailable</h2><p>Make sure <b>scramjet/</b>, <b>baremux/</b>, and <b>sw.js</b> are deployed.</p><button data-retry-engine>Retry</button></div></div>';

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
    '<button class="quick-link soon" title="Games (soon)" data-soon="1"><svg viewBox="0 0 24 24"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg></button>' +
    '<button class="quick-link soon" title="Utilities (soon)" data-soon="1"><svg viewBox="0 0 24 24"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg></button>' +
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
  if (page && page.url && isBookmarked(page.url)) b.classList.add("saved");
  else b.classList.remove("saved");

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
  if (tabs.length >= MAX_TABS) return;
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
  const customCard = document.getElementById("customThemeCard");
  if (customCard) customCard.classList.toggle("active", settings.theme === "custom");
  const editor = document.getElementById("customColorCard");
  if (editor) editor.classList.toggle("open", settings.theme === "custom" || editor.classList.contains("force-open"));
  const ep = document.getElementById("transportEpoxy");
  const lc = document.getElementById("transportLibcurl");
  if (ep) ep.classList.toggle("active", settings.transport !== "libcurl");
  if (lc) lc.classList.toggle("active", settings.transport === "libcurl");
}

function applyTheme(name) {
  if (!THEMES[name]) return;
  const transport = settings.transport || "epoxy";
  settings = Object.assign({}, settings, THEMES[name], { theme: name, transport: transport });
  const editor = document.getElementById("customColorCard");
  if (editor) editor.classList.remove("open", "force-open");
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
  settings.bg2 = settings.bg;
  settings.bg3 = settings.panel;
  settings.panel2 = settings.panel;
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
  applyCSSVariables();
  save();
  render();
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
document.getElementById("customThemeCard").onclick = () => {
  const editor = document.getElementById("customColorCard");
  editor.classList.toggle("open");
  editor.classList.toggle("force-open", editor.classList.contains("open"));
  document.getElementById("customThemeCard").classList.add("active");
};
document.getElementById("applyColors").onclick = applyCustomColors;
document.getElementById("transportEpoxy").onclick = () => setTransport("epoxy");
document.getElementById("transportLibcurl").onclick = () => setTransport("libcurl");
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
    document.getElementById("favicon").href = cloak.icon || FAVI;
    render();

  };
  document.getElementById("cookieNo").onclick = () => {
    COOKIE.consent = false;
    overlay.remove();
    render();
  };
}

(async function init() {
  const consent = COOKIE.get("veil_cookie_consent");
  if (consent === "yes") {
    COOKIE.consent = true;
    loadSavedData();
  }
  if (!cloak.icon) cloak.icon = FAVI;
  applyCSSVariables();
  document.title = cloak.title || "Veil";
  document.getElementById("favicon").href = cloak.icon || FAVI;
  createTab(true);
  initEngine();
  if (consent !== "yes") showCookieConsent();
})();
