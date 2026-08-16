import type { LanguageCode } from "./language-registry";

// Canonical "which language is this text written in" detector -- the
// SINGLE source of truth shared by both sides of Consult AI's language
// pipeline:
//   - the backend (consultation-chat-service.ts), used as a fallback when
//     Gemini's own self-reported replyLanguageCode is unavailable (see
//     SYSTEM_INSTRUCTION rule 11 in consultation-chat-provider-gemini.ts
//     -- the model's own multilingual understanding is the PRIMARY signal
//     now, this is a defensive backstop, not the main mechanism);
//   - the frontend (consultation-chat-tts-logic.ts's detectSpeechLocale),
//     which wraps this to pick a message's BCP-47 speech locale, and the
//     chat composer's STT hint before any AI reply exists yet to consult.
// Before this file existed, the frontend ran its OWN, separately
// maintained copy of this exact algorithm -- meaning the AI's reply
// language and the voice that read it aloud were two independent guesses
// that could, in principle, disagree. There is now exactly one detector;
// everything else consumes its result rather than re-deriving one.
//
// Strategy for global coverage, deliberately NOT hundreds of hand-built
// stopword lists: a SCRIPT is a far stronger and cheaper signal than
// vocabulary for the many languages that use a script largely or
// entirely their own (Hebrew, Japanese kana, Korean Hangul, Bengali,
// Tamil, Telugu, Kannada, Malayalam, Gujarati, Thai, Greek, ...) -- these
// are resolved by Unicode script range alone, unambiguously, with no
// stopword list needed at all. Only where a script is genuinely SHARED
// by multiple active languages (Han by zh-Hans/zh-Hant, Devanagari by
// hi/mr, Cyrillic by ru/uk/bg/sr, the Arabic block by ar/ur/fa) does this
// stay deliberately cautious: a per-script exclusive-marker check
// resolves the few cases that genuinely can be told apart this way (see
// PERSIAN_URDU_MARKER_PATTERN/UKRAINIAN_MARKER_PATTERN below), and
// returns null -- not a guess -- for the rest, exactly per "nu inventa."
// Latin-script languages keep the original diacritic + stopword approach
// (the only script family where vocabulary, not the character set
// itself, is the distinguishing signal) for the six languages it was
// already built and tested for; other Latin-script active languages
// (Portuguese, Dutch, Polish, Turkish, Swedish, ...) simply have no local
// fast path and return null here, safely deferring to an explicit
// selection, the conversation's already-established language, or
// Gemini's own replyLanguageCode -- never a fabricated guess.
const HIRAGANA_KATAKANA_PATTERN = /[぀-ヿ]/;
const HANGUL_PATTERN = /[가-힣]/;
const HAN_PATTERN = /[一-鿿]/;
const HEBREW_SCRIPT_PATTERN = /[֐-׿]/;
const ARABIC_SCRIPT_PATTERN = /[؀-ۿ]/;
// پ چ ژ گ -- letters used by Persian/Urdu but not standard Arabic. Both
// fa and ur share them (this does not distinguish fa from ur), but "ur"
// is this app's only ACTIVE language of the two (see language-registry.ts
// -- fa is registry-only, not conversationSupported), so resolving to it
// is the best real match among what the app actually offers, not a
// guess between two live options.
const PERSIAN_URDU_MARKER_PATTERN = /[پچژگ]/;
// Deliberately excludes U+0964/U+0965 (danda / double danda,
// ।-॥) -- other Brahmic scripts checked below (Bengali,
// Gujarati, Tamil, ...) commonly borrow those same two punctuation
// characters as their own sentence-ending marks, so matching on them
// alone would misfire as "ambiguous Devanagari" for text that's
// genuinely written in one of those other scripts entirely (a real bug
// this file's own tests caught: Bengali sample text ending in "।" was
// misdetected this way before this exclusion).
const DEVANAGARI_PATTERN = /[ऀ-ॣ०-ॿ]/;
const BENGALI_PATTERN = /[ঀ-৿]/;
const GURMUKHI_PATTERN = /[਀-੿]/;
const GUJARATI_PATTERN = /[઀-૿]/;
const TAMIL_PATTERN = /[஀-௿]/;
const TELUGU_PATTERN = /[ఀ-౿]/;
const KANNADA_PATTERN = /[ಀ-೿]/;
const MALAYALAM_PATTERN = /[ഀ-ൿ]/;
const THAI_PATTERN = /[฀-๿]/;
const GREEK_SCRIPT_PATTERN = /[Ͱ-Ͽ]/;
const CYRILLIC_SCRIPT_PATTERN = /[Ѐ-ӿ]/;
// і ї є ґ -- letters used by Ukrainian but not Russian/Bulgarian/Serbian.
const UKRAINIAN_MARKER_PATTERN = /[іїєґ]/i;

