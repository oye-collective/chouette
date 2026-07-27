import { MessageAction, ExtensionMessage, ModelStatus } from "../shared/messages";
import { getTranslator, isModelLoaded } from "../shared/translator";
import { detectLanguage } from "../shared/language-detector";
import { getLanguageName } from "../shared/languages";
import { initScheduler, enqueueJob } from "./scheduler";

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

async function getProxyPort(): Promise<number | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      action: MessageAction.REQUEST_PROXY_PORT,
    });
    if (response?.action === MessageAction.PROXY_PORT) {
      return response.port;
    }
  } catch {
    // Native host not available
  }
  return null;
}

async function loadModel(): Promise<void> {
  if (isModelLoaded()) {
    broadcastStatus("ready");
    return;
  }
  const proxyPort = await getProxyPort();
  let hasDownloadProgress = false;
  let transitionedToLoading = false;
  try {
    await getTranslator((event) => {
      if (event.status === "progress") {
        if (!hasDownloadProgress) {
          hasDownloadProgress = true;
          broadcastStatus("downloading");
        }
        broadcastProgress(event);
      } else if (event.status === "ready" && !transitionedToLoading) {
        transitionedToLoading = true;
        broadcastStatus("loading");
      }
    }, proxyPort);
    if (!hasDownloadProgress && !transitionedToLoading) {
      // No progress or ready events fired — ensure loading is broadcast
      broadcastStatus("loading");
    }
    broadcastStatus("ready");
  } catch (err) {
    broadcastStatus("error");
    throw err;
  }
}

initScheduler(loadModel);

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    // Work requests are only accepted via the background relay. The
    // original broadcast from the sender also lands here whenever this
    // document is already alive; acting on both copies would run every
    // translation twice.
    if (
      (message.action === MessageAction.LOAD_MODEL ||
        message.action === MessageAction.TRANSLATE ||
        message.action === MessageAction.TRANSLATE_BATCH ||
        message.action === MessageAction.DETECT_LANGUAGE) &&
      !(message as any).relayed
    ) {
      return false;
    }

    if (message.action === MessageAction.LOAD_MODEL) {
      loadModel()
        .then(() => sendResponse({ action: MessageAction.MODEL_STATUS, status: "ready" }))
        .catch((err) =>
          sendResponse({ action: MessageAction.TRANSLATE_ERROR, error: err.message })
        );
      return true;
    }

    // Single-text requests (popup selection translation) go through the same
    // scheduler as page batches, at top priority so they jump ahead of any
    // background page drain.
    if (message.action === MessageAction.TRANSLATE) {
      enqueueJob(
        "single",
        0,
        message.sourceLang,
        message.targetLang,
        -1,
        [message.text],
        (translations, error) => {
          if (error && translations[0] === null) {
            sendResponse({ action: MessageAction.TRANSLATE_ERROR, error });
          } else {
            sendResponse({
              action: MessageAction.TRANSLATE_RESULT,
              translatedText: translations[0] ?? "",
            });
          }
        }
      );
      return true;
    }

    if (message.action === MessageAction.TRANSLATE_BATCH) {
      enqueueJob(
        message.clientId,
        message.epoch,
        message.sourceLang,
        message.targetLang,
        message.priority,
        message.texts,
        (translations, error) => {
          sendResponse({
            action: MessageAction.TRANSLATE_BATCH_RESULT,
            translations,
            ...(error ? { error } : {}),
          });
        }
      );
      return true;
    }

    if (message.action === MessageAction.DETECT_LANGUAGE) {
      (async () => {
        try {
          const result = await detectLanguage(message.text);
          const langCode = result?.extCode ?? null;
          const langName = langCode ? (getLanguageName(langCode) ?? null) : null;
          sendResponse({
            action: MessageAction.DETECT_LANGUAGE_RESULT,
            langCode,
            langName,
            alpha2: result?.alpha2 ?? null,
          });
        } catch (err: any) {
          sendResponse({
            action: MessageAction.DETECT_LANGUAGE_RESULT,
            langCode: null,
            langName: null,
            alpha2: null,
          });
        }
      })();
      return true;
    }

    return false;
  }
);
