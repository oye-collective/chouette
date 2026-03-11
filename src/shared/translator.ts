import {
  env,
  pipeline,
  TextGenerationPipeline,
} from "@huggingface/transformers";

// Point ONNX WASM runtime at the locally bundled files instead of the jsdelivr CDN,
// which is blocked by the extension's Content Security Policy.
env.backends.onnx.wasm!.wasmPaths = {
  mjs: chrome.runtime.getURL("/ort-wasm-simd-threaded.jsep.mjs"),
  wasm: chrome.runtime.getURL("/ort-wasm-simd-threaded.jsep.wasm"),
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
  onProgress?: ProgressCallback
): Promise<TextGenerationPipeline> {
  if (instance) return instance;
  if (loading) throw new Error("Model is already loading");

  loading = true;
  try {
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
