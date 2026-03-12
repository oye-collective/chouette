// Content script — must be self-contained (no ES module imports)
// because MV3 content scripts are loaded as classic scripts.

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

// ── Constants ──

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE",
  "TEXTAREA", "INPUT", "SVG", "IFRAME", "SELECT",
  "OPTION", "CANVAS", "VIDEO", "AUDIO", "IMG",
]);

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "TD", "TH", "DIV", "BLOCKQUOTE", "ARTICLE",
  "SECTION", "FIGCAPTION", "CAPTION", "DT", "DD",
  "HEADER", "FOOTER", "NAV", "MAIN", "ASIDE",
]);

const DELIMITER = "|||";

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
  sourceLang: string;
  targetLang: string;
  // Keyed by text node index (DOM order) → { original, translated }
  entries: Record<number, { original: string; translated: string }>;
}

function getCacheKey(): string {
  return `translate_cache:${location.href}`;
}

async function loadCache(): Promise<CachedTranslation | null> {
  try {
    const key = getCacheKey();
    const result = await chrome.storage.session.get(key);
    return result[key] ?? null;
  } catch {
    return null;
  }
}

async function saveCache(cache: CachedTranslation): Promise<void> {
  try {
    await chrome.storage.session.set({ [getCacheKey()]: cache });
  } catch {
    // Storage quota exceeded or context invalidated — ignore
  }
}

async function clearCache(): Promise<void> {
  try {
    await chrome.storage.session.remove(getCacheKey());
  } catch {
    // Ignore
  }
}

// ── State ──

let barDismissed = false;
let detectedLangCode: string | null = null;
let preferredLangCode: string = "en";
let preferredLangName: string = "English";
let shadowHost: HTMLDivElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let showingOriginal = false;
const textNodeMap: Map<Text, { original: string; translated: string; index: number }> = new Map();

// ── Page Language Detection ──

