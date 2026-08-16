// Canonical "which of this app's two supported languages is this text
// written in" detector -- the SINGLE source of truth shared by both sides
// of Consult AI's language pipeline:
//   - the backend (consultation-chat-service.ts), which uses it on the
//     AI's own reply text to compute ConsultationMessageRecord.replyLanguage;
//   - the frontend (consultation-chat-tts-logic.ts's detectSpeechLocale),
//     which wraps this to pick the reply's BCP-47 speech locale.
// Before this file existed, the frontend ran its OWN, separately
// maintained copy of this exact algorithm -- meaning the AI's reply
// language and the voice that read it aloud were two independent guesses
// that could, in principle, disagree. There is now exactly one detector;
// everything else consumes its result rather than re-deriving one.
export type MessageLanguage = "en" | "ro";

const ROMANIAN_DIACRITICS_PATTERN = /[ăâîșț]/i;

const ROMANIAN_STOPWORDS = new Set([
  "si", "și", "sa", "să", "nu", "este", "sunt", "pentru", "care", "cu", "la",
  "de", "in", "în", "mai", "dar", "ce", "cum", "sau", "din", "pe", "un", "o",
  "acest", "aceasta", "această", "va", "fi", "are", "avea", "trebuie",
  "poate", "ei", "ea", "el", "lor", "noastre", "vrea", "vreau", "doreste",
  "dorește", "parul", "părul", "clienta", "clientul", "azi", "acum", "bine",
  "multumesc", "mulțumesc", "buna", "bună", "ziua", "salut", "te", "rog",
  "am", "ai", "au", "fost", "cred", "cred că", "atunci", "asta", "aici",
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

function wordScore(words: string[], set: Set<string>): number {
  let score = 0;
  for (const word of words) {
    if (set.has(word)) score += 1;
  }
  return score;
}

// Diacritics first (unambiguous when present, so text WITHOUT diacritics is
// never misdetected just because it lacks them -- a live regression this
// algorithm already fixed once), then a stopword-frequency comparison for
// diacritics-free text. Returns null only when neither language shows any
// signal at all (e.g. a bare name or a number), so callers can fall back to
// a sturdier signal (an explicit selection, or the conversation's own
// established language) instead of guessing.
export function detectMessageLanguage(text: string): MessageLanguage | null {
  if (ROMANIAN_DIACRITICS_PATTERN.test(text)) {
    return "ro";
  }

  const words = text.toLowerCase().match(/[a-zăâîșț]+/gi) ?? [];
  if (words.length === 0) {
    return null;
  }

  const roScore = wordScore(words, ROMANIAN_STOPWORDS);
  const enScore = wordScore(words, ENGLISH_STOPWORDS);

  if (roScore === 0 && enScore === 0) {
    return null;
  }

  return roScore > enScore ? "ro" : "en";
}
