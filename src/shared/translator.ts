import {
  env,
  pipeline,
  TextGenerationPipeline,
} from "@huggingface/transformers";

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

export async function translate(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const translator = await getTranslator();

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          source_lang_code: sourceLang,
          target_lang_code: targetLang,
          text,
        },
      ],
    },
  ];

  const output = await (translator as any)(messages, {
    max_new_tokens: 1024,
  });

  return output[0].generated_text.pop().content;
}

export function isModelLoaded(): boolean {
  return instance !== null;
}
