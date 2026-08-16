import { describe, expect, it } from "vitest";

import {
  conversationSupportedLanguages,
  filterLanguages,
  getLanguageDefinition,
  getTextDirection,
  isConversationLanguageCode,
  isLanguageCode,
  isRtlLanguageCode,
  isSttLanguageCode,
  LANGUAGE_CODES,
  LANGUAGE_REGISTRY,
  parseLanguageCode,
  requireLanguageDefinition,
  resolveLanguageCodeFromBrowserTag,
  uiSupportedLanguages,
} from "./language-registry";

// The eighteen languages with a real (full or beta) UI translation --
// see translations.ts's own coverage note. Not the limit of the
// registry (see below) -- just the current UI-translated set.
const UI_TRANSLATED_CODES = ["en", "ro", "ar", "it", "fr", "de", "es", "pt", "nl", "pl", "tr", "el", "he", "ja", "ko", "zh-Hans", "zh-Hant", "hi"];

// Explicitly required by the task: real conversation/STT support must
// exist for these, based on Gemini's own documented language list (see
// the registry's own provider-capability-audit comment) -- not just the
// original seven.
const REQUIRED_CONVERSATION_CODES = [
  "ro", "en", "ar", "he", "it", "fr", "de", "es", "pt", "nl", "pl", "tr", "el", "hi", "ja", "ko", "zh-Hans", "zh-Hant",
];

describe("LANGUAGE_REGISTRY", () => {
  it("is a data array, not a hardcoded closed set -- registry length is what defines LANGUAGE_CODES, nothing pins it to a fixed count", () => {
    expect(LANGUAGE_CODES.length).toBe(LANGUAGE_REGISTRY.length);
  });

  it("is genuinely global -- covers far more than the original eighteen UI-translated languages", () => {
    expect(LANGUAGE_CODES.length).toBeGreaterThan(40);
  });

  it("every entry declares itself under its own code", () => {
    for (const entry of LANGUAGE_REGISTRY) {
      expect(getLanguageDefinition(entry.code)?.code).toBe(entry.code);
    }
  });

  it("every explicitly required language is conversation/STT supported, with a real TTS architecture mapping", () => {
    for (const code of REQUIRED_CONVERSATION_CODES) {
      const entry = requireLanguageDefinition(code);
      expect(entry.conversationSupported).toBe(true);
      expect(entry.sttSupported).toBe(true);
      expect(entry.ttsSupported).toBe(true);
      expect(entry.speechLocale.length).toBeGreaterThan(0);
    }
  });

  it("conversationSupported and sttSupported are tracked together for THIS provider, but as independent fields (not derived from each other)", () => {
    // Every conversation-supported entry also happens to be STT-supported
    // today (same Gemini provider backs both) -- but the two fields are
    // still separate booleans on the type, not one flag reused twice, so
    // a future provider mismatch (e.g. text-only support without audio)
    // would only require a data change, not a schema change.
    for (const entry of LANGUAGE_REGISTRY) {
      if (entry.conversationSupported) {
        expect(entry.sttSupported).toBe(true);
      }
    }
  });

  it("a language can be conversation-supported with no UI translation at all (independent dimensions)", () => {
    const russian = requireLanguageDefinition("ru");
    expect(russian.conversationSupported).toBe(true);
    expect(russian.uiSupportLevel).toBe("none");
  });

  it("does not overclaim support for languages not confirmed on the provider's documented list", () => {
    for (const code of ["fa", "pa", "ms", "fil"]) {
      const entry = requireLanguageDefinition(code);
      expect(entry.conversationSupported).toBe(false);
      expect(entry.sttSupported).toBe(false);
      // TTS architecture (a BCP-47 tag the Web Speech API can be asked to
      // attempt) is still honestly true -- that dimension doesn't depend
      // on Gemini at all.
      expect(entry.ttsSupported).toBe(true);
    }
  });

  it("Romanian and English are the only languages claiming full, non-beta UI support today", () => {
    const full = LANGUAGE_REGISTRY.filter((entry) => entry.uiSupportLevel === "full").map((entry) => entry.code);
    expect(full.sort()).toEqual(["en", "ro"]);
  });

  it("every UI-translated language beyond en/ro is marked beta, never full", () => {
    for (const code of UI_TRANSLATED_CODES) {
      if (code === "en" || code === "ro") continue;
      const entry = requireLanguageDefinition(code);
      expect(entry.uiSupportLevel).toBe("beta");
    }
  });
});