async function detectPageLanguage(): Promise<void> {
  if (barDismissed) return;

  // Wait for page to settle
  await new Promise((r) => setTimeout(r, 500));

  const bodyText = document.body?.innerText ?? "";
  if (bodyText.trim().length < 50) return;

  // Get preferred language from storage
  const stored = await chrome.storage.local.get("preferredLanguage");
  preferredLangCode = stored.preferredLanguage || "en";
  preferredLangName = getLanguageNameInline(preferredLangCode);

  // Check for cached translation first
  const cached = await loadCache();
  if (cached && cached.targetLang === preferredLangCode) {
    const applied = applyCachedTranslation(cached);
    if (applied) {
      detectedLangCode = cached.sourceLang;
      showingOriginal = false;
      injectTranslateBar();
      chrome.storage.local.get("theme", (result) => {
        const isDark = (result.theme || "dark") === "dark";
        renderBar(isDark, "done");
      });
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

  injectTranslateBar();
}

function applyCachedTranslation(cached: CachedTranslation): boolean {
  const groups = collectTextNodes();
  let nodeIndex = 0;
  let appliedCount = 0;

  for (const group of groups) {
    for (const node of group.nodes) {
      const entry = cached.entries[nodeIndex];
      if (entry && node.textContent === entry.original) {
        textNodeMap.set(node, {
          original: entry.original,
          translated: entry.translated,
          index: nodeIndex,
        });
        node.textContent = entry.translated;
        appliedCount++;
      }
      nodeIndex++;
    }
  }

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

function injectTranslateBar(): void {
  if (shadowHost) return;

  shadowHost = document.createElement("div");
  shadowHost.id = "chouette-translate-bar";
  shadowRoot = shadowHost.attachShadow({ mode: "closed" });

  chrome.storage.local.get("theme", (result) => {
    const isDark = (result.theme || "dark") === "dark";
    renderBar(isDark, "idle");
  });

  document.documentElement.appendChild(shadowHost);
}

function renderBar(isDark: boolean, state: "idle" | "translating" | "done"): void {
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

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "toggle-btn";
    toggleBtn.id = "chouette-toggle";
    toggleBtn.textContent = showingOriginal ? "Show Translation" : "Show Original";
    toggleBtn.addEventListener("click", () => {
      toggleOriginal();
      renderBar(isDark, "done");
    });
    bar.appendChild(toggleBtn);
  }

  // Close button
  const closeBtn = document.createElement("button");
  closeBtn.className = "close-btn";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "\u00D7";
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

interface BlockGroup {
  ancestor: Element;
  nodes: Text[];
}

function collectTextNodes(): BlockGroup[] {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node: Text): number {
        // Skip our own injected bar
        if (shadowHost?.contains(node)) return NodeFilter.FILTER_REJECT;

        // Skip nodes in excluded tags
        let parent = node.parentElement;
        while (parent) {
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.getAttribute("contenteditable") === "false") return NodeFilter.FILTER_REJECT;
          if (parent.getAttribute("aria-hidden") === "true") return NodeFilter.FILTER_REJECT;
          parent = parent.parentElement;
        }

        // Skip whitespace-only nodes
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  // Group by nearest block-level ancestor
  const groupMap = new Map<Element, Text[]>();
  const groupOrder: Element[] = [];

  let current: Text | null;
  while ((current = walker.nextNode() as Text | null)) {
    const blockAncestor = findBlockAncestor(current);
    if (!groupMap.has(blockAncestor)) {
      groupMap.set(blockAncestor, []);
      groupOrder.push(blockAncestor);
    }
    groupMap.get(blockAncestor)!.push(current);
  }

  return groupOrder.map((ancestor) => ({
    ancestor,
    nodes: groupMap.get(ancestor)!,
  }));
}

function findBlockAncestor(node: Node): Element {
  let current = node.parentElement;
  while (current && current !== document.body) {
    if (BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return document.body;
}

// ── Shimmer Styles ──

let shimmerStyleEl: HTMLStyleElement | null = null;

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

// ── Page Translation ──

async function translatePage(isDark: boolean): Promise<void> {
  renderBar(isDark, "translating");
  injectShimmerStyles();

  const groups = collectTextNodes();
  const totalGroups = groups.length;

  if (totalGroups === 0) {
    removeShimmerStyles();
    renderBar(isDark, "idle");
    return;
  }

  // Store originals with DOM-order indices (must match applyCachedTranslation)
  let nodeIndex = 0;
  for (const group of groups) {
    for (const node of group.nodes) {
      textNodeMap.set(node, { original: node.textContent!, translated: "", index: nodeIndex });
      nodeIndex++;
    }
  }

  // Sort groups: viewport-visible first, then rest in DOM order
  const viewportHeight = window.innerHeight;
  const visible: BlockGroup[] = [];
  const offscreen: BlockGroup[] = [];
  for (const group of groups) {
    const rect = group.ancestor.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= viewportHeight) {
      visible.push(group);
    } else {
      offscreen.push(group);
    }
  }
  const sortedGroups = [...visible, ...offscreen];

  let completed = 0;

  for (const group of sortedGroups) {
    // Add shimmer to the ancestor (skip body to avoid highlighting the entire page)
    const useShimmer = group.ancestor !== document.body;
    if (useShimmer) group.ancestor.classList.add("chouette-translating");

    const texts = group.nodes.map((n) => n.textContent!);
    const joined = texts.join(DELIMITER);

    try {
      const response: any = await chrome.runtime.sendMessage({
        action: "TRANSLATE",
        text: joined,
        sourceLang: detectedLangCode!,
        targetLang: preferredLangCode,
      });

      if (response?.action === "TRANSLATE_RESULT" && response.translatedText) {
        const parts = response.translatedText.split(DELIMITER);

        if (parts.length === group.nodes.length) {
          // Perfect split — assign each part
          for (let i = 0; i < group.nodes.length; i++) {
            const trimmed = parts[i].trim();
            group.nodes[i].textContent = trimmed;
            textNodeMap.get(group.nodes[i])!.translated = trimmed;
          }
        } else {
          // Delimiter mismatch — fall back to translating individually
          await translateNodesIndividually(group.nodes);
        }
      }
    } catch {
      // If translation fails for a group, skip it
    }

    if (useShimmer) group.ancestor.classList.remove("chouette-translating");

    completed++;
    updateProgress(completed, totalGroups);

    // Incremental cache save
    const cacheEntries: Record<number, { original: string; translated: string }> = {};
    for (const [, data] of textNodeMap) {
      if (data.translated) {
        cacheEntries[data.index] = { original: data.original, translated: data.translated };
      }
    }
    saveCache({
      sourceLang: detectedLangCode!,
      targetLang: preferredLangCode,
      entries: cacheEntries,
    });
  }

  removeShimmerStyles();
  showingOriginal = false;
  renderBar(isDark, "done");
}

async function translateNodesIndividually(nodes: Text[]): Promise<void> {
  for (const node of nodes) {
    const text = node.textContent!;
    if (!text.trim()) continue;

    try {
      const response: any = await chrome.runtime.sendMessage({
        action: "TRANSLATE",
        text,
        sourceLang: detectedLangCode!,
        targetLang: preferredLangCode,
      });

      if (response?.action === "TRANSLATE_RESULT" && response.translatedText) {
        node.textContent = response.translatedText;
        textNodeMap.get(node)!.translated = response.translatedText;
      }
    } catch {
      // Skip failed individual translations
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

// ── Show Original Toggle ──

function toggleOriginal(): void {
  showingOriginal = !showingOriginal;

  for (const [node, texts] of textNodeMap) {
    if (node.parentNode && texts.translated) {
      node.textContent = showingOriginal ? texts.original : texts.translated;
    }
  }
}

// ── Init ──

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => detectPageLanguage());
} else {
  detectPageLanguage();
}
