import { MessageAction, ExtensionMessage, ModelStatus } from "../shared/messages";
import { getTranslator, translate, isModelLoaded } from "../shared/translator";

function broadcastStatus(status: ModelStatus): void {
  chrome.runtime.sendMessage({
    action: MessageAction.MODEL_STATUS,
    status,
  }).catch(() => {});
}

function broadcastProgress(data: {
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
}): void {
  chrome.runtime.sendMessage({
    action: MessageAction.TRANSLATE_PROGRESS,
    progress: data.progress ?? 0,
    file: data.file,
    loaded: data.loaded,
    total: data.total,
  }).catch(() => {});
}

async function loadModel(): Promise<void> {
  if (isModelLoaded()) {
    broadcastStatus("ready");
    return;
  }
  broadcastStatus("loading");
  try {
    await getTranslator((event) => {
      if (event.status === "progress") {
        broadcastProgress(event);
      }
    });
    broadcastStatus("ready");
  } catch (err) {
    broadcastStatus("error");
    throw err;
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.action === MessageAction.LOAD_MODEL) {
      loadModel()
        .then(() => sendResponse({ action: MessageAction.MODEL_STATUS, status: "ready" }))
        .catch((err) =>
          sendResponse({ action: MessageAction.TRANSLATE_ERROR, error: err.message })
        );
      return true;
    }

    if (message.action === MessageAction.TRANSLATE) {
      (async () => {
        try {
          await loadModel();
          const result = await translate(
            message.text,
            message.sourceLang,
            message.targetLang
          );
          sendResponse({
            action: MessageAction.TRANSLATE_RESULT,
            translatedText: result,
          });
        } catch (err: any) {
          sendResponse({
            action: MessageAction.TRANSLATE_ERROR,
            error: err.message,
          });
        }
      })();
      return true;
    }

    return false;
  }
);
