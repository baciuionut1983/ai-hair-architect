import { describe, expect, it } from "vitest";

import { uiSupportedLanguages } from "./language-registry";
import { hasCompleteDictionary, translate, TRANSLATED_LANGUAGE_CODES } from "./translations";

const ALL_KEYS: Array<Parameters<typeof translate>[1]> = [
  "nav.dashboard",
  "nav.clients",
  "nav.appointments",
  "nav.academy",
  "nav.marketplace",
  "nav.account",
  "topbar.logout",
  "language.label",
  "language.search",
  "language.auto",
  "language.noMatches",
  "consultAi.voiceReply",
  "consultAi.stop",
  "consultAi.send",
  "consultAi.typeMessage",
  "consultAi.listening",
  "consultAi.processing",
  "consultAi.aiResponding",
  "consultAi.speaking",
  "consultAi.generatingVoice",
  "common.on",
  "common.off",
];

const UI_TRANSLATED_CODES = ["en", "ro", "ar", "it", "fr", "de", "es", "pt", "nl", "pl", "tr", "el", "he", "ja", "ko", "zh-Hans", "zh-Hant", "hi"];

describe("translate", () => {
  it("translates every key for every one of the eighteen UI-supported languages", () => {
    const codes = uiSupportedLanguages().map((entry) => entry.code);
    expect(codes.sort()).toEqual([...UI_TRANSLATED_CODES].sort());

    for (const code of codes) {
      for (const key of ALL_KEYS) {
        const value = translate(code, key);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns genuinely different text per language, not just English copied around", () => {
    const logoutTranslations = new Set(UI_TRANSLATED_CODES.map((code) => translate(code, "topbar.logout")));
    expect(logoutTranslations.size).toBe(UI_TRANSLATED_CODES.length);
  });

  it("falls back to English for a conversation-supported language with no UI dictionary yet", () => {
    // "ru" is a real, conversation-supported registry code (see
    // language-registry.ts) with no translations.ts dictionary yet --
    // uiSupportLevel "none" is exactly why.
    expect(translate("ru", "topbar.logout")).toBe(translate("en", "topbar.logout"));
  });

  it("falls back to English for a completely unknown code too", () => {
    expect(translate("xx", "nav.dashboard")).toBe(translate("en", "nav.dashboard"));
  });
});

describe("hasCompleteDictionary", () => {
  it("is true for all eighteen UI-supported languages", () => {
    for (const code of UI_TRANSLATED_CODES) {
      expect(hasCompleteDictionary(code)).toBe(true);
    }
  });

  it("is false for a conversation-supported language with no dictionary", () => {
    expect(hasCompleteDictionary("ru")).toBe(false);
  });
});

describe("TRANSLATED_LANGUAGE_CODES", () => {
  it("lists exactly the languages with a real dictionary", () => {
    expect(TRANSLATED_LANGUAGE_CODES.sort()).toEqual([...UI_TRANSLATED_CODES].sort());
  });
});