describe("isRtlLanguageCode / getTextDirection (generic RTL, not hardcoded to Arabic)", () => {
  it("recognizes multiple RTL languages actually present in the registry: Arabic, Hebrew, Urdu, Persian", () => {
    for (const code of ["ar", "he", "ur", "fa"]) {
      expect(isRtlLanguageCode(code)).toBe(true);
      expect(getTextDirection(code)).toBe("rtl");
      expect(requireLanguageDefinition(code).direction).toBe("rtl");
    }
  });

  it("every registry entry's own stored direction matches the generic RTL detector", () => {
    for (const entry of LANGUAGE_REGISTRY) {
      expect(entry.direction).toBe(getTextDirection(entry.code));
    }
  });

  it("is ltr for non-RTL languages, including newly added ones", () => {
    for (const code of ["en", "ro", "ja", "ko", "hi", "ru", "zh-Hans"]) {
      expect(isRtlLanguageCode(code)).toBe(false);
      expect(getTextDirection(code)).toBe("ltr");
    }
  });

  it("matches on the primary subtag even for a compound/regional code", () => {
    expect(isRtlLanguageCode("ar-EG")).toBe(true);
    expect(isRtlLanguageCode("he-IL")).toBe(true);
  });
});

describe("isLanguageCode / getLanguageDefinition / requireLanguageDefinition", () => {
  it("recognizes every registry code, including compound ones", () => {
    for (const code of LANGUAGE_CODES) {
      expect(isLanguageCode(code)).toBe(true);
      expect(getLanguageDefinition(code)?.code).toBe(code);
    }
  });

  it("rejects garbage/unregistered values", () => {
    expect(isLanguageCode("fr-CA")).toBe(false);
    expect(isLanguageCode("xx")).toBe(false);
    expect(isLanguageCode("")).toBe(false);
  });

  it("getLanguageDefinition returns undefined (never throws) for an unknown code", () => {
    expect(getLanguageDefinition("xx")).toBeUndefined();
  });

  it("requireLanguageDefinition throws for an unknown code", () => {
    expect(() => requireLanguageDefinition("xx")).toThrow();
  });
});

describe("isConversationLanguageCode / isSttLanguageCode (independent gates)", () => {
  it("both true for the required conversation-supported set", () => {
    for (const code of REQUIRED_CONVERSATION_CODES) {
      expect(isConversationLanguageCode(code)).toBe(true);
      expect(isSttLanguageCode(code)).toBe(true);
    }
  });

  it("both false for a registry-only, not-yet-confirmed language", () => {
    expect(isConversationLanguageCode("fa")).toBe(false);
    expect(isSttLanguageCode("fa")).toBe(false);
  });

  it("both false for a totally unknown code", () => {
    expect(isConversationLanguageCode("xx")).toBe(false);
    expect(isSttLanguageCode("xx")).toBe(false);
  });
});

describe("parseLanguageCode", () => {
  it("passes through any real registry code, including newly added ones -- never narrows a valid non-en/ro code back to en", () => {
    for (const code of ["ar", "fr", "de", "es", "it", "ja", "ko", "hi", "ru", "sw"]) {
      expect(parseLanguageCode(code)).toBe(code);
    }
  });

  it("falls back to the given default (or en) for null/undefined/unsupported values", () => {
    expect(parseLanguageCode(null)).toBe("en");
    expect(parseLanguageCode(undefined)).toBe("en");
    expect(parseLanguageCode("xx")).toBe("en");
    expect(parseLanguageCode("xx", "ro")).toBe("ro");
  });
});

