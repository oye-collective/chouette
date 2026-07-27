const ALPHA2_TO_EXT_CODE: Record<string, string> = {
  bg: "bg_BG",
  bn: "bn_BD",
  ca: "ca_ES",
  cs: "cs_CZ",
  da: "da_DK",
  de: "de_DE",
  el: "el_GR",
  es: "es_ES",
  et: "et_EE",
  fa: "fa_IR",
  fi: "fi_FI",
  fr: "fr_FR",
  gl: "gl_ES",
  gu: "gu_IN",
  he: "he_IL",
  hi: "hi_IN",
  hr: "hr_HR",
  hu: "hu_HU",
  id: "id_ID",
  it: "it_IT",
  ja: "ja_JP",
  kn: "kn_IN",
  ko: "ko_KR",
  lt: "lt_LT",
  lv: "lv_LV",
  mk: "mk_MK",
  ml: "ml_IN",
  mr: "mr_IN",
  ms: "ms_MY",
  mt: "mt_MT",
  nl: "nl_NL",
  no: "no_NO",
  pl: "pl_PL",
  pt: "pt_BR",
  ro: "ro_RO",
  ru: "ru_RU",
  sk: "sk_SK",
  sl: "sl_SI",
  sq: "sq_AL",
  sr: "sr_RS",
  sv: "sv_SE",
  ta: "ta_IN",
  te: "te_IN",
  th: "th_TH",
  tr: "tr_TR",
  uk: "uk_UA",
  ur: "ur_PK",
  vi: "vi_VN",
  zh: "zh_CN",
};

// These codes match directly between fasttext alpha2 and extension codes.
const DIRECT_CODES = new Set(["ar", "en", "sw"]);

export function alpha2ToExtCode(alpha2: string): string | null {
  if (DIRECT_CODES.has(alpha2)) return alpha2;
  return ALPHA2_TO_EXT_CODE[alpha2] ?? null;
}

// ── Model language codes ──

// Our codes (zh_CN, pt_BR, …) are the extension's own vocabulary; the model has
// a different one. TranslateGemma's chat template looks each code up in its own
// `languages` table and concatenates the result straight into the prompt, so a
// miss produces `undefined` and the template throws
//   "Cannot perform operation + on undefined values"
// instead of degrading. Every code we send must therefore be a key it defines.
//
// Bare subtags are the safe choice: all 54 languages we ship resolve as bare
// subtags, while seven of our region-qualified codes (zh_CN, bn_BD, gl_ES,
// mk_MK, ms_MY, mt_MT, sq_AL) are absent from the table entirely. So default to
// the bare subtag and keep only the variants the model distinguishes in
// writing — for the rest, the region suffix buys nothing anyway, since the
// table maps e.g. every "fr-*" to the same "French".
const MODEL_WRITTEN_VARIANTS: Record<string, string> = {
  zh_CN: "zh-Hans", // the table has no zh-CN; zh-Hans is the Simplified code
  zh_TW: "zh-Hant",
  pt_BR: "pt-BR",
  pt_PT: "pt-PT",
};

export function toModelLangCode(extCode: string): string {
  return MODEL_WRITTEN_VARIANTS[extCode] ?? extCode.split("_")[0];
}
