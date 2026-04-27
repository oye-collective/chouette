import { MessageAction, ExtensionMessage } from "../shared/messages";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES, getLanguageName } from "../shared/languages";
import { detectLanguage } from "../shared/language-detector";
import { buildReportIssueUrl } from "../shared/issue-reporter";
import "./popup.css";

// ── Theme ──

async function loadTheme(): Promise<void> {
  const result = await chrome.storage.local.get("theme");
  applyTheme(result.theme || "dark");
}

function applyTheme(theme: string): void {
  document.documentElement.setAttribute("data-theme", theme);
  const toggle = document.getElementById("theme-toggle") as HTMLButtonElement;
  const label = document.getElementById("theme-label") as HTMLElement;
  if (theme === "light") {
    toggle.classList.add("active");
    label.textContent = "Light";
  } else {
    toggle.classList.remove("active");
    label.textContent = "Dark";
  }
}

async function toggleTheme(): Promise<void> {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  await chrome.storage.local.set({ theme: next });
}

loadTheme();

// ── DOM Elements ──

const popupRoot = document.getElementById("popup-root") as HTMLElement;
const sourceLangSelect = document.getElementById("source-lang") as HTMLSelectElement;
const targetLangSelect = document.getElementById("target-lang") as HTMLSelectElement;
const sourceText = document.getElementById("source-text") as HTMLTextAreaElement;
const targetText = document.getElementById("target-text") as HTMLTextAreaElement;
const translateBtn = document.getElementById("translate-btn") as HTMLButtonElement;
const swapBtn = document.getElementById("swap-btn") as HTMLButtonElement;
const statusIndicator = document.getElementById("status-indicator") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const progressContainer = document.getElementById("progress-container") as HTMLElement;
const progressFill = document.getElementById("progress-fill") as HTMLElement;
const progressText = document.getElementById("progress-text") as HTMLElement;
const errorBanner = document.getElementById("error-banner") as HTMLElement;
const detectedLangEl = document.getElementById("detected-lang") as HTMLElement;

// Settings elements
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const backBtn = document.getElementById("back-btn") as HTMLButtonElement;
const themeToggle = document.getElementById("theme-toggle") as HTMLButtonElement;
const downloadModelBtn = document.getElementById("download-model-btn") as HTMLButtonElement;
const modelStatusDot = document.getElementById("model-status-dot") as HTMLElement;
const modelStatusLabel = document.getElementById("model-status-label") as HTMLElement;
const settingsProgressContainer = document.getElementById("settings-progress-container") as HTMLElement;
const settingsProgressFill = document.getElementById("settings-progress-fill") as HTMLElement;
const settingsProgressText = document.getElementById("settings-progress-text") as HTMLElement;

// Settings elements (preferred language)
const preferredLangSelect = document.getElementById("preferred-lang") as HTMLSelectElement;

// ── Populate Selects ──

function populateSelect(
  select: HTMLSelectElement,
  languages: { code: string; name: string }[],
  defaultCode: string
): void {
  for (const lang of languages) {
    const option = document.createElement("option");
    option.value = lang.code;
    option.textContent = lang.name;
    select.appendChild(option);
  }
  select.value = defaultCode;
}

populateSelect(sourceLangSelect, SOURCE_LANGUAGES, "auto");
populateSelect(targetLangSelect, TARGET_LANGUAGES, "en");

// ── Preferred Language ──

(async () => {
  populateSelect(preferredLangSelect, TARGET_LANGUAGES, "en");
  const result = await chrome.storage.local.get("preferredLanguage");
  preferredLangSelect.value = result.preferredLanguage || "en";
})();

preferredLangSelect.addEventListener("change", () => {
  chrome.storage.local.set({ preferredLanguage: preferredLangSelect.value });
});

// ── Status & Progress ──

let currentModelStatus = "idle";

