import { MessageAction, ExtensionMessage, ModelStatus } from "../shared/messages";

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
      message.action === MessageAction.LOAD_MODEL
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
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translate-selection",
    title: "chouette",
    contexts: ["selection"],
  });
});
