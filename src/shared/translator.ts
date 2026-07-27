import {
  env,
  pipeline,
  TextGenerationPipeline,
} from "@huggingface/transformers";
import { toModelLangCode } from "./language-mapping";

// Offscreen documents are not crossOriginIsolated, so SharedArrayBuffer
// is unavailable. Limit to a single WASM thread to avoid errors.
env.backends.onnx.wasm!.numThreads = 1;

// The Cache API does not support chrome-extension:// URLs, so skip the
// transformers.js WASM pre-load/cache step. The ONNX runtime will load
// the files directly from the paths we set below.
(env as any).useWasmCache = false;

// Override ONNX WASM paths to use locally bundled files instead of the
// jsdelivr CDN, which is blocked by the extension's Content Security Policy.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: chrome.runtime.getURL("ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: chrome.runtime.getURL("ort-wasm-simd-threaded.asyncify.wasm"),
};

export type ProgressCallback = (progress: {
  status: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
}) => void;

let instance: TextGenerationPipeline | null = null;
let loading = false;

export async function getTranslator(
  onProgress?: ProgressCallback,
  proxyPort?: number | null
): Promise<TextGenerationPipeline> {
  if (instance) return instance;
  if (loading) throw new Error("Model is already loading");

  loading = true;
  try {
    // If the native caching proxy is available, redirect HuggingFace
    // fetches through it so the model is downloaded once and shared
    // across all Chrome profiles.
    if (proxyPort) {
      try {
        const ping = await fetch(`http://127.0.0.1:${proxyPort}/ping`);
        if (ping.ok) {
          env.remoteHost = `http://127.0.0.1:${proxyPort}/`;
          (env as any).useBrowserCache = false;
        }
      } catch {
        // Proxy not reachable — fall through to default HuggingFace
      }
    }

    instance = (await (pipeline as any)(
      "text-generation",
      "onnx-community/translategemma-text-4b-it-ONNX",
      {
        device: "webgpu",
        dtype: "q4",
        progress_callback: onProgress,
      }
    )) as TextGenerationPipeline;
    return instance;
  } finally {
    loading = false;
  }
}

export interface BatchStats {
  elapsedMs: number;
  inChars: number;
  outChars: number;
}

// Thrown when the model's output does not split back into one part per input
// text — the caller decides how to retry (typically by bisecting the batch).
export class SplitMismatchError extends Error {
  constructor(expected: number, got: number) {
    super(`Joined translation split mismatch: expected ${expected} parts, got ${got}`);
    this.name = "SplitMismatchError";
  }
}

// Parse a numbered-list output back into its parts. Markers are only
// honoured when strictly sequential (1, then 2, then 3 …) so a digit-dot
// line inside a translation cannot shuffle later items; everything else
// accumulates onto the current item. Returns null when any part is missing.
function parseNumbered(result: string, n: number): string[] | null {
  const parts: (string | null)[] = new Array(n).fill(null);
  let current = -1;
  let buf: string[] = [];
  const flush = () => {
    if (current >= 0 && current < n) parts[current] = buf.join("\n").trim();
  };
  for (const line of result.split("\n")) {
    const m = line.match(/^\s*(\d{1,3})[.):]\s?/);
    if (m && parseInt(m[1], 10) - 1 === current + 1) {
      flush();
      current += 1;
      buf = [line.slice(m[0].length)];
    } else {
      buf.push(line);
    }
  }
  flush();
  return parts.every((p) => p !== null) ? (parts as string[]) : null;
}

