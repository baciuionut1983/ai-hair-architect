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
// Scope and honesty: this is a lightweight, dependency-free heuristic (no
// language-detection library, matching this codebase's minimal-dependency
// philosophy), not a general-purpose classifier. It reliably distinguishes
// Arabic (a distinct script, near-certain once any Arabic-range character
// appears) and gives each Latin-script language covered below its own
// diacritic + stopword signal -- but closely related Romance languages
// (Italian/French/Spanish) can genuinely be ambiguous for short text, and
// this deliberately returns null rather than guess in that case, exactly
// like the original Romanian/English-only version did. A null result
// falls back to a sturdier signal (an explicit selection, or the
// conversation's own already-established language) instead of a guess.
const ARABIC_SCRIPT_PATTERN = /[؀-ۿ]/;

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

// Arabic script first (a distinct script, unambiguous once any character
// in range appears -- exactly like Romanian's diacritics were the
// strongest available signal for that language). Then, for Latin-script
// text: a single matching per-language diacritic set is trusted outright;
// when zero or MULTIPLE match (shared accented characters across Romance
// languages), fall through to stopword-frequency scoring across every
// profile, returning null on a genuine tie or on no signal at all, rather
// than guessing between closely related languages.
export function detectMessageLanguage(text: string): LanguageCode | null {
  if (ARABIC_SCRIPT_PATTERN.test(text)) {
    return "ar";
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
