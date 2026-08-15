// AI Voice Reply (Text-to-Speech) for Consult AI's own assistant replies.
// Pulled out of consultation-chat.tsx so the core logic is unit-testable
// without a rendering environment (no .test.tsx convention exists in this
// repo -- see teach-ai-panel-logic.ts for the same pattern applied to
// Speech-to-Text). Uses the browser's native Web Speech Synthesis API
// (window.speechSynthesis / SpeechSynthesisUtterance) -- confirmed by a
// full repo audit to be the only text-to-speech capability anywhere in
// this codebase, so there is nothing existing to reuse or duplicate.
// Deliberately native, not a new backend provider: the reply text already
// exists (this only ever reads it aloud, never generates a second,
// separately-worded response -- see speakReply below), it needs no API
// key/cost/new Railway variable, and it works on both desktop and mobile
// browsers that implement the standard.

// This app supports exactly two locales today (see src/lib/i18n.ts:
// SupportedLocale = "en" | "ro") -- detection is scoped to exactly that,
// not a general-purpose language identifier. Romanian-specific diacritics
// are a reliable, self-contained signal of the reply's actual language,
// independent of the stylist's own account locale -- which matters
// because a single stylist's conversations may legitimately switch
// language mid-session.
const ROMANIAN_DIACRITICS_PATTERN = /[ăâîșț]/i;

export type SpeechLocale = "ro-RO" | "en-US";

export function detectSpeechLocale(text: string): SpeechLocale {
  return ROMANIAN_DIACRITICS_PATTERN.test(text) ? "ro-RO" : "en-US";
}

export interface SpeechVoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

// Picks the best available voice for a target BCP-47 locale: an exact
// lang match first, then a language-only match (e.g. any "ro-*" voice for
// "ro-RO"), then the browser's own default voice, then simply the first
// available voice -- never throws. Returns null only when the browser
// reports zero installed voices at all, a real possibility this app
// cannot control (per the user's own acknowledgment: voice language
// follows the conversation "pe cât permite infrastructura aplicației").
export function selectVoiceForLocale<T extends SpeechVoiceLike>(voices: T[], targetLocale: string): T | null {
  if (voices.length === 0) return null;

  const exact = voices.find((voice) => voice.lang.toLowerCase() === targetLocale.toLowerCase());
  if (exact) return exact;

  const languageOnly = targetLocale.split("-")[0]?.toLowerCase() ?? targetLocale.toLowerCase();
  const sameLanguage = voices.find((voice) => voice.lang.toLowerCase().startsWith(languageOnly));
  if (sameLanguage) return sameLanguage;

  const defaultVoice = voices.find((voice) => voice.default);
  if (defaultVoice) return defaultVoice;

  return voices[0];
}

export interface SpeechUtteranceLike {
  lang: string;
  voice: SpeechVoiceLike | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SpeechSynthesisLike {
  speak(utterance: SpeechUtteranceLike): void;
  cancel(): void;
  getVoices(): SpeechVoiceLike[];
}

export interface SpeakReplyDeps {
  synth: SpeechSynthesisLike;
  createUtterance(text: string): SpeechUtteranceLike;
}

export interface SpeakReplyCallbacks {
  onStart: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

export const VOICE_REPLY_FAILURE_MESSAGE = "Voice reply failed. The text reply above is still available.";

// Regression-proofing by construction, not discipline: this only ever
// reads `text` (the reply already shown on screen) aloud -- it never
// calls any AI provider, never generates a second, separately-worded
// response, and never touches proposedMemory/Confirm/Edit/Reject at all,
// so that flow is structurally unaffected by whether Voice Reply is on.
//
// Always cancels any previous utterance before starting a new one --
// this app never has two AI voice replies audible at once, regardless of
// how quickly successive replies arrive.
export function speakReply(text: string, deps: SpeakReplyDeps, callbacks: SpeakReplyCallbacks): void {
  deps.synth.cancel();

  const utterance = deps.createUtterance(text);
  const locale = detectSpeechLocale(text);
  const voice = selectVoiceForLocale(deps.synth.getVoices(), locale);

  utterance.lang = locale;
  if (voice) {
    utterance.voice = voice;
  }
  utterance.onstart = () => callbacks.onStart();
  utterance.onend = () => callbacks.onEnd();
  utterance.onerror = () => callbacks.onError(VOICE_REPLY_FAILURE_MESSAGE);

  try {
    deps.synth.speak(utterance);
  } catch {
    // Synchronous failure (e.g. speak() itself throwing) is just as
    // possible as the async onerror event -- both must reach the same
    // fallback so the chat never silently does nothing.
    callbacks.onError(VOICE_REPLY_FAILURE_MESSAGE);
  }
}

export function stopSpeaking(synth: Pick<SpeechSynthesisLike, "cancel">): void {
  synth.cancel();
}

// Feature-detection, matching teach-ai-panel.tsx's own
// `!navigator.mediaDevices?.getUserMedia` pattern for Speak to AI: Voice
// Reply must degrade honestly to text-only on a browser that doesn't
// implement the Web Speech Synthesis API at all, never pretend the
// toggle does something it can't.
export function isSpeechSynthesisSupported(win: { speechSynthesis?: unknown } | undefined): boolean {
  return Boolean(win?.speechSynthesis);
}
