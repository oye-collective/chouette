// Content script — must be self-contained (no ES module imports)
// because MV3 content scripts are loaded as classic scripts.
//
// Runs in every frame (manifest `all_frames: true`). Only the top frame owns
// language detection and the translate bar; sub-frames sit idle until a
// TRANSLATE_FRAME message, relayed through the background, tells them to
// translate.

const IS_TOP_FRAME = window === window.top;

// ── Selected Text ──

document.addEventListener("mouseup", () => {
  const selection = window.getSelection()?.toString().trim();
  if (selection && selection.length > 0) {
    chrome.runtime.sendMessage({
      action: "SELECTED_TEXT" as const,
      text: selection,
    });
  }
});

chrome.runtime.onMessage.addListener((message) => {
  // tabs.sendMessage fans out to every frame.
  if (message?.action === "TRANSLATE_PAGE") {
    // Only the top frame drives; it brings sub-frames along itself.
    if (IS_TOP_FRAME) startPageTranslationFromMenu();
  } else if (message?.action === "TRANSLATE_FRAME") {
    startFrameTranslation(message);
  }
});

// ── Constants ──

// Never looked inside — not for text, not for attributes.
const OPAQUE_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE",
  "SVG", "IFRAME", "FRAME", "CANVAS", "VIDEO", "AUDIO",
]);

// Text content is not prose (source code, or the user's own input), but the
// attributes still are — a <textarea> placeholder needs translating even
// though its value must not be touched.
const NO_TEXT_TAGS = new Set(["CODE", "PRE", "TEXTAREA", "INPUT", "IMG"]);

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "TD", "TH", "DIV", "BLOCKQUOTE", "ARTICLE",
  "SECTION", "FIGCAPTION", "CAPTION", "DT", "DD",
  "HEADER", "FOOTER", "NAV", "MAIN", "ASIDE",
]);

// User-visible text that lives in attributes rather than text nodes.
const TRANSLATABLE_ATTRS = [
  "title", "placeholder", "alt", "label",
  "aria-label", "aria-placeholder",
];

// <input value> is display text only for these types; for everything else it
// is the user's data.
const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset"]);

// How many group requests may be in flight at once. The offscreen scheduler
// coalesces whatever is pending into GPU batches, so the window's job is to
// keep it fed while staying small enough that a scroll re-prioritisation
// isn't stuck behind a wall of already-dispatched work. It also bounds how
// much orphaned work the scheduler holds if this frame navigates away.
const MAX_IN_FLIGHT_GROUPS = 4;

// Serializable stand-in for OFFSCREEN_PRIORITY: Infinity does not survive
// message serialization (it becomes null).
const UNRENDERED_PRIORITY_WIRE = 1e9;

// Translations apply when a request completes, so a request is also the unit
// of progressive rendering. Large groups are split into sub-jobs of roughly
// this size at dispatch: on a slow device each sub-job paints as it lands
// instead of the whole group appearing minutes later in one flush, and on a
// fast device the offscreen scheduler coalesces sub-jobs back into big
// joins, so nothing is lost to the splitting.
const SUBJOB_MAX_CHARS = 400;
const SUBJOB_MAX_UNITS = 16;

const CACHE_KEY_PREFIX = "translate_cache:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// Bumped whenever the unit-index space changes, since cache entries are keyed
// by traversal order. v2 added attributes, shadow DOM and <option> text.
const CACHE_VERSION = 2;
const CACHE_SAVE_INTERVAL_MS = 2000;

const RESCAN_DEBOUNCE_MS = 500;
// A page that never goes quiet for the debounce window would otherwise starve
// the rescan forever; never postpone past this deadline.
const RESCAN_MAX_WAIT_MS = 4000;

// Sweeping expired caches means deserializing every cached page, so it runs at
// most this often rather than on every page load.
const CACHE_SWEEP_KEY = "translate_cache_swept_at";
const CACHE_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// Both of these accumulate for the life of the page, so a long-lived feed that
// churns thousands of rows needs a ceiling. Oldest entries are evicted first.
const MAX_PRUNED_ENTRIES = 5000;
const MAX_MEMO_ENTRIES = 5000;

// Priority assigned to content that is not currently rendered. Such content is
// still translated — just after everything the user can actually see.
const OFFSCREEN_PRIORITY = Number.POSITIVE_INFINITY;

// ── Translate Bar Styles ──

