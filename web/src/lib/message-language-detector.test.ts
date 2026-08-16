import { describe, expect, it } from "vitest";

import { detectMessageLanguage } from "./message-language-detector";

describe("detectMessageLanguage", () => {
  it("detects Romanian from diacritics anywhere in the text", () => {
    expect(detectMessageLanguage("Clienta vrea să își păstreze părul lung.")).toBe("ro");
    expect(detectMessageLanguage("Ședința e programată mâine.")).toBe("ro");
  });

  it("detects English from common English stopwords", () => {
    expect(detectMessageLanguage("The client wants to keep her hair long with volume on top.")).toBe("en");
  });

  it("detects Romanian even with NO diacritics at all, via stopwords", () => {
    expect(detectMessageLanguage("Clienta vrea sa pastreze parul lung cu volum in partea de sus.")).toBe("ro");
    expect(detectMessageLanguage("Nu cred ca este o idee buna pentru acest client.")).toBe("ro");
  });

  it("is case-insensitive for both diacritics and stopwords", () => {
    expect(detectMessageLanguage("PĂRUL ei este lung")).toBe("ro");
    expect(detectMessageLanguage("SI CLIENTA vrea asta")).toBe("ro");
  });

  it("returns null (genuinely ambiguous) for text with no signal for either language", () => {
    expect(detectMessageLanguage("")).toBeNull();
    expect(detectMessageLanguage("42")).toBeNull();
    expect(detectMessageLanguage("Maria Popescu")).toBeNull();
  });

  it("resolves a short cross-language-ambiguous word toward English on a tie", () => {
    expect(detectMessageLanguage("Actually, let's continue in English.")).toBe("en");
  });
});
