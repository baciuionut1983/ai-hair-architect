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

  it("detects Arabic from its distinct script, regardless of stopwords or diacritics", () => {
    expect(detectMessageLanguage("مرحبا، أريد أن أحافظ على طول الشعر.")).toBe("ar");
    expect(detectMessageLanguage("الزبونة تريد قصة شعر قصيرة.")).toBe("ar");
  });

  it("detects German from its umlauts/ß even without recognizable stopwords", () => {
    expect(detectMessageLanguage("Größe Ärztin Übermäßig.")).toBe("de");
  });

  it("detects German from stopwords when diacritics are absent", () => {
    expect(detectMessageLanguage("Ich mochte die Haare kurzer und mit mehr Volumen oben.")).toBe("de");
  });

  it("detects French from its own diacritics (excluding the ones shared with Romanian)", () => {
    expect(detectMessageLanguage("Je voudrais garder mes cheveux très longs, s'il vous plaît.")).toBe("fr");
  });

  it("detects French from stopwords alone (no accented characters at all)", () => {
    expect(detectMessageLanguage("Je veux garder mes cheveux comme ca merci")).toBe("fr");
  });

  it("detects Spanish from its own diacritics (n-tilde, inverted punctuation)", () => {
    expect(detectMessageLanguage("¿Puede mantener el pelo así? Está muy bien, señora.")).toBe("es");
  });

  it("detects Spanish from stopwords alone", () => {
    expect(detectMessageLanguage("Quiero mantener mi pelo largo pero con mas volumen")).toBe("es");
  });

  it("detects Italian from stopwords (Italian has no diacritic set of its own -- it overlaps too much with French)", () => {
    expect(detectMessageLanguage("Vorrei tenere i capelli molto lunghi, grazie mille")).toBe("it");
  });

  // Regression: â and î are used by both Romanian and French -- an
  // earlier version's French diacritic pattern included them, causing a
  // genuinely Romanian sentence using only â (no ă/î/ș/ț, and no
  // recognizable stopwords) to resolve as an unresolvable tie instead of
  // Romanian.
  it("still detects Romanian from â alone, even though French also uses â in some words", () => {
    expect(detectMessageLanguage("Ședința e programată mâine.")).toBe("ro");
  });

  it("returns null rather than guessing between closely related Romance languages when nothing distinguishes them", () => {
    // No diacritics, no recognized stopwords in any profile -- genuinely
    // ambiguous short text.
    expect(detectMessageLanguage("Antonio Marchetti")).toBeNull();
  });
});