// Translates several independent texts in ONE generation by joining them as
// a numbered list the model reproduces in its output — in-sequence
// batching. True multi-sequence batching (an array of chats per generate()
// call) is broken in transformers.js 4.0.0-next.3 on WebGPU: every
// left-padded row comes back as garbage. Until that is fixed upstream, the
// join is the batch, amortizing the fixed per-call cost across texts.
// Numbered lines rather than a bare delimiter: the model preserves list
// structure reliably, whereas a delimiter between short items gets eaten.
//
// A null entry means "keep the original" (refusal or empty output).
export async function translateJoined(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<{ translations: (string | null)[]; stats: BatchStats }> {
  const translator = await getTranslator();
  const joined =
    texts.length === 1 ? texts[0] : texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          source_lang_code: toModelLangCode(sourceLang),
          target_lang_code: toModelLangCode(targetLang),
          text: joined,
        },
      ],
    },
  ];

  // A runaway generation should not be able to stall the queue for minutes,
  // so scale the cap to the input instead of using a flat 1024: ~0.6 tokens
  // per input char is roughly double a realistic translation length, so real
  // outputs hit EOS long before the cap.
  const maxNewTokens = Math.min(
    1536,
    Math.max(96, Math.ceil(joined.length * 0.6) + 8 * texts.length)
  );

  const started = performance.now();
  const output = await (translator as any)(messages, {
    max_new_tokens: maxNewTokens,
  });
  const elapsedMs = performance.now() - started;

  const result: string = output[0].generated_text.pop().content ?? "";
  // A single text is sent unnumbered — the whole output is its translation.
  const parts = texts.length === 1 ? [result] : parseNumbered(result, texts.length);
  if (parts === null) {
    throw new SplitMismatchError(texts.length, -1);
  }

  const translations = parts.map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return null;
    // TranslateGemma occasionally refuses to translate and instead replies
    // with an English explanation (e.g. "There seems to be an error in the
    // provided text..."). Surfacing that as the translation overwrites the
    // page content with a refusal message. Treat refusals as null so the
    // caller keeps the original text.
    return looksLikeRefusal(trimmed, targetLang) ? null : trimmed;
  });

  const stats: BatchStats = {
    elapsedMs,
    inChars: texts.reduce((sum, t) => sum + t.length, 0),
    outChars: translations.reduce((sum, t) => sum + (t?.length ?? 0), 0),
  };
  return { translations, stats };
}

export async function translate(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const { translations } = await translateJoined([text], sourceLang, targetLang);
  return translations[0] ?? "";
}

const REFUSAL_PATTERNS: RegExp[] = [
  /^(there\s+seems|there\s+appears|it\s+seems|it\s+appears|it\s+looks\s+like|this\s+(appears|seems|looks))/i,
  /^(i\s+cannot|i\s+can'?t|i\s+am\s+unable|i'?m\s+sorry|sorry[,!.\s])/i,
  /^(if\s+you\s+(can|could)\s+provide|please\s+provide|could\s+you\s+provide)/i,
  /^(the\s+(text|input|provided\s+text|word|phrase)\s+(provided|you|appears|is|seems))/i,
  /^(i\s+(will|can|would)\s+translate|i'?ll\s+translate)/i,
  /^(unfortunately[,\s])/i,
  /^(note[:\s]|note\s+that)/i,
  /^(assuming\s+(the|that|you))/i,
  // "This is a Vietnamese phrase, meaning..." / "This is the Russian word for..."
  /^this\s+is\s+(a|an|the)\s+\w+\s+(phrase|word|text|sentence|name|term|expression|translation|language)/i,
  // "This text is in Greek. It translates to..." / "This phrase means..."
  /^this\s+(text|word|phrase|sentence|translation)\s+(is|means|translates)/i,
];

// Map ISO language codes (or code prefixes used by the popup, e.g. "ru_RU")
// to the Unicode script the translation output should mostly be in.
const LANG_TO_SCRIPT: Record<string, string> = {
  ar: "Arabic", fa: "Arabic", ur: "Arabic",
  bg: "Cyrillic", mk: "Cyrillic", ru: "Cyrillic", sr: "Cyrillic", uk: "Cyrillic",
  el: "Greek",
  he: "Hebrew",
  hi: "Devanagari", mr: "Devanagari",
  bn: "Bengali",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  zh: "Han",
  ja: "Japanese", // Hiragana | Katakana | Han
  ko: "Hangul",
};

function expectedScript(lang: string): string | null {
  const code = lang.split("_")[0].toLowerCase();
  return LANG_TO_SCRIPT[code] ?? null;
}

function countScriptChars(text: string, script: string): number {
  let pattern: RegExp;
  if (script === "Japanese") {
    pattern = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;
  } else {
    pattern = new RegExp(`\\p{Script=${script}}`, "gu");
  }
  return (text.match(pattern) || []).length;
}

function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) || []).length;
}

function looksLikeRefusal(output: string, targetLang: string): boolean {
  const trimmed = output.trim();
  if (!trimmed) return false;

  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Script mismatch: if the target language uses a non-Latin script but
  // the output is overwhelmingly in another script (typically Latin
  // letters for English refusals), treat it as a refusal. Use a strict
  // threshold so legitimate translations containing proper nouns,
  // borrowed terms, or numerals aren't dropped.
  const script = expectedScript(targetLang);
  if (script) {
    const total = countLetters(trimmed);
    if (total >= 8) {
      const matched = countScriptChars(trimmed, script);
      if (matched / total < 0.3) return true;
    }
  }

  return false;
}

export function isModelLoaded(): boolean {
  return instance !== null;
}
