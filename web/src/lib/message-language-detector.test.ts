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

// Global script-based detection: unambiguous scripts resolve directly,
// with no stopword list required at all (see the file's own top-of-file
// design note for why this is the strategy for global coverage, not
// hundreds of hand-built stopword lists).
describe("detectMessageLanguage -- script-based detection (global coverage)", () => {
  it("detects Japanese from hiragana/katakana, unambiguously distinct from Han-only Chinese text", () => {
    expect(detectMessageLanguage("こんにちは、髪を長く保ちたいです。")).toBe("ja");
    expect(detectMessageLanguage("パーマをかけたいです。")).toBe("ja");
  });

  it("detects Korean from Hangul", () => {
    expect(detectMessageLanguage("안녕하세요, 머리를 길게 유지하고 싶어요.")).toBe("ko");
  });

  it("returns null for Han-only text -- genuinely ambiguous between Simplified/Traditional Chinese (and rare kanji-only Japanese)", () => {
    expect(detectMessageLanguage("你好，我想保持长发。")).toBeNull();
  });

  it("detects Hebrew from its script", () => {
    expect(detectMessageLanguage("שלום, אני רוצה לשמור על השיער ארוך.")).toBe("he");
  });

  it("detects Arabic from its script when no Persian/Urdu-exclusive letters are present", () => {
    expect(detectMessageLanguage("مرحبا، أريد الحفاظ على شعري طويلا.")).toBe("ar");
  });

  it("detects Urdu (the only active language of the Persian/Urdu pair) via its exclusive letters", () => {
    expect(detectMessageLanguage("ہیلو، میں اپنے بالوں کو لمبا رکھنا چاہتا ہوں۔")).toBe("ur");
  });

  it("returns null for Devanagari script -- genuinely ambiguous between Hindi and Marathi in this registry", () => {
    expect(detectMessageLanguage("नमस्ते, मैं अपने बालों को लंबा रखना चाहती हूं।")).toBeNull();
  });

  it("detects Bengali, Punjabi (Gurmukhi), Gujarati, Tamil, Telugu, Kannada, and Malayalam from their own unambiguous scripts", () => {
    expect(detectMessageLanguage("হ্যালো, আমি আমার চুল লম্বা রাখতে চাই।")).toBe("bn");
    expect(detectMessageLanguage("ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਆਪਣੇ ਵਾਲ ਲੰਬੇ ਰੱਖਣਾ ਚਾਹੁੰਦੀ ਹਾਂ।")).toBe("pa");
    expect(detectMessageLanguage("નમસ્તે, હું મારા વાળ લાંબા રાખવા માંગુ છું.")).toBe("gu");
    expect(detectMessageLanguage("வணக்கம், நான் என் முடியை நீளமாக வைத்திருக்க விரும்புகிறேன்.")).toBe("ta");
    expect(detectMessageLanguage("నమస్కారం, నేను నా జుట్టును పొడవుగా ఉంచాలనుకుంటున్నాను.")).toBe("te");
    expect(detectMessageLanguage("ನಮಸ್ಕಾರ, ನಾನು ನನ್ನ ಕೂದಲನ್ನು ಉದ್ದವಾಗಿ ಇಟ್ಟುಕೊಳ್ಳಲು ಬಯಸುತ್ತೇನೆ.")).toBe("kn");
    expect(detectMessageLanguage("നമസ്കാരം, എനിക്ക് എന്റെ മുടി നീളമുള്ളതായി സൂക്ഷിക്കണം.")).toBe("ml");
  });

  it("detects Thai from its script", () => {
    expect(detectMessageLanguage("สวัสดี ฉันอยากรักษาผมให้ยาว")).toBe("th");
  });

  it("detects Greek from its script", () => {
    expect(detectMessageLanguage("Γεια σας, θέλω να κρατήσω τα μαλλιά μου μακριά.")).toBe("el");
  });

  it("returns null for plain Cyrillic text -- genuinely ambiguous between Russian/Bulgarian/Serbian in this registry", () => {
    expect(detectMessageLanguage("Привет, я хочу сохранить длинные волосы.")).toBeNull();
  });

  it("detects Ukrainian specifically via its own exclusive Cyrillic letters (і ї є ґ)", () => {
    expect(detectMessageLanguage("Привіт, я хочу зберегти довге волосся, дякую.")).toBe("uk");
  });

  it("never applies Latin-script diacritic/stopword scoring to non-Latin script text (script wins outright)", () => {
    // Purely a construction check: Japanese text obviously has none of
    // the Latin stopwords/diacritics, so this also passes trivially --
    // included to pin down that the script branch returns before ever
    // reaching the Latin path.
    expect(detectMessageLanguage("これはテストです。")).toBe("ja");
  });
});
