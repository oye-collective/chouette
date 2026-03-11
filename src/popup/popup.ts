import { MessageAction, ExtensionMessage } from "../shared/messages";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "../shared/languages";
import "./popup.css";

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

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.action === MessageAction.MODEL_STATUS) {
    setStatus(message.status);
    if (message.status === "ready") {
      hideProgress();
    }
  }

  if (message.action === MessageAction.TRANSLATE_PROGRESS) {
    setStatus("loading");
    const percent = message.progress ?? 0;
    const fileInfo = message.file ? ` (${message.file.split("/").pop()})` : "";
    showProgress(percent, `Downloading model... ${Math.round(percent)}%${fileInfo}`);
  }
});

translateBtn.addEventListener("click", async () => {
  const text = sourceText.value.trim();
  if (!text) return;

  hideError();
  translateBtn.disabled = true;
  targetText.value = "Translating...";

  const response = await chrome.runtime.sendMessage({
    action: MessageAction.TRANSLATE,
    text,
    sourceLang: sourceLangSelect.value,
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

chrome.storage.session.get("selectedText", (result) => {
  if (result.selectedText) {
    sourceText.value = result.selectedText as string;
    chrome.storage.session.remove("selectedText");
  }
});
