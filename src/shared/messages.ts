export enum MessageAction {
  TRANSLATE = "TRANSLATE",
  TRANSLATE_RESULT = "TRANSLATE_RESULT",
  TRANSLATE_BATCH = "TRANSLATE_BATCH",
  TRANSLATE_BATCH_RESULT = "TRANSLATE_BATCH_RESULT",
  TRANSLATE_ERROR = "TRANSLATE_ERROR",
  TRANSLATE_PROGRESS = "TRANSLATE_PROGRESS",
  MODEL_STATUS = "MODEL_STATUS",
  LOAD_MODEL = "LOAD_MODEL",
  SELECTED_TEXT = "SELECTED_TEXT",
  DETECT_LANGUAGE = "DETECT_LANGUAGE",
  DETECT_LANGUAGE_RESULT = "DETECT_LANGUAGE_RESULT",
  REQUEST_PROXY_PORT = "REQUEST_PROXY_PORT",
  PROXY_PORT = "PROXY_PORT",
  TRANSLATE_PAGE = "TRANSLATE_PAGE",
  RELAY_FRAME_TRANSLATION = "RELAY_FRAME_TRANSLATION",
  TRANSLATE_FRAME = "TRANSLATE_FRAME",
}

export type ModelStatus = "idle" | "downloading" | "loading" | "ready" | "error";

export interface TranslateRequest {
  action: MessageAction.TRANSLATE;
  text: string;
  sourceLang: string;
  targetLang: string;
}

export interface TranslateResult {
  action: MessageAction.TRANSLATE_RESULT;
  translatedText: string;
}

// A group of translation units travelling together. `priority` is the
// viewport distance of the group's ancestor (0 = visible; larger = further
// away) so the offscreen scheduler can order work across frames and tabs.
// `clientId` identifies the sending frame instance and `epoch` its current
// translation run; a job whose epoch is superseded by a newer one from the
// same client is dropped from the queue instead of wasting model time.
export interface TranslateBatchRequest {
  action: MessageAction.TRANSLATE_BATCH;
  texts: string[];
  sourceLang: string;
  targetLang: string;
  priority: number;
  clientId: string;
  epoch: number;
}

// `translations[i]` corresponds to `texts[i]`; null means "keep the original"
// (refusal, empty output, or a per-item failure). `error` is set when at
// least one item hard-failed — successfully translated siblings are still
// returned so their work is not lost.
export interface TranslateBatchResult {
  action: MessageAction.TRANSLATE_BATCH_RESULT;
  translations: (string | null)[];
  error?: string;
}

export interface TranslateError {
  action: MessageAction.TRANSLATE_ERROR;
  error: string;
}

export interface TranslateProgress {
  action: MessageAction.TRANSLATE_PROGRESS;
  progress: number;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface ModelStatusMessage {
  action: MessageAction.MODEL_STATUS;
  status: ModelStatus;
}

export interface LoadModelMessage {
  action: MessageAction.LOAD_MODEL;
}

export interface SelectedTextMessage {
  action: MessageAction.SELECTED_TEXT;
  text: string;
}

export interface DetectLanguageRequest {
  action: MessageAction.DETECT_LANGUAGE;
  text: string;
}

export interface DetectLanguageResult {
  action: MessageAction.DETECT_LANGUAGE_RESULT;
  langCode: string | null;
  langName: string | null;
  alpha2: string | null;
}

export interface RequestProxyPortMessage {
  action: MessageAction.REQUEST_PROXY_PORT;
}

export interface ProxyPortMessage {
  action: MessageAction.PROXY_PORT;
  port: number | null;
}

export interface TranslatePageMessage {
  action: MessageAction.TRANSLATE_PAGE;
}

// Content script (top frame) → background: ask for a TRANSLATE_FRAME fan-out
// to every frame of the sender's tab.
export interface RelayFrameTranslationMessage {
  action: MessageAction.RELAY_FRAME_TRANSLATION;
  sourceLang: string;
  targetLang: string;
}

// Background → all frames of a tab: start translating with these languages.
export interface TranslateFrameMessage {
  action: MessageAction.TRANSLATE_FRAME;
  sourceLang: string;
  targetLang: string;
}

export type ExtensionMessage =
  | TranslateRequest
  | TranslateResult
  | TranslateBatchRequest
  | TranslateBatchResult
  | TranslateError
  | TranslateProgress
  | ModelStatusMessage
  | LoadModelMessage
  | SelectedTextMessage
  | DetectLanguageRequest
  | DetectLanguageResult
  | RequestProxyPortMessage
  | ProxyPortMessage
  | TranslatePageMessage
  | RelayFrameTranslationMessage
  | TranslateFrameMessage;