function setStatus(status: string): void {
  statusIndicator.className = `status ${status}`;
  statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

function showProgress(percent: number, text: string): void {
  progressContainer.hidden = false;
  progressFill.style.width = `${Math.round(percent)}%`;
  progressText.textContent = text;
}

function hideProgress(): void {
  progressContainer.hidden = true;
}

function showError(message: string): void {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function hideError(): void {
  errorBanner.hidden = true;
}

// ── Settings Model Status ──

function syncModelStatusToSettings(): void {
  if (currentModelStatus === "ready") {
    modelStatusDot.style.background = "var(--success)";
    modelStatusLabel.textContent = "Ready";
    downloadModelBtn.disabled = true;
    downloadModelBtn.textContent = "Model Ready";
  } else if (currentModelStatus === "downloading") {
    modelStatusDot.style.background = "var(--warning)";
    modelStatusLabel.textContent = "Downloading";
    downloadModelBtn.disabled = true;
    downloadModelBtn.textContent = "Downloading...";
  } else if (currentModelStatus === "loading") {
    modelStatusDot.style.background = "var(--warning)";
    modelStatusLabel.textContent = "Loading";
    downloadModelBtn.disabled = true;
    downloadModelBtn.textContent = "Loading...";
  } else if (currentModelStatus === "error") {
    modelStatusDot.style.background = "var(--error)";
    modelStatusLabel.textContent = "Error";
    downloadModelBtn.disabled = false;
    downloadModelBtn.textContent = "Retry Download";
  } else {
    modelStatusDot.style.background = "var(--text-faint)";
    modelStatusLabel.textContent = "Not loaded";
    downloadModelBtn.disabled = false;
    downloadModelBtn.textContent = "Download Model";
  }
}

// ── Message Listener ──

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.action === MessageAction.MODEL_STATUS) {
    currentModelStatus = message.status;
    setStatus(message.status);
    syncModelStatusToSettings();
    if (message.status === "ready" || message.status === "idle") {
      hideProgress();
      settingsProgressContainer.hidden = true;
    } else if (message.status === "loading") {
      // Post-download initialization phase — show indeterminate progress
      showProgress(100, "Loading model...");
      settingsProgressContainer.hidden = false;
      settingsProgressFill.style.width = "100%";
      settingsProgressText.textContent = "Loading model...";
    }
  }

  if (message.action === MessageAction.TRANSLATE_PROGRESS) {
    currentModelStatus = "downloading";
    setStatus("downloading");
    const percent = message.progress ?? 0;
    const fileInfo = message.file ? ` (${message.file.split("/").pop()})` : "";
    const text = `Downloading... ${Math.round(percent)}%${fileInfo}`;

    // Update main view progress
    showProgress(percent, text);

    // Update settings view progress
    settingsProgressContainer.hidden = false;
    settingsProgressFill.style.width = `${Math.round(percent)}%`;
    settingsProgressText.textContent = text;
    syncModelStatusToSettings();
  }
});

// ── Language Detection ──

let detectTimer: ReturnType<typeof setTimeout> | null = null;

async function runDetection(): Promise<void> {
  if (sourceLangSelect.value !== "auto") {
    detectedLangEl.hidden = true;
    return;
  }
  const text = sourceText.value.trim();
  if (!text || text.length < 3) {
    detectedLangEl.hidden = true;
    detectedLangEl.dataset.code = "";
    return;
  }
  try {
    const result = await detectLanguage(text);
    if (result?.extCode) {
      const name = getLanguageName(result.extCode);
      detectedLangEl.textContent = `Detected: ${name}`;
      detectedLangEl.hidden = false;
      detectedLangEl.dataset.code = result.extCode;
    } else if (result?.alpha2) {
      detectedLangEl.textContent = `Detected: ${result.alpha2} (unsupported)`;
      detectedLangEl.hidden = false;
      detectedLangEl.dataset.code = "";
    } else {
      detectedLangEl.hidden = true;
      detectedLangEl.dataset.code = "";
    }
  } catch {
    // Detection is best-effort
  }
}

sourceText.addEventListener("input", () => {
  if (detectTimer) clearTimeout(detectTimer);
  detectTimer = setTimeout(runDetection, 300);
});

sourceLangSelect.addEventListener("change", () => {
  runDetection();
});

// ── Translate ──

