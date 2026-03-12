import { getLIDModel } from "fasttext.wasm.js/common";
import type { LanguageIdentificationModel } from "fasttext.wasm.js/common";
import { alpha2ToExtCode } from "../shared/language-mapping";

let lidModel: LanguageIdentificationModel | null = null;
let loading = false;

async function ensureModel(): Promise<LanguageIdentificationModel> {
  if (lidModel) return lidModel;
  if (loading) throw new Error("Model already loading");
  loading = true;
  try {
    lidModel = await getLIDModel({
      wasmPath: chrome.runtime.getURL("fastText/fastText.common.wasm"),
      modelPath: chrome.runtime.getURL("fastText/models/lid.176.ftz"),
    });
    await lidModel.load();
    return lidModel;
  } finally {
    loading = false;
  }
}

export interface DetectionResult {
  alpha2: string | null;
  extCode: string | null;
}

export async function detectLanguage(
  text: string
): Promise<DetectionResult | null> {
  if (!text.trim() || text.trim().length < 3) return null;
  const model = await ensureModel();
  const result = await model.identify(text);
  const extCode = result.alpha2 ? alpha2ToExtCode(result.alpha2) : null;
  return { alpha2: result.alpha2, extCode };
}