interface ScriptMatch {
  matched: boolean;
  language: LanguageCode | null;
}

// Checked in roughly "most exclusive first" order so a script that could
// otherwise be mistaken for a broader one (e.g. kana vs. Han) is caught
// first. Returns matched:false only when NO non-Latin script pattern hit
// at all, so the Latin diacritic/stopword path below only ever runs on
// text that's actually Latin-script.
function detectByScript(text: string): ScriptMatch {
  if (HIRAGANA_KATAKANA_PATTERN.test(text)) return { matched: true, language: "ja" };
  if (HANGUL_PATTERN.test(text)) return { matched: true, language: "ko" };
  // Han alone (no kana) is genuinely ambiguous between Simplified/
  // Traditional Chinese (and rare kanji-only Japanese) -- don't guess.
  if (HAN_PATTERN.test(text)) return { matched: true, language: null };
  if (HEBREW_SCRIPT_PATTERN.test(text)) return { matched: true, language: "he" };
  if (ARABIC_SCRIPT_PATTERN.test(text)) {
    return { matched: true, language: PERSIAN_URDU_MARKER_PATTERN.test(text) ? "ur" : "ar" };
  }
  // Devanagari is shared by Hindi and Marathi in this registry -- don't
  // guess between them.
  if (DEVANAGARI_PATTERN.test(text)) return { matched: true, language: null };
  if (BENGALI_PATTERN.test(text)) return { matched: true, language: "bn" };
  if (GURMUKHI_PATTERN.test(text)) return { matched: true, language: "pa" };
  if (GUJARATI_PATTERN.test(text)) return { matched: true, language: "gu" };
  if (TAMIL_PATTERN.test(text)) return { matched: true, language: "ta" };
  if (TELUGU_PATTERN.test(text)) return { matched: true, language: "te" };
  if (KANNADA_PATTERN.test(text)) return { matched: true, language: "kn" };
  if (MALAYALAM_PATTERN.test(text)) return { matched: true, language: "ml" };
  if (THAI_PATTERN.test(text)) return { matched: true, language: "th" };
  if (GREEK_SCRIPT_PATTERN.test(text)) return { matched: true, language: "el" };
  if (CYRILLIC_SCRIPT_PATTERN.test(text)) {
    // Russian/Bulgarian/Serbian share the base Cyrillic alphabet closely
    // enough that this app does not try to tell them apart from the
    // script alone -- only Ukrainian's own exclusive letters are trusted.
    return { matched: true, language: UKRAINIAN_MARKER_PATTERN.test(text) ? "uk" : null };
  }
  return { matched: false, language: null };
}

const ROMANIAN_STOPWORDS = new Set([
  "si", "și", "sa", "să", "nu", "este", "sunt", "pentru", "care", "cu", "la",
  "de", "in", "în", "mai", "dar", "ce", "cum", "sau", "din", "pe", "un", "o",
  "acest", "aceasta", "această", "va", "fi", "are", "avea", "trebuie",
  "poate", "ei", "ea", "el", "lor", "noastre", "vrea", "vreau", "doreste",
  "dorește", "parul", "părul", "clienta", "clientul", "azi", "acum", "bine",
  "multumesc", "mulțumesc", "buna", "bună", "ziua", "salut", "te", "rog",
  "am", "ai", "au", "fost", "cred", "atunci", "asta", "aici",
]);

const ENGLISH_STOPWORDS = new Set([
  "the", "is", "are", "for", "with", "and", "that", "this", "her", "she",
  "want", "wants", "would", "like", "please", "hair", "client", "thanks",
  "have", "has", "will", "can", "should", "keep", "more", "very", "today",
  "hello", "hi", "yes", "no", "not", "you", "your", "what", "how", "when",
  "was", "were", "been", "think", "here", "there", "then", "in", "on", "at",
  "to", "it", "be", "do", "so", "if", "or", "we", "us", "my", "as", "an",
  "by", "up", "of", "a", "let", "let's", "continue", "actually",
]);

const GERMAN_STOPWORDS = new Set([
  "der", "die", "das", "und", "ist", "nicht", "für", "mit", "ich", "du",
  "er", "sie", "es", "wir", "ihr", "auf", "ein", "eine", "einen", "einer",
  "sein", "haben", "wird", "werden", "kann", "möchte", "bitte", "danke",
  "heute", "jetzt", "gut", "sehr", "hier", "wie", "was", "wann", "warum",
  "kein", "keine", "auch", "noch", "schon", "mehr", "aber", "oder", "wenn",
  "dass", "sich", "mich", "dich", "uns", "euch", "haar", "haare", "kundin",
  "klientin", "bekommen", "möchten", "brauche",
]);