translateBtn.addEventListener("click", async () => {
  const text = sourceText.value.trim();
  if (!text) return;

  hideError();

  let resolvedSourceLang = sourceLangSelect.value;
  if (resolvedSourceLang === "auto") {
    const cachedCode = detectedLangEl.dataset.code;
    if (cachedCode) {
      resolvedSourceLang = cachedCode;
    } else {
      try {
        const result = await detectLanguage(text);
        if (result?.extCode) {
          resolvedSourceLang = result.extCode;
        } else {
          showError("Could not detect source language. Please select one manually.");
          return;
        }
      } catch {
        showError("Could not detect source language. Please select one manually.");
        return;
      }
    }
  }

  translateBtn.disabled = true;
  targetText.value = "Translating...";

  const response = await chrome.runtime.sendMessage({
    action: MessageAction.TRANSLATE,
    text,
    sourceLang: resolvedSourceLang,
    targetLang: targetLangSelect.value,
  });

  translateBtn.disabled = false;

  if (response?.action === MessageAction.TRANSLATE_RESULT) {
    targetText.value = response.translatedText;
  } else if (response?.action === MessageAction.TRANSLATE_ERROR) {
    targetText.value = "";
    showError(response.error || "An unknown error occurred");
  }
});

// ── Swap ──

swapBtn.addEventListener("click", () => {
  const srcVal = sourceLangSelect.value;
  const tgtVal = targetLangSelect.value;

  if (srcVal === "auto") return;

  sourceLangSelect.value = tgtVal;
  targetLangSelect.value = srcVal;

  const srcText = sourceText.value;
  sourceText.value = targetText.value;
  targetText.value = srcText;
});

// ── Settings View Toggle ──

settingsBtn.addEventListener("click", () => {
  popupRoot.classList.add("show-settings");
  syncModelStatusToSettings();
});

backBtn.addEventListener("click", () => {
  popupRoot.classList.remove("show-settings");
});

// ── Theme Toggle ──

themeToggle.addEventListener("click", toggleTheme);

// ── Manual Model Download ──

downloadModelBtn.addEventListener("click", async () => {
  downloadModelBtn.disabled = true;
  await chrome.runtime.sendMessage({ action: MessageAction.LOAD_MODEL });
});

// ── Click to Copy Translation ──

const copiedBadge = document.getElementById("copied-badge") as HTMLElement;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

function showCopyFeedback(success: boolean): void {
  const stateClass = success ? "copied" : "copy-error";
  targetText.classList.add(stateClass);
  copiedBadge.textContent = success ? "Copied" : "Copy failed";
  copiedBadge.classList.toggle("error", !success);
  copiedBadge.hidden = false;
  // Force reflow so the transition runs from the hidden state
  void copiedBadge.offsetWidth;
  copiedBadge.classList.add("visible");

  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    targetText.classList.remove("copied", "copy-error");
    copiedBadge.classList.remove("visible");
    setTimeout(() => {
      if (!copiedBadge.classList.contains("visible")) copiedBadge.hidden = true;
    }, 200);
  }, 1000);
}

function legacyCopy(value: string): boolean {
  const previousActive = document.activeElement as HTMLElement | null;
  const previousStart = targetText.selectionStart;
  const previousEnd = targetText.selectionEnd;
  try {
    targetText.focus();
    targetText.select();
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    targetText.setSelectionRange(previousStart ?? value.length, previousEnd ?? value.length);
    if (previousActive && previousActive !== targetText) previousActive.focus();
  }
}

targetText.addEventListener("click", async () => {
  const value = targetText.value;
  if (!value || value === "Translating...") return;

  let success = false;
  try {
    await navigator.clipboard.writeText(value);
    success = true;
  } catch {
    success = legacyCopy(value);
  }
  showCopyFeedback(success);
});

// ── Report an Issue ──

const reportIssueLink = document.getElementById("report-issue-link") as HTMLAnchorElement;
reportIssueLink.href = buildReportIssueUrl();

// ── Load Selected Text ──

chrome.storage.session.get("selectedText", (result) => {
  if (result.selectedText) {
    sourceText.value = result.selectedText as string;
    chrome.storage.session.remove("selectedText");
  }
});