function getBarStyles(isDark: boolean): string {
  const bg = isDark ? "#1e1e1e" : "#fff";
  const border = isDark ? "#333" : "#ddd";
  const text = isDark ? "#e0e0e0" : "#1a1a1a";
  const textMuted = isDark ? "#999" : "#666";
  const accent = isDark ? "#6FA586" : "#27614A";
  const accentHover = isDark ? "#A5D6BF" : "#6FA586";
  const surface = isDark ? "#262626" : "#f5f3ed";

  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .translate-bar {
      position: fixed;
      top: 8px;
      right: 8px;
      z-index: 2147483647;
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 10px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      color: ${text};
      font-size: 13px;
      animation: slideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      max-width: 420px;
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    .translate-icon {
      flex-shrink: 0;
      color: ${accent};
    }
    .translate-label {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .translate-btn {
      padding: 6px 14px;
      border: none;
      border-radius: 6px;
      background: ${accent};
      color: ${isDark ? "#161616" : "#fff"};
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .translate-btn:hover {
      background: ${accentHover};
    }
    .translate-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .close-btn {
      background: none;
      border: none;
      color: ${textMuted};
      cursor: pointer;
      padding: 2px;
      font-size: 16px;
      line-height: 1;
      flex-shrink: 0;
      transition: color 0.15s;
    }
    .close-btn:hover {
      color: ${text};
    }
    .progress-text {
      font-size: 11px;
      color: ${textMuted};
      white-space: nowrap;
    }
    .toggle-btn {
      padding: 6px 14px;
      border: 1px solid ${border};
      border-radius: 6px;
      background: ${surface};
      color: ${text};
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s;
    }
    .toggle-btn:hover {
      border-color: ${accent};
    }
  `;
}

function createTranslateIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const paths = [
    "M5 8l6 6", "M4 14l6-6 2-3", "M2 5h12", "M7 2h1",
    "M22 22l-5-10-5 10", "M14 18h6",
  ];
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// ── Translation Cache ──

interface CachedTranslation {
  version: number;
  sourceLang: string;
  targetLang: string;
  // Keyed by translation-unit index (traversal order) → { original, translated }
  entries: Record<number, { original: string; translated: string }>;
  savedAt: number;
}

function getCacheKey(): string {
  return `${CACHE_KEY_PREFIX}${location.href}`;
}

// Uses chrome.storage.local (accessible from content scripts; survives refresh
// and browser restart), unlike chrome.storage.session which content scripts
// cannot access by default.
async function loadCache(): Promise<CachedTranslation | null> {
  try {
    const key = getCacheKey();
    const result = await chrome.storage.local.get(key);
    const cache = result[key] as CachedTranslation | undefined;
    if (!cache) return null;
    if (cache.version !== CACHE_VERSION) {
      await chrome.storage.local.remove(key);
      return null;
    }
    if (!cache.savedAt || Date.now() - cache.savedAt > CACHE_TTL_MS) {
      await chrome.storage.local.remove(key);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

async function saveCache(cache: Omit<CachedTranslation, "savedAt">): Promise<void> {
  try {
    const stamped: CachedTranslation = { ...cache, savedAt: Date.now() };
    await chrome.storage.local.set({ [getCacheKey()]: stamped });
  } catch {
    // Storage quota exceeded or context invalidated — ignore
  }
}

// Best-effort sweep of expired and stale-version per-URL caches so they don't
// accumulate against the local-storage quota. get(null) deserializes every
// cached page, so the sweep itself is rate-limited by a stored timestamp;
// loadCache still drops its own expired entry on read either way.
async function cleanupExpiredCaches(): Promise<void> {
  try {
    const now = Date.now();
    const sweptAt = (await chrome.storage.local.get(CACHE_SWEEP_KEY))[CACHE_SWEEP_KEY] as
      | number
      | undefined;
    if (sweptAt && now - sweptAt < CACHE_SWEEP_INTERVAL_MS) return;
    await chrome.storage.local.set({ [CACHE_SWEEP_KEY]: now });

    const all = await chrome.storage.local.get(null);
    const staleKeys = Object.keys(all).filter((key) => {
      if (!key.startsWith(CACHE_KEY_PREFIX)) return false;
      const entry = all[key] as CachedTranslation | undefined;
      if (!entry || entry.version !== CACHE_VERSION) return true;
      return !entry.savedAt || now - entry.savedAt > CACHE_TTL_MS;
    });
    if (staleKeys.length > 0) {
      await chrome.storage.local.remove(staleKeys);
    }
  } catch {
    // Best-effort
  }
}

// ── State ──

// A single translatable string: either a text node's content, or one attribute
// of an element. Both flow through the same pipeline.
interface Unit {
  el: Element;
  node: Text | null;
  attr: string | null;
  original: string;
  index: number;
}

interface Group {
  ancestor: Element;
  units: Unit[];
}

interface UnitState {
  original: string;
  translated: string;
  index: number;
}

// Identifies this frame instance to the offscreen scheduler; with the epoch,
// it lets the scheduler drop queued work that a newer translation run of the
// same frame has superseded.
const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
let translateEpoch = 0;
let inFlightGroups = 0;
// In-flight groups that were rendered (finite priority) when dispatched —
// the "done" bar must wait for these even when the queue holds only
// unrendered work.
let inFlightRendered = 0;

let barDismissed = false;
let detectedLangCode: string | null = null;
let preferredLangCode: string = "en";
let preferredLangName: string = "English";
let shadowHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let showingOriginal = false;
let frameTranslationStarted = false;

const textStates = new Map<Text, UnitState>();
const attrStates = new Map<Element, Map<string, UnitState>>();

// Translations whose nodes have since left the document, keyed by unit index.
// Kept out of the live maps so detached subtrees can be garbage-collected, but
// still written to the cache so a reload can restore them. A Map rather than an
// object so insertion order gives us a cheap oldest-first eviction.
const prunedEntries = new Map<number, { original: string; translated: string }>();

// Source text → translation, for the life of the page. Spares a model
// round-trip when a virtualized row is re-attached, and collapses text that
// repeats across the page (nav labels, "Read more" fifty times).
const translationMemo = new Map<string, string>();

function evictOldest(map: Map<any, any>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

let nextUnitIndex = 0;
let queue: Group[] = [];
let draining = false;
let totalScheduled = 0;
let completedGroups = 0;
let translatedUnits = 0;
let visibleWorkDone = false;

// True when the last full priority scan found nothing rendered in the queue,
// meaning rect reads can be skipped until layout could plausibly have changed.
let queueAllUnrendered = false;
// Set by user activity (scroll, resize, pointer, keys) that could change what
// is rendered; forces the next pick to re-score.
let layoutDirty = true;

// ── Page Language Detection ──

async function detectPageLanguage(): Promise<void> {
  if (barDismissed) return;

  // Wait for page to settle
  await new Promise((r) => setTimeout(r, 500));

  const bodyText = document.body?.innerText ?? "";
  if (bodyText.trim().length < 50) return;

  // Get preferred language and theme from storage
  const stored = await chrome.storage.local.get(["preferredLanguage", "theme"]);
  preferredLangCode = stored.preferredLanguage || "en";
  preferredLangName = getLanguageNameInline(preferredLangCode);
  const isDark = (stored.theme || "dark") === "dark";

  // Check for cached translation first
  const cached = await loadCache();
  if (cached && cached.targetLang === preferredLangCode) {
    const applied = applyCachedTranslation(cached);
    if (applied) {
      detectedLangCode = cached.sourceLang;
      showingOriginal = false;
      injectTranslateBar(isDark, "done");
      // The page was translated before, so keep up with content it adds later.
      startObserving(isDark);
      broadcastToFrames();
      return;
    }
  }

  const sample = bodyText.substring(0, 500);

  // Detect page language via offscreen document
  let response: any;
  try {
    response = await chrome.runtime.sendMessage({
      action: "DETECT_LANGUAGE",
      text: sample,
    });
  } catch {
    return; // Extension context may be invalidated
  }

  if (!response || response.action !== "DETECT_LANGUAGE_RESULT") return;
  if (!response.langCode) return;

  detectedLangCode = response.langCode;

  // Compare detected language to preferred
  const detectedBase = detectedLangCode.split("_")[0].toLowerCase();
  const preferredBase = preferredLangCode.split("_")[0].toLowerCase();

  if (detectedBase === preferredBase) return;

  // Also check the page's lang attribute as a fast path
  const htmlLang = document.documentElement.lang?.toLowerCase().split("-")[0];
  if (htmlLang && htmlLang === preferredBase) return;

  injectTranslateBar(isDark, "idle");
}

async function startPageTranslationFromMenu(): Promise<void> {
  barDismissed = false;

  const stored = await chrome.storage.local.get(["preferredLanguage", "theme"]);
  preferredLangCode = stored.preferredLanguage || "en";
  preferredLangName = getLanguageNameInline(preferredLangCode);
  const isDark = (stored.theme || "dark") === "dark";

  if (!detectedLangCode) {
    const bodyText = document.body?.innerText ?? "";
    const sample = bodyText.substring(0, 500);
    if (sample.trim().length > 0) {
      try {
        const response: any = await chrome.runtime.sendMessage({
          action: "DETECT_LANGUAGE",
          text: sample,
        });
        if (response?.action === "DETECT_LANGUAGE_RESULT" && response.langCode) {
          detectedLangCode = response.langCode;
        }
      } catch {
        // Extension context may be invalidated
      }
    }
    if (!detectedLangCode) {
      injectTranslateBar(isDark, "error");
      renderBar(isDark, "error", "Could not detect page language");
      return;
    }
  }

  injectTranslateBar(isDark, "idle");
  await translatePage(isDark);
}

function applyCachedTranslation(cached: CachedTranslation): boolean {
  resetTranslationState();

  let appliedCount = 0;
  for (const group of collectGroups()) {
    for (const unit of group.units) {
      const entry = cached.entries[unit.index];
      // Index alone is not enough — the page may have changed since the cache
      // was written, which would shift units into each other's slots.
      if (entry && entry.original === unit.original) {
        applyTranslation(unit, entry.translated);
        appliedCount++;
      }
    }
  }

  // Counts toward the session total so a later background drain (triggered by
  // new content) doesn't mistake "nothing translated this run" for a failure.
  translatedUnits += appliedCount;
  visibleWorkDone = appliedCount > 0;

  // Only consider it a successful restore if we matched a meaningful portion
  return appliedCount > 0;
}

// Inline language name lookup (content scripts can't import)
function getLanguageNameInline(code: string): string {
  const map: Record<string, string> = {
    ar: "Arabic", bg_BG: "Bulgarian", bn_BD: "Bengali", ca_ES: "Catalan",
    cs_CZ: "Czech", da_DK: "Danish", de_DE: "German", el_GR: "Greek",
    en: "English", es_ES: "Spanish", et_EE: "Estonian", fa_IR: "Persian",
    fi_FI: "Finnish", fr_FR: "French", gl_ES: "Galician", gu_IN: "Gujarati",
    he_IL: "Hebrew", hi_IN: "Hindi", hr_HR: "Croatian", hu_HU: "Hungarian",
    id_ID: "Indonesian", it_IT: "Italian", ja_JP: "Japanese", kn_IN: "Kannada",
    ko_KR: "Korean", lt_LT: "Lithuanian", lv_LV: "Latvian", mk_MK: "Macedonian",
    ml_IN: "Malayalam", mr_IN: "Marathi", ms_MY: "Malay", mt_MT: "Maltese",
    nl_NL: "Dutch", no_NO: "Norwegian", pl_PL: "Polish",
    pt_BR: "Portuguese (Brazil)", pt_PT: "Portuguese (Portugal)",
    ro_RO: "Romanian", ru_RU: "Russian", sk_SK: "Slovak", sl_SI: "Slovenian",
    sq_AL: "Albanian", sr_RS: "Serbian", sv_SE: "Swedish", sw: "Swahili",
    ta_IN: "Tamil", te_IN: "Telugu", th_TH: "Thai", tr_TR: "Turkish",
    uk_UA: "Ukrainian", ur_PK: "Urdu", vi_VN: "Vietnamese",
    zh_CN: "Chinese (Simplified)", zh_TW: "Chinese (Traditional)",
  };
  return map[code] || code;
}

// ── Translate Bar UI ──

function injectTranslateBar(isDark: boolean, initialState: BarState = "idle"): void {
  if (shadowHost || !IS_TOP_FRAME) return;

  shadowHost = document.createElement("div");
  shadowHost.id = "chouette-translate-bar";
  shadowRoot = shadowHost.attachShadow({ mode: "closed" });
  document.documentElement.appendChild(shadowHost);

  renderBar(isDark, initialState);
}

type BarState = "idle" | "loading-model" | "translating" | "done" | "error";

function renderBar(isDark: boolean, state: BarState, errorMessage?: string): void {
  if (!shadowRoot) return;

  // Clear previous content
  shadowRoot.textContent = "";

  const style = document.createElement("style");
  style.textContent = getBarStyles(isDark);
  shadowRoot.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "translate-bar";

  // Icon
  const iconSpan = document.createElement("span");
  iconSpan.className = "translate-icon";
  iconSpan.appendChild(createTranslateIcon());
  bar.appendChild(iconSpan);

  // Label
  const label = document.createElement("span");
  label.className = "translate-label";

  if (state === "idle") {
    label.textContent = `Translate to ${preferredLangName}`;
    bar.appendChild(label);

    const btn = document.createElement("button");
    btn.className = "translate-btn";
    btn.id = "chouette-do-translate";
    btn.textContent = "Translate";
    btn.addEventListener("click", () => translatePage(isDark));
    bar.appendChild(btn);
  } else if (state === "loading-model") {
    label.textContent = "Loading model...";
    bar.appendChild(label);

    const progress = document.createElement("span");
    progress.className = "progress-text";
    progress.id = "chouette-progress";
    progress.textContent = "first run may take a while";
    bar.appendChild(progress);
  } else if (state === "translating") {
    label.textContent = "Translating...";
    bar.appendChild(label);

    const progress = document.createElement("span");
    progress.className = "progress-text";
    progress.id = "chouette-progress";
    progress.textContent = "0%";
    bar.appendChild(progress);
  } else if (state === "done") {
    label.textContent = `Translated to ${preferredLangName}`;
    bar.appendChild(label);

    // Background work may still be draining hidden content.
    if (draining) {
      const progress = document.createElement("span");
      progress.className = "progress-text";
      progress.id = "chouette-progress";
      progress.textContent = "finishing hidden content...";
      bar.appendChild(progress);
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.id = "chouette-toggle";
    toggleBtn.textContent = showingOriginal ? "Show Translation" : "Show Original";
    toggleBtn.addEventListener("click", () => {
      toggleOriginal();
      renderBar(isDark, "done");
    });
    bar.appendChild(toggleBtn);
  } else if (state === "error") {
    label.textContent = errorMessage || "Translation failed";
    bar.appendChild(label);

    const retryBtn = document.createElement("button");
    retryBtn.className = "translate-btn";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", () => translatePage(isDark));
    bar.appendChild(retryBtn);
  }

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "close-btn";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => {
    barDismissed = true;
    shadowHost?.remove();
    shadowHost = null;
    shadowRoot = null;
    removeShimmerStyles();
  });
  bar.appendChild(closeBtn);

  shadowRoot.appendChild(bar);
}

// ── DOM Text Extraction ──

// Shadow roots found during traversal, so the mutation observer can watch them
// too — observing document.body does not cross shadow boundaries.
const discoveredRoots = new Set<Node>();

function stateFor(unit: Unit): UnitState | undefined {
  if (unit.node) return textStates.get(unit.node);
  return unit.attr ? attrStates.get(unit.el)?.get(unit.attr) : undefined;
}

function isKnown(el: Element, node: Text | null, attr: string | null): boolean {
  if (node) return textStates.has(node);
  return attr !== null && (attrStates.get(el)?.has(attr) ?? false);
}

function registerState(unit: Unit): void {
  const state: UnitState = { original: unit.original, translated: "", index: unit.index };
  if (unit.node) {
    textStates.set(unit.node, state);
    return;
  }
  if (!unit.attr) return;
  let byAttr = attrStates.get(unit.el);
  if (!byAttr) {
    byAttr = new Map();
    attrStates.set(unit.el, byAttr);
  }
  byAttr.set(unit.attr, state);
}

// Walks the light DOM and every open shadow root, grouping translatable units
// by their nearest block-level ancestor. Units already registered from a prior
// pass are skipped, so a rescan after a DOM mutation yields only what is new.
function collectGroups(): Group[] {
  const groups: Group[] = [];
  const byAncestor = new Map<Element, Group>();

  function addUnit(ancestor: Element, el: Element, node: Text | null, attr: string | null, original: string): void {
    let group = byAncestor.get(ancestor);
    if (!group) {
      group = { ancestor, units: [] };
      byAncestor.set(ancestor, group);
      groups.push(group);
    }
    const unit: Unit = { el, node, attr, original, index: nextUnitIndex++ };
    group.units.push(unit);
    registerState(unit);
  }

  function walk(root: Node, ancestor: Element): void {
    for (let child = root.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child as Text;
        const value = text.textContent;
        if (!value || !value.trim()) continue;
        if (isKnown(root as Element, text, null)) continue;
        addUnit(ancestor, root as Element, text, null, value);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const el = child as Element;
      const tag = el.tagName;
      if (el === shadowHost || OPAQUE_TAGS.has(tag)) continue;

      // Attribute text is prose wherever it appears, including on elements
      // whose own text content we refuse to touch.
      for (const attr of TRANSLATABLE_ATTRS) {
        const value = el.getAttribute(attr);
        if (!value || !value.trim()) continue;
        if (isKnown(el, null, attr)) continue;
        addUnit(ancestor, el, null, attr, value);
      }
      if (tag === "INPUT" && BUTTON_INPUT_TYPES.has((el as HTMLInputElement).type)) {
        const value = el.getAttribute("value");
        if (value && value.trim() && !isKnown(el, null, "value")) {
          addUnit(ancestor, el, null, "value", value);
        }
      }

      const nextAncestor = BLOCK_TAGS.has(tag) ? el : ancestor;

      // Closed shadow roots are unreachable by design; open ones are ours to
      // walk. Our own bar uses a closed root, so it is invisible here.
      if (el.shadowRoot) {
        discoveredRoots.add(el.shadowRoot);
        walk(el.shadowRoot, nextAncestor);
      }

      if (NO_TEXT_TAGS.has(tag)) continue;

      // Text the user is authoring is theirs, not ours. Note contenteditable
      // is "editable unless explicitly false" — "" and "plaintext-only" both
      // mean editable.
      const editable = el.getAttribute("contenteditable");
      if (editable !== null && editable !== "false") continue;

      // An <option> with no value attribute submits its own text content, so
      // translating it would change what the form sends.
      if (tag === "OPTION" && !el.hasAttribute("value")) continue;

      walk(el, nextAncestor);
    }
  }

  if (!document.body) return [];
  walk(document.body, document.body);
  return groups;
}

// ── Scheduling ──

// Distance from the viewport in CSS pixels: 0 means on screen, larger means
// further away, Infinity means not rendered at all (display:none, a collapsed
// menu, a detached node). Recomputed on every pick so the queue follows the
// user as they scroll, and so a dropdown that opens mid-run is promoted.
function priorityOf(group: Group): number {
  const el = group.ancestor;
  if (!el.isConnected) return OFFSCREEN_PRIORITY;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return OFFSCREEN_PRIORITY;

  const viewportHeight = window.innerHeight;
  if (rect.bottom >= 0 && rect.top <= viewportHeight) return 0;
  return rect.top > viewportHeight ? rect.top - viewportHeight : -rect.bottom;
}

// Anything that could reveal hidden content — scrolling, resizing, hover
// menus, clicks, keyboard navigation. Handlers only set a flag, so listening
// broadly costs nothing.
let activityListenersInstalled = false;

function installActivityListeners(): void {
  if (activityListenersInstalled) return;
  activityListenersInstalled = true;
  const markDirty = () => {
    layoutDirty = true;
  };
  const options = { capture: true, passive: true } as const;
  window.addEventListener("scroll", markDirty, options);
  window.addEventListener("resize", markDirty, options);
  window.addEventListener("pointerdown", markDirty, options);
  window.addEventListener("pointerover", markDirty, options);
  window.addEventListener("keydown", markDirty, options);
}

// ── Shimmer Styles ──

let shimmerStyleEl: HTMLStyleElement | null = null;

// Concurrent sub-jobs of one group share an ancestor; the shimmer class must
// survive until the last of them completes.
const shimmerRefs = new Map<Element, number>();

function injectShimmerStyles(): void {
  if (shimmerStyleEl) return;
  shimmerStyleEl = document.createElement("style");
  shimmerStyleEl.textContent = `
    .chouette-translating {
      position: relative;
      overflow: hidden;
    }
    .chouette-translating::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(111,165,134,0.08), transparent);
      animation: chouette-shimmer 1.5s ease-in-out infinite;
      pointer-events: none;
      border-radius: 4px;
    }
    @keyframes chouette-shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
  `;
  document.head.appendChild(shimmerStyleEl);
}

function removeShimmerStyles(): void {
  shimmerStyleEl?.remove();
  shimmerStyleEl = null;
}

// ── Applying Translations ──

function writeUnit(unit: Unit, value: string): void {
  if (unit.node) {
    if (unit.node.isConnected) unit.node.textContent = value;
    return;
  }
  if (unit.attr && unit.el.isConnected) unit.el.setAttribute(unit.attr, value);
}

function applyTranslation(unit: Unit, translated: string): void {
  // A unit can be pruned while it sits in the queue (its node detached) and
  // then re-attached before its turn comes up. Re-register it, or the write
  // below lands with no state behind it — Show Original would skip the node,
  // it would never reach the cache, and the next rescan would re-collect it
  // treating the translated text as the original, translating a translation.
  let state = stateFor(unit);
  if (!state) {
    registerState(unit);
    state = stateFor(unit);
  }
  if (state) state.translated = translated;

  translationMemo.set(unit.original, translated);
  evictOldest(translationMemo, MAX_MEMO_ENTRIES);

  // Respect the toggle: content that arrives while the user is viewing the
  // original should stay original.
  writeUnit(unit, showingOriginal ? unit.original : translated);
}

function isUnitLive(unit: Unit): boolean {
  return unit.node ? unit.node.isConnected : unit.el.isConnected;
}

function resetTranslationState(): void {
  for (const [node, state] of textStates) {
    if (node.isConnected && state.translated) node.textContent = state.original;
  }
  for (const [el, byAttr] of attrStates) {
    for (const [attr, state] of byAttr) {
      if (el.isConnected && state.translated) el.setAttribute(attr, state.original);
    }
  }
  textStates.clear();
  attrStates.clear();
  prunedEntries.clear();
  translationMemo.clear();
  queue = [];
  nextUnitIndex = 0;
  totalScheduled = 0;
  completedGroups = 0;
  translatedUnits = 0;
  visibleWorkDone = false;
  queueAllUnrendered = false;
  layoutDirty = true;
  showingOriginal = false;
  // Supersede any still-queued work from the previous run — in-flight
  // responses for the old epoch are discarded on arrival, and the offscreen
  // scheduler drops the old epoch's queued jobs.
  translateEpoch++;
}

// Recognises a record as one of our own writes, so self-writes don't schedule
// no-op rescans. Attribution rather than draining: takeRecords() would also
// discard genuine page mutations that happen to be pending — a page mutating
// in the same task as our writes, or a custom element's synchronous
// attributeChangedCallback firing off our own setAttribute — and that content
// would then stay untranslated until the page happened to mutate again.
//
// childList is never ours: we only rewrite text and attributes in place.
function isOwnMutation(record: MutationRecord): boolean {
  if (record.type !== "attributes" || !record.attributeName) return false;
  const state = attrStates.get(record.target as Element)?.get(record.attributeName);
  if (!state || !state.translated) return false;
  const current = (record.target as Element).getAttribute(record.attributeName);
  return current === (showingOriginal ? state.original : state.translated);
}

// The state maps hold strong references, so on a long-lived single-page app
// the entries for removed content would pin every detached subtree forever.
// Restore each detached node's original text before letting go of it — if the
// page re-attaches the node (recycled list rows, cached views), a rescan then
// re-collects it from clean source text instead of translating a translation.
function pruneDisconnected(): void {
  for (const [node, state] of textStates) {
    if (node.isConnected) continue;
    if (state.translated) {
      prunedEntries.set(state.index, { original: state.original, translated: state.translated });
      node.textContent = state.original;
    }
    textStates.delete(node);
  }
  for (const [el, byAttr] of attrStates) {
    if (el.isConnected) continue;
    for (const [attr, state] of byAttr) {
      if (state.translated) {
        prunedEntries.set(state.index, { original: state.original, translated: state.translated });
        el.setAttribute(attr, state.original);
      }
    }
    attrStates.delete(el);
  }
  // Unbounded, this would grow with every removed row on an infinite feed and
  // be re-serialized into storage on every save until the quota rejected it.
  evictOldest(prunedEntries, MAX_PRUNED_ENTRIES);
  for (const root of discoveredRoots) {
    if (!(root as ShadowRoot).host?.isConnected) discoveredRoots.delete(root);
  }
}

// ── Page Translation ──

async function ensureModelLoaded(): Promise<{ ok: true } | { ok: false; error: string }> {
  let response: any;
  try {
    response = await chrome.runtime.sendMessage({ action: "LOAD_MODEL" });
  } catch (err: any) {
    return { ok: false, error: err?.message || "Extension unavailable" };
  }

  if (response?.action === "MODEL_STATUS" && response.status === "ready") {
    return { ok: true };
  }
  if (response?.action === "TRANSLATE_ERROR") {
    return { ok: false, error: response.error || "Failed to load model" };
  }
  return { ok: false, error: "Failed to load model" };
}

async function translatePage(isDark: boolean): Promise<void> {
  if (draining) return;

  renderBar(isDark, "loading-model");

  // Pre-flight: ensure the translation model is loaded. Without this,
  // a not-loaded model auto-loads on each TRANSLATE call, and any
  // failure surfaces as a TRANSLATE_ERROR response which the loop
  // below would otherwise silently ignore.
  const loadResult = await ensureModelLoaded();
  if (!loadResult.ok) {
    renderBar(isDark, "error", "Model not loaded — open extension to download");
    return;
  }

  renderBar(isDark, "translating");
  broadcastToFrames();

  // If a previous translation is already applied (e.g. restored from cache, or
  // a prior translate in this session), revert first — otherwise the capture
  // below would record already-translated text as the "original".
  resetTranslationState();

  const groups = collectGroups();
  if (groups.length === 0) {
    renderBar(isDark, "idle");
    return;
  }

  queue.push(...groups);
  totalScheduled = groups.length;

  await processQueue(isDark);
}

async function processQueue(isDark: boolean): Promise<void> {
  if (draining || queue.length === 0) return;

  draining = true;
  installActivityListeners();
  injectShimmerStyles();
  let lastError: string | null = null;
  const epoch = translateEpoch;

  try {
    // Keep up to MAX_IN_FLIGHT_GROUPS group requests outstanding. The
    // offscreen scheduler coalesces whatever is pending into batches sized
    // to the device, so on a capable machine several groups translate in one
    // GPU pass while a weak one drains them effectively one at a time.
    await new Promise<void>((resolve) => {
      const pump = (): void => {
        if (epoch !== translateEpoch) {
          // Superseded by a newer run; let it own the queue.
          queue = [];
          if (inFlightGroups === 0) resolve();
          return;
        }

        while (inFlightGroups < MAX_IN_FLIGHT_GROUPS && queue.length > 0) {
          // Re-score every remaining group against the current scroll
          // position. O(n) per pick is free next to a model round-trip, and
          // ties resolve to the earliest in DOM order because the comparison
          // is strict.
          //
          // Exception: once a scan has found nothing rendered left, every
          // pick would rescan an all-hidden tail for nothing — O(n²) rect
          // reads on pages with much hidden content. Skip the scan until
          // user activity (or a rescan appending content) could have changed
          // what's rendered.
          let best = 0;
          let bestPriority = OFFSCREEN_PRIORITY;
          if (!queueAllUnrendered || layoutDirty) {
            layoutDirty = false;
            bestPriority = priorityOf(queue[0]);
            for (let i = 1; i < queue.length && bestPriority > 0; i++) {
              const priority = priorityOf(queue[i]);
              if (priority < bestPriority) {
                best = i;
                bestPriority = priority;
              }
            }
            queueAllUnrendered = bestPriority === OFFSCREEN_PRIORITY;
          }

          // Nothing rendered is left to start and nothing rendered is still
          // in flight: everything the user can see is translated, so release
          // the bar and drain the rest in the background.
          if (
            bestPriority === OFFSCREEN_PRIORITY &&
            inFlightRendered === 0 &&
            !visibleWorkDone &&
            translatedUnits > 0
          ) {
            visibleWorkDone = true;
            renderBar(isDark, "done");
          }

          let group = queue.splice(best, 1)[0];

          // Slice an over-large group into a dispatchable head sub-job and
          // put the remainder back where the group was — it competes in the
          // next pick at the same priority (same ancestor).
          if (group.units.length > 1) {
            let cut = 0;
            let chars = 0;
            while (
              cut < group.units.length &&
              cut < SUBJOB_MAX_UNITS &&
              (cut === 0 || chars + group.units[cut].original.length <= SUBJOB_MAX_CHARS)
            ) {
              chars += group.units[cut].original.length;
              cut++;
            }
            if (cut < group.units.length) {
              const rest: Group = { ancestor: group.ancestor, units: group.units.slice(cut) };
              group = { ancestor: group.ancestor, units: group.units.slice(0, cut) };
              queue.splice(best, 0, rest);
              totalScheduled++;
            }
          }

          const rendered = bestPriority !== OFFSCREEN_PRIORITY;
          inFlightGroups++;
          if (rendered) inFlightRendered++;

          translateGroup(group, bestPriority).then((result) => {
            inFlightGroups--;
            if (rendered) inFlightRendered--;

            // A response for a superseded run must not touch the new run's
            // counters; translateGroup already discards its translations.
            if (epoch === translateEpoch) {
              translatedUnits += result.count;
              if (!result.ok) {
                lastError = result.error ?? "Translation failed";
                queue = [];
              } else {
                completedGroups++;
                updateProgress(completedGroups, totalScheduled);
                scheduleCacheSave();
              }
            }
            pump();
          });
        }

        if (inFlightGroups === 0 && queue.length === 0) resolve();
      };
      pump();
    });
  } finally {
    // translateGroup clears its own shimmer class in a finally, so nothing can
    // be left highlighted here.
    draining = false;
    removeShimmerStyles();
  }

  snapshotCache();

  if (translatedUnits === 0) {
    renderBar(isDark, "error", lastError ? `Translation failed: ${lastError}` : "Translation failed");
    return;
  }

  visibleWorkDone = true;
  renderBar(isDark, "done");

  // Only watch for new content once a translation has actually happened —
  // observing earlier would churn on the page's own load-time mutations.
  startObserving(isDark);
}

async function translateGroup(
  group: Group,
  priority: number
): Promise<{ ok: boolean; error?: string; count: number }> {
  const units = group.units.filter(isUnitLive);
  if (units.length === 0) return { ok: true, count: 0 };

  // Anything we have already translated on this page is free.
  const pending: Unit[] = [];
  let memoCount = 0;
  for (const unit of units) {
    const hit = translationMemo.get(unit.original);
    if (hit === undefined) {
      pending.push(unit);
    } else {
      applyTranslation(unit, hit);
      memoCount++;
    }
  }
  if (pending.length === 0) return { ok: true, count: memoCount };

  // Skip the shimmer on body to avoid highlighting the entire page.
  // Sub-jobs of the same group share an ancestor, so the class is
  // reference-counted: it comes off when the last one finishes.
  const useShimmer = group.ancestor !== document.body && group.ancestor.isConnected;
  if (useShimmer) {
    shimmerRefs.set(group.ancestor, (shimmerRefs.get(group.ancestor) ?? 0) + 1);
    group.ancestor.classList.add("chouette-translating");
  }

  const epochAtDispatch = translateEpoch;

  try {
    // Units travel as an array with per-unit results; how they are joined
    // into model calls is the offscreen scheduler's concern.
    const response: any = await chrome.runtime.sendMessage({
      action: "TRANSLATE_BATCH",
      texts: pending.map((u) => u.original),
      sourceLang: detectedLangCode!,
      targetLang: preferredLangCode,
      priority: priority === OFFSCREEN_PRIORITY ? UNRENDERED_PRIORITY_WIRE : priority,
      clientId: CLIENT_ID,
      epoch: epochAtDispatch,
    });

    // A newer run reset the page while we waited; its own requests will
    // cover these nodes with fresh originals.
    if (translateEpoch !== epochAtDispatch) return { ok: true, count: 0 };

    if (response?.action === "TRANSLATE_ERROR") {
      return { ok: false, error: response.error || "Translation failed", count: memoCount };
    }
    if (
      response?.action !== "TRANSLATE_BATCH_RESULT" ||
      !Array.isArray(response.translations)
    ) {
      return { ok: true, count: memoCount };
    }

    // null entries mean "keep the original" (refusal or a failed item).
    let applied = 0;
    const limit = Math.min(pending.length, response.translations.length);
    for (let i = 0; i < limit; i++) {
      const translated = response.translations[i];
      if (typeof translated === "string" && translated.trim()) {
        applyTranslation(pending[i], translated.trim());
        applied++;
      }
    }

    if (response.error) {
      // Partial failure: keep what succeeded, surface the error.
      return { ok: false, error: response.error, count: memoCount + applied };
    }
    return { ok: true, count: memoCount + applied };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Translation failed", count: memoCount };
  } finally {
    if (useShimmer) {
      const refs = (shimmerRefs.get(group.ancestor) ?? 1) - 1;
      if (refs <= 0) {
        shimmerRefs.delete(group.ancestor);
        group.ancestor.classList.remove("chouette-translating");
      } else {
        shimmerRefs.set(group.ancestor, refs);
      }
    }
  }
}

function updateProgress(completed: number, total: number): void {
  if (!shadowRoot) return;
  const progressEl = shadowRoot.getElementById("chouette-progress");
  if (progressEl) {
    const percent = Math.round((completed / total) * 100);
    progressEl.textContent = `${percent}% (${completed}/${total})`;
  }
}

// ── Incremental Cache Saves ──

let cacheSaveTimer: number | null = null;

function snapshotCache(): void {
  if (!detectedLangCode) return;
  if (cacheSaveTimer !== null) {
    clearTimeout(cacheSaveTimer);
    cacheSaveTimer = null;
  }

  // Start from the pruned entries so translations for since-removed nodes
  // still make it into the cache.
  const entries: Record<number, { original: string; translated: string }> = {};
  for (const [index, entry] of prunedEntries) entries[index] = entry;
  for (const state of textStates.values()) {
    if (state.translated) entries[state.index] = { original: state.original, translated: state.translated };
  }
  for (const byAttr of attrStates.values()) {
    for (const state of byAttr.values()) {
      if (state.translated) entries[state.index] = { original: state.original, translated: state.translated };
    }
  }

  saveCache({
    version: CACHE_VERSION,
    sourceLang: detectedLangCode,
    targetLang: preferredLangCode,
    entries,
  });
}

// Rebuilding the entry map is O(units), so writing it after every group is
// quadratic on a large page. Coalesce instead; processQueue forces a final
// save when it finishes.
function scheduleCacheSave(): void {
  if (cacheSaveTimer !== null) return;
  cacheSaveTimer = window.setTimeout(() => {
    cacheSaveTimer = null;
    snapshotCache();
  }, CACHE_SAVE_INTERVAL_MS);
}

// ── Watching for New Content ──

let observer: MutationObserver | null = null;
let rescanTimer: number | null = null;
let rescanDeadline: number | null = null;

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  // characterData is deliberately absent: we write text via textContent on
  // existing nodes, and observing it would feed our own writes back to us.
  attributeFilter: [...TRANSLATABLE_ATTRS, "value"],
};

function startObserving(isDark: boolean): void {
  if (observer || !document.body) return;

  observer = new MutationObserver((records) => {
    if (records.every(isOwnMutation)) return;
    scheduleRescan(isDark);
  });
  observer.observe(document.body, OBSERVER_OPTIONS);
  for (const root of discoveredRoots) observer.observe(root, OBSERVER_OPTIONS);
}

function scheduleRescan(isDark: boolean): void {
  const now = Date.now();
  // Trailing debounce with a hard deadline: each mutation pushes the rescan
  // back, but never past the deadline set by the first postponed one.
  if (rescanDeadline === null) rescanDeadline = now + RESCAN_MAX_WAIT_MS;
  if (rescanTimer !== null) clearTimeout(rescanTimer);
  const delay = Math.max(0, Math.min(RESCAN_DEBOUNCE_MS, rescanDeadline - now));
  rescanTimer = window.setTimeout(() => {
    rescanTimer = null;
    rescanDeadline = null;
    rescan(isDark);
  }, delay);
}

function rescan(isDark: boolean): void {
  if (!detectedLangCode) return;

  pruneDisconnected();

  const knownRoots = discoveredRoots.size;
  // collectGroups skips everything already registered, so our own attribute
  // writes come back as zero new units rather than as a re-translate loop.
  const fresh = collectGroups();

  // Watch any shadow roots that appeared along with the new content.
  if (observer && discoveredRoots.size > knownRoots) {
    for (const root of discoveredRoots) observer.observe(root, OBSERVER_OPTIONS);
  }

  // Newly attached iframes need driving too.
  broadcastToFrames();

  if (fresh.length === 0) return;

  queue.push(...fresh);
  totalScheduled += fresh.length;
  // The new content may well be rendered; make the next pick look.
  queueAllUnrendered = false;
  processQueue(isDark);
}

// ── Sub-Frame Coordination ──

// Relayed through the background, whose chrome.tabs.sendMessage fans out to
// every frame of the tab at any nesting depth. Page scripts cannot forge
// messages on this channel, unlike window.postMessage.
function broadcastToFrames(): void {
  // The relay reaches every frame of the tab at any nesting depth, so only the
  // top frame needs to ask. Letting sub-frames re-ask would make each of N
  // frames trigger its own tab-wide fan-out.
  if (!IS_TOP_FRAME || !detectedLangCode) return;
  try {
    chrome.runtime
      .sendMessage({
        action: "RELAY_FRAME_TRANSLATION",
        sourceLang: detectedLangCode,
        targetLang: preferredLangCode,
      })
      .catch(() => {
        // Extension context may be invalidated
      });
  } catch {
    // Extension context may be invalidated
  }
}

function startFrameTranslation(message: any): void {
  if (IS_TOP_FRAME) return; // The top frame drives itself
  if (frameTranslationStarted) return; // Ignore repeat broadcasts
  if (typeof message.sourceLang !== "string" || typeof message.targetLang !== "string") return;

  frameTranslationStarted = true;
  detectedLangCode = message.sourceLang;
  preferredLangCode = message.targetLang;

  // Sub-frames render no bar; every renderBar call below is inert because
  // shadowRoot is null in this frame.
  translatePage(false);
}

// ── Show Original Toggle ──

function toggleOriginal(): void {
  showingOriginal = !showingOriginal;

  for (const [node, state] of textStates) {
    if (node.isConnected && state.translated) {
      node.textContent = showingOriginal ? state.original : state.translated;
    }
  }
  for (const [el, byAttr] of attrStates) {
    for (const [attr, state] of byAttr) {
      if (el.isConnected && state.translated) {
        el.setAttribute(attr, showingOriginal ? state.original : state.translated);
      }
    }
  }
}

// ── Init ──

if (IS_TOP_FRAME) {
  cleanupExpiredCaches();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => detectPageLanguage());
  } else {
    detectPageLanguage();
  }
}
