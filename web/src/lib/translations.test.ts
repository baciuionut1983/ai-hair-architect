import { describe, expect, it } from "vitest";

import { LANGUAGE_REGISTRY } from "./language-registry";
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
  "consultAi.voiceReply",
  "consultAi.stop",
  "consultAi.send",
  "consultAi.typeMessage",
  "consultAi.listening",
  "consultAi.processing",
  "consultAi.aiResponding",
  "consultAi.speaking",
  "common.on",
  "common.off",
];

describe("translate", () => {
  it("translates every key for every one of the seven active (conversation-supported) languages", () => {
    const activeCodes = LANGUAGE_REGISTRY.filter((entry) => entry.conversationSupported).map((entry) => entry.code);
    expect(activeCodes.sort()).toEqual(["ar", "de", "en", "es", "fr", "it", "ro"]);

    for (const code of activeCodes) {
      for (const key of ALL_KEYS) {
        const value = translate(code, key);
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns genuinely different text per language, not just English copied around", () => {
    const logoutTranslations = new Set(
      ["en", "ro", "ar", "it", "fr", "de", "es"].map((code) => translate(code, "topbar.logout")),
    );
    expect(logoutTranslations.size).toBe(7);
  });

  it("falls back to English for a language with no dictionary at all, rather than a raw key or blank string", () => {
    // "pt" is a real registry code (see language-registry.ts) with no
    // translations.ts dictionary yet.
    expect(translate("pt", "topbar.logout")).toBe(translate("en", "topbar.logout"));
  });

  it("falls back to English for a completely unknown code too", () => {
    expect(translate("xx", "nav.dashboard")).toBe(translate("en", "nav.dashboard"));
  });
});

describe("hasCompleteDictionary", () => {
  it("is true for all seven active languages", () => {
    for (const code of ["en", "ro", "ar", "it", "fr", "de", "es"]) {
      expect(hasCompleteDictionary(code)).toBe(true);
    }
  });

  it("is false for a registry language with no dictionary", () => {
    expect(hasCompleteDictionary("pt")).toBe(false);
  });
});

describe("TRANSLATED_LANGUAGE_CODES", () => {
  it("lists exactly the languages with a real dictionary", () => {
    expect(TRANSLATED_LANGUAGE_CODES.sort()).toEqual(["ar", "de", "en", "es", "fr", "it", "ro"]);
  });
});
