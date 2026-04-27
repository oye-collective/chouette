import { MessageAction, ExtensionMessage } from "../shared/messages";
import { buildReportIssueUrl } from "../shared/issue-reporter";

const NATIVE_HOST_NAME = "com.oyecollective.chouette";
let proxyPort: number | null = null;
let nativeHostAvailable: boolean | null = null;
let nativePort: chrome.runtime.Port | null = null;

function ensureNativeProxy(): Promise<number | null> {
  if (proxyPort !== null) return Promise.resolve(proxyPort);
  if (nativeHostAvailable === false) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      nativePort = port;

      const timeout = setTimeout(() => {
        if (proxyPort === null) {
          nativeHostAvailable = false;
          resolve(null);
        }
      }, 5000);

      port.onMessage.addListener((msg: any) => {
        if (msg.action === "proxy_started" && typeof msg.port === "number") {
          proxyPort = msg.port;
          nativeHostAvailable = true;
          clearTimeout(timeout);
          resolve(msg.port);
        } else if (msg.action === "error") {
          nativeHostAvailable = false;
          clearTimeout(timeout);
          resolve(null);
        }
      });

      port.onDisconnect.addListener(() => {
        nativePort = null;
        proxyPort = null;
        if (nativeHostAvailable === null) {
          nativeHostAvailable = false;
          clearTimeout(timeout);
          resolve(null);
        }
      });

      port.postMessage({ action: "start_proxy" });
    } catch {
      nativeHostAvailable = false;
      resolve(null);
    }
  });
}

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run WebGPU inference for translation model",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (
      message.action === MessageAction.TRANSLATE ||
      message.action === MessageAction.LOAD_MODEL ||
      message.action === MessageAction.DETECT_LANGUAGE
    ) {
      ensureOffscreenDocument()
        .then(() => chrome.runtime.sendMessage(message))
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            action: MessageAction.TRANSLATE_ERROR,
            error: err?.message || String(err),
          })
        );
      return true;
    }

    if (message.action === MessageAction.REQUEST_PROXY_PORT) {
      ensureNativeProxy()
        .then((port) => sendResponse({ action: MessageAction.PROXY_PORT, port }))
        .catch(() => sendResponse({ action: MessageAction.PROXY_PORT, port: null }));
      return true;
    }

    if (message.action === MessageAction.SELECTED_TEXT) {
      chrome.storage.session.set({ selectedText: message.text });
      return false;
    }

    return false;
  }
);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "translate-selection" && info.selectionText) {
    await chrome.storage.session.set({ selectedText: info.selectionText });
    if (tab?.id) {
      chrome.action.openPopup();
    }
  } else if (info.menuItemId === "translate-page" && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: MessageAction.TRANSLATE_PAGE });
  } else if (info.menuItemId === "report-issue") {
    chrome.tabs.create({ url: buildReportIssueUrl() });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "chouette-translate",
      title: "Chouette - Translate",
      contexts: ["page", "selection"],
    });
    chrome.contextMenus.create({
      id: "translate-selection",
      parentId: "chouette-translate",
      title: "Translate selection",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "translate-page",
      parentId: "chouette-translate",
      title: "Translate page",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "report-issue",
      parentId: "chouette-translate",
      title: "Report an issue",
      contexts: ["page", "selection"],
    });
  });
});