describe("resolveLanguageCodeFromBrowserTag", () => {
  it("matches on the primary subtag, case-insensitively, regardless of region", () => {
    expect(resolveLanguageCodeFromBrowserTag("ro-RO")).toBe("ro");
    expect(resolveLanguageCodeFromBrowserTag("fr-CA")).toBe("fr");
    expect(resolveLanguageCodeFromBrowserTag("AR-eg")).toBe("ar");
    expect(resolveLanguageCodeFromBrowserTag("de")).toBe("de");
    expect(resolveLanguageCodeFromBrowserTag("ja-JP")).toBe("ja");
    expect(resolveLanguageCodeFromBrowserTag("sw-KE")).toBe("sw");
  });

  it("matches a compound registry code (script variant) case-insensitively", () => {
    expect(resolveLanguageCodeFromBrowserTag("zh-Hans-CN")).toBe("zh-Hans");
    expect(resolveLanguageCodeFromBrowserTag("zh-hans-cn")).toBe("zh-Hans");
    expect(resolveLanguageCodeFromBrowserTag("zh-Hant-TW")).toBe("zh-Hant");
  });

  it("falls back to en for a genuinely unrecognized or missing browser tag", () => {
    expect(resolveLanguageCodeFromBrowserTag("xx-YY")).toBe("en");
    expect(resolveLanguageCodeFromBrowserTag(null)).toBe("en");
    expect(resolveLanguageCodeFromBrowserTag(undefined)).toBe("en");
  });
});

describe("uiSupportedLanguages / conversationSupportedLanguages", () => {
  it("uiSupportedLanguages includes exactly the eighteen UI-translated languages, excludes 'none'", () => {
    const codes = uiSupportedLanguages().map((entry) => entry.code).sort();
    expect(codes).toEqual([...UI_TRANSLATED_CODES].sort());
  });

  it("conversationSupportedLanguages includes far more than just the UI-translated set", () => {
    const codes = conversationSupportedLanguages().map((entry) => entry.code);
    expect(codes.length).toBeGreaterThan(UI_TRANSLATED_CODES.length);
    // Russian has no UI translation at all, but IS a real conversation
    // language -- proof the two lists are genuinely independent.
    expect(codes).toContain("ru");
  });
});

describe("filterLanguages (the searchable selector's filter logic)", () => {
  it("returns everything for an empty query", () => {
    expect(filterLanguages(LANGUAGE_REGISTRY, "")).toHaveLength(LANGUAGE_REGISTRY.length);
    expect(filterLanguages(LANGUAGE_REGISTRY, "   ")).toHaveLength(LANGUAGE_REGISTRY.length);
  });

  it("matches by native name, case-insensitively", () => {
    const results = filterLanguages(LANGUAGE_REGISTRY, "français");
    expect(results.map((entry) => entry.code)).toContain("fr");
  });

  it("matches by English label", () => {
    const results = filterLanguages(LANGUAGE_REGISTRY, "japanese");
    expect(results.map((entry) => entry.code)).toContain("ja");
  });

  it("matches by code", () => {
    const results = filterLanguages(LANGUAGE_REGISTRY, "zh-hant");
    expect(results.map((entry) => entry.code)).toEqual(["zh-Hant"]);
  });

  it("finds a non-Latin native name by its own script", () => {
    const results = filterLanguages(LANGUAGE_REGISTRY, "한국어");
    expect(results.map((entry) => entry.code)).toEqual(["ko"]);
  });

  it("returns an empty array for a query matching nothing", () => {
    expect(filterLanguages(LANGUAGE_REGISTRY, "zzzzz-not-a-language")).toHaveLength(0);
  });
});
