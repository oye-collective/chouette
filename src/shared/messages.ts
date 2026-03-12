export enum MessageAction {
  TRANSLATE = "TRANSLATE",
  TRANSLATE_RESULT = "TRANSLATE_RESULT",
  TRANSLATE_ERROR = "TRANSLATE_ERROR",
  TRANSLATE_PROGRESS = "TRANSLATE_PROGRESS",
  MODEL_STATUS = "MODEL_STATUS",
  LOAD_MODEL = "LOAD_MODEL",
  SELECTED_TEXT = "SELECTED_TEXT",
  DETECT_LANGUAGE = "DETECT_LANGUAGE",
  DETECT_LANGUAGE_RESULT = "DETECT_LANGUAGE_RESULT",
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

export type ExtensionMessage =
  | TranslateRequest
  | TranslateResult
  | TranslateError
  | TranslateProgress
  | ModelStatusMessage
  | LoadModelMessage
  | SelectedTextMessage
  | DetectLanguageRequest
  | DetectLanguageResult;