const FRENCH_STOPWORDS = new Set([
  "le", "la", "les", "de", "des", "du", "et", "est", "pour", "avec", "je",
  "tu", "il", "elle", "nous", "vous", "ils", "elles", "un", "une", "ce",
  "cette", "que", "qui", "dans", "sur", "pas", "ne", "plus", "très",
  "bien", "oui", "non", "merci", "bonjour", "maintenant", "veut",
  "voudrais", "cheveux", "cliente", "garder", "comme", "mais", "ou", "si",
  "être", "avoir", "faire", "aujourd'hui",
]);

const ITALIAN_STOPWORDS = new Set([
  "il", "lo", "la", "i", "gli", "le", "di", "che", "per", "con", "sono",
  "questo", "questa", "un", "una", "non", "si", "ma", "come", "più",
  "molto", "bene", "sì", "grazie", "ciao", "oggi", "adesso", "vuole",
  "vorrei", "capelli", "cliente", "tenere", "anche", "però", "ecco",
  "dove", "quando", "perché", "essere", "avere", "fare",
]);

const SPANISH_STOPWORDS = new Set([
  "el", "la", "los", "las", "de", "que", "es", "para", "con", "está", "un",
  "una", "no", "sí", "muy", "bien", "gracias", "hola", "hoy", "ahora",
  "quiere", "quisiera", "pelo", "cabello", "clienta", "cliente",
  "mantener", "pero", "como", "más", "este", "esta", "ser", "tener",
  "hacer", "cuando", "donde", "porque",
]);

interface LatinLanguageProfile {
  code: LanguageCode;
  // A per-language diacritic/character signal that is a STRONG, near-
  // unambiguous marker when it's the ONLY one of these profiles whose
  // pattern matches -- if more than one language's pattern matches the
  // same text (e.g. French and Italian both use accented vowels), this
  // signal is deliberately not trusted alone; stopword scoring below
  // decides instead.
  diacritics?: RegExp;
  stopwords: Set<string>;
}

const LATIN_PROFILES: LatinLanguageProfile[] = [
  { code: "ro", diacritics: /[ăâîșț]/i, stopwords: ROMANIAN_STOPWORDS },
  { code: "en", stopwords: ENGLISH_STOPWORDS },
  { code: "de", diacritics: /[äöüß]/i, stopwords: GERMAN_STOPWORDS },
  // â and î deliberately excluded here even though French uses them (e.g.
  // "âge", "maîtriser") -- both collide with Romanian's own â/î, and
  // Romanian relies on them far more centrally. French keeps plenty of
  // its own unambiguous signal without them (à/é/è/ê/ë/ç/ô/û/ù/œ).
  { code: "fr", diacritics: /[àéèêëçôûùœ]/i, stopwords: FRENCH_STOPWORDS },
  { code: "it", stopwords: ITALIAN_STOPWORDS },
  { code: "es", diacritics: /[ñ¿¡]/i, stopwords: SPANISH_STOPWORDS },
];

function wordScore(words: string[], set: Set<string>): number {
  let score = 0;
  for (const word of words) {
    if (set.has(word)) score += 1;
  }
  return score;
}

// Script detection first -- unambiguous and cheap for every non-Latin
// script this app currently has an active language for (see
// detectByScript above). Only text that matched NO non-Latin script at
// all falls through to the Latin diacritic/stopword path: a single
// matching per-language diacritic set is trusted outright; when zero or
// MULTIPLE match (shared accented characters across Romance languages),
// stopword-frequency scoring decides, returning null on a genuine tie or
// on no signal at all, rather than guessing between closely related
// languages.
export function detectMessageLanguage(text: string): LanguageCode | null {
  const script = detectByScript(text);
  if (script.matched) {
    return script.language;
  }

  const diacriticMatches = LATIN_PROFILES.filter((profile) => profile.diacritics?.test(text));
  if (diacriticMatches.length === 1) {
    return diacriticMatches[0].code;
  }

  const words = text.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) ?? [];
  if (words.length === 0) {
    return null;
  }

  let bestCode: LanguageCode | null = null;
  let bestScore = 0;
  let tiedAtBest = false;
  for (const profile of LATIN_PROFILES) {
    const score = wordScore(words, profile.stopwords);
    if (score > bestScore) {
      bestCode = profile.code;
      bestScore = score;
      tiedAtBest = false;
    } else if (score === bestScore && score > 0) {
      tiedAtBest = true;
    }
  }

  if (bestScore === 0 || tiedAtBest) {
    return null;
  }
  return bestCode;
}
