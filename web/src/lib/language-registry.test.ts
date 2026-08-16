import { describe, expect, it } from "vitest";

import {
  conversationSupportedLanguages,
  getLanguageDefinition,
  getTextDirection,
  isLanguageCode,
  isRtlLanguageCode,
  LANGUAGE_CODES,
  LANGUAGE_REGISTRY,
  parseLanguageCode,
  requireLanguageDefinition,
  resolveLanguageCodeFromBrowserTag,
  uiSupportedLanguages,
} from "./language-registry";

describe("LANGUAGE_REGISTRY", () => {
  it("is a data array, not a hardcoded closed set -- registry length is what defines LANGUAGE_CODES, nothing pins it to a fixed count", () => {
    expect(LANGUAGE_CODES.length).toBe(LANGUAGE_REGISTRY.length);
    expect(LANGUAGE_CODES.length).toBeGreaterThan(10);
  });

  it("includes the seven initially active languages", () => {
    for (const code of ["en", "ro", "ar", "it", "fr", "de", "es"]) {
      expect(LANGUAGE_CODES).toContain(code);
    }
  });

  it("includes a broad set of prepared-but-not-yet-activated world languages, demonstrating the registry is not limited to the initial seven", () => {
    for (const code of ["pt", "nl", "pl", "tr", "el", "he", "ja", "ko", "zh-Hans", "zh-Hant", "hi"]) {
      expect(LANGUAGE_CODES).toContain(code);
    }
  });

  it("every entry declares itself under its own code", () => {
    for (const entry of LANGUAGE_REGISTRY) {
      expect(getLanguageDefinition(entry.code)?.code).toBe(entry.code);
    }
  });

  it("the seven active languages are conversation/STT/TTS supported; prepared languages are honestly not", () => {
    for (const code of ["en", "ro", "ar", "it", "fr", "de", "es"]) {
      const entry = requireLanguageDefinition(code);
      expect(entry.conversationSupported).toBe(true);
      expect(entry.sttSupported).toBe(true);
      expect(entry.ttsSupported).toBe(true);
    }
    for (const code of ["pt", "nl", "pl", "tr", "el", "he", "ja", "ko", "zh-Hans", "zh-Hant", "hi"]) {
      const entry = requireLanguageDefinition(code);
      expect(entry.conversationSupported).toBe(false);
      expect(entry.sttSupported).toBe(false);
      expect(entry.ttsSupported).toBe(false);
      expect(entry.uiSupportLevel).toBe("none");
    }
  });

  it("Romanian and English are the only languages claiming full, non-beta UI support today", () => {
    const full = LANGUAGE_REGISTRY.filter((entry) => entry.uiSupportLevel === "full").map((entry) => entry.code);
    expect(full.sort()).toEqual(["en", "ro"]);
  });

  it("Arabic/Italian/French/German/Spanish are marked beta -- real conversation support, partial UI", () => {
    for (const code of ["ar", "it", "fr", "de", "es"]) {
      const entry = requireLanguageDefinition(code);
      expect(entry.uiSupportLevel).toBe("beta");
      expect(entry.conversationSupported).toBe(true);
    }
  });
});

describe("isRtlLanguageCode / getTextDirection (generic RTL, not hardcoded to Arabic)", () => {
  it("recognizes multiple RTL languages, including ones not yet activated for anything else (e.g. Hebrew)", () => {
    expect(isRtlLanguageCode("ar")).toBe(true);
    expect(isRtlLanguageCode("he")).toBe(true);
    expect(getTextDirection("ar")).toBe("rtl");
    expect(getTextDirection("he")).toBe("rtl");
  });

  it("every registry entry's own stored direction matches the generic RTL detector", () => {
    for (const entry of LANGUAGE_REGISTRY) {
      expect(entry.direction).toBe(getTextDirection(entry.code));
    }
  });

  it("is ltr for non-RTL languages", () => {
    expect(isRtlLanguageCode("en")).toBe(false);
    expect(isRtlLanguageCode("ro")).toBe(false);
    expect(getTextDirection("fr")).toBe("ltr");
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

describe("parseLanguageCode", () => {
  it("passes through any real registry code, including newer ones -- never narrows a valid non-en/ro code back to en", () => {
    for (const code of ["ar", "fr", "de", "es", "it"]) {
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
  });

  it("matches a compound registry code (script variant) case-insensitively", () => {
    expect(resolveLanguageCodeFromBrowserTag("zh-Hans-CN")).toBe("zh-Hans");
    expect(resolveLanguageCodeFromBrowserTag("zh-hans-cn")).toBe("zh-Hans");
    expect(resolveLanguageCodeFromBrowserTag("zh-Hant-TW")).toBe("zh-Hant");
  });

  it("falls back to en for an unsupported or missing browser tag", () => {
    expect(resolveLanguageCodeFromBrowserTag("sw-KE")).toBe("en");
    expect(resolveLanguageCodeFromBrowserTag(null)).toBe("en");
    expect(resolveLanguageCodeFromBrowserTag(undefined)).toBe("en");
  });
});

describe("uiSupportedLanguages / conversationSupportedLanguages", () => {
  it("uiSupportedLanguages includes both full and beta UI languages, excludes 'none'", () => {
    const codes = uiSupportedLanguages().map((entry) => entry.code);
    expect(codes).toContain("en");
    expect(codes).toContain("ro");
    expect(codes).toContain("ar");
    expect(codes).not.toContain("pt");
    expect(codes).not.toContain("ja");
  });

  it("conversationSupportedLanguages includes exactly the seven active languages", () => {
    const codes = conversationSupportedLanguages().map((entry) => entry.code).sort();
    expect(codes).toEqual(["ar", "de", "en", "es", "fr", "it", "ro"]);
  });
});
