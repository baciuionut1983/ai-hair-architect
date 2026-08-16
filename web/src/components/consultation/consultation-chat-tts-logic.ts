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

import { detectMessageLanguage } from "@/lib/message-language-detector";
import { getLanguageDefinition, type LanguageCode } from "@/lib/language-registry";

// A BCP-47 tag suitable for SpeechSynthesisUtterance.lang / voice
// matching -- distinct from LanguageCode (the short registry identity
// shared with STT hints and AI-reply-language, e.g. "ro", "ar") in name
// only, to keep call sites self-documenting about which one they're
// holding. Deliberately `string`, not a closed union -- see
// language-registry.ts's own LanguageCode for why (a real global product
// adds languages via registry data, not type declarations).
export type SpeechLocale = string;

export function languageToSpeechLocale(language: LanguageCode): SpeechLocale {
  return getLanguageDefinition(language)?.speechLocale ?? "en-US";
}

// The stylist's own choice: "auto" follows the conversation (see
// resolveReplyLanguage below); a concrete LanguageCode fixes the language
// deterministically, overriding detection entirely -- "Selectorul manual
// trebuie să poată fixa limba atunci când utilizatorul dorește asta."
export type LanguagePreference = "auto" | LanguageCode;

// Priority chain, exactly as specified: explicit user selection -> fresh
// detection of THIS reply's own text -> the conversation's own
// established language (so a single short/ambiguous reply mid-conversation
// doesn't randomly flip voices) -> a safe, hardcoded default as the last
// resort. Returns the LANGUAGE to speak in (a LanguageCode, the same
// currency the STT hint and AI-reply-language hint use -- see
// consultation-chat-logic.ts's resolveSttLanguageHint/
// buildChatLanguageFields) AND the conversation's language going forward
// (updated only when this call had a real signal to offer, so an
// ambiguous message never erases a previously-established language).
// Callers map the returned language to an actual speech locale via
// languageToSpeechLocale right before constructing an utterance -- kept
// as a separate step so "which language is this conversation in" (shared
// across STT/AI-reply/TTS) and "which exact BCP-47 tag to hand the
// browser" (a TTS-only concern) never get conflated into one type again.
export function resolveReplyLanguage(
  text: string,
  preference: LanguagePreference,
  conversationLanguage: LanguageCode | null,
): { language: LanguageCode; conversationLanguage: LanguageCode | null } {
  if (preference !== "auto") {
    return { language: preference, conversationLanguage: preference };
  }

  const detected = detectMessageLanguage(text);
  if (detected) {
    return { language: detected, conversationLanguage: detected };
  }

  if (conversationLanguage) {
    return { language: conversationLanguage, conversationLanguage };
  }

  return { language: "en", conversationLanguage: null };
}

export interface SpeechVoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

// Picks a voice for a target BCP-47 locale: an exact lang match first,
// then a language-only match (e.g. any "ar-*" voice for "ar-SA", any
// "fr-*" voice for "fr-FR"). Returns null when the device has NO voice
// for this language at all -- unlike an earlier version of this
// function, it never falls back to the browser's "default" voice or
// simply the first available one, because that default is very often an
// unrelated-language voice (e.g. an en-* voice on an English-OS install).
// This logic was already fully generic (never hardcoded to ro/en); it
// works unchanged for every registry language.
//
// Regression: a live test with Language: Romanian selected showed the
// reply's TEXT correctly in Romanian, but read aloud with an English
// voice. Root cause: this function used to substitute that unrelated
// default/first voice, and once utterance.voice is explicitly set,
// browsers use THAT voice's own language and effectively ignore
// utterance.lang -- so "no Romanian voice installed" silently became
// "reads Romanian text with an English voice" instead of an honest
// fallback. Returning null here leaves utterance.voice unset, so the
// browser is free to use utterance.lang on its own -- see speakReply's
// onVoiceUnavailable callback for how the caller is told about this case.
export function selectVoiceForLocale<T extends SpeechVoiceLike>(voices: T[], targetLocale: SpeechLocale): T | null {
  if (voices.length === 0) return null;

  const exact = voices.find((voice) => voice.lang.toLowerCase() === targetLocale.toLowerCase());
  if (exact) return exact;

  const languageOnly = targetLocale.split("-")[0]?.toLowerCase() ?? targetLocale.toLowerCase();
  const sameLanguage = voices.find((voice) => voice.lang.toLowerCase().startsWith(languageOnly));
  return sameLanguage ?? null;
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
  // Regression: getUserMedia (used by the chat composer's own microphone
  // -- see use-voice-recording.ts) is a documented trigger for some
  // Chromium builds leaving the speech synthesis engine internally
  // paused; a live test showed a reply's TTS silently not starting at all
  // specifically after a voice-input message, never after a typed one.
  // cancel() alone does not reliably unstick a paused engine -- resume()
  // does, and is a no-op when the engine isn't paused, so speakReply calls
  // it unconditionally before every speak(), regardless of the message's
  // origin.
  resume(): void;
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
  // Fired (synchronously, before speaking starts) when the device has no
  // installed voice matching the requested locale at all -- speech still
  // proceeds best-effort (via utterance.lang alone, with no voice
  // assigned), but the caller must tell the stylist plainly rather than
  // silently implying the requested language played correctly. The
  // caller renders this generically for whatever language was requested
  // (e.g. "No Arabic voice is installed on this device"), never
  // hardcoded to a fixed pair of languages.
  onVoiceUnavailable?: (locale: SpeechLocale) => void;
}

export const VOICE_REPLY_FAILURE_MESSAGE = "Voice reply failed. The text reply above is still available.";

// Temporary, safe-fields-only diagnostics for the live voice-selection
// bug -- never the reply text itself, only locale/voice names, matching
// this codebase's existing logClient (teach-ai-panel-logic.ts) convention.
// Kept until multilingual voice selection has been retested live.
//
// Shares the "VOICE_REPLY_CLIENT" tag with consultation-chat-cloud-tts-
// logic.ts's own logging (both are diagnostics for the same Voice Reply
// feature, one console filter finds either) -- but this event is
// explicitly "local_"-prefixed so the SOURCE is unambiguous. A prior
// naming collision here (this file's event was just "speak_requested",
// indistinguishable at a glance from the cloud file's own events) briefly
// made a live retest's console output look like cloud TTS had never even
// logged anything, when the real issue was a stale deployed bundle.
const VOICE_REPLY_CLIENT_LOG_TAG = "VOICE_REPLY_CLIENT";

function logVoiceReplyClient(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ tag: VOICE_REPLY_CLIENT_LOG_TAG, event, ...details }));
}

// Regression-proofing by construction, not discipline: this only ever
// reads `text` (the reply already shown on screen) aloud -- it never
// calls any AI provider, never generates a second, separately-worded
// response, and never touches proposedMemory/Confirm/Edit/Reject at all,
// so that flow is structurally unaffected by whether Voice Reply is on.
//
// Always cancels any previous utterance before starting a new one --
// this app never has two AI voice replies audible at once, regardless of
// how quickly successive replies arrive.
//
// `locale` is the caller's already-resolved BCP-47 speech locale (via
// resolveReplyLanguage + languageToSpeechLocale) -- this function only
// ever speaks in exactly the locale it's given, never re-derives one, so
// the priority chain lives in exactly one place.
export function speakReply(text: string, locale: SpeechLocale, deps: SpeakReplyDeps, callbacks: SpeakReplyCallbacks): void {
  deps.synth.cancel();
  deps.synth.resume();

  const utterance = deps.createUtterance(text);
  const voices = deps.synth.getVoices();
  const voice = selectVoiceForLocale(voices, locale);

  utterance.lang = locale;
  if (voice) {
    utterance.voice = voice;
  } else {
    callbacks.onVoiceUnavailable?.(locale);
  }

  logVoiceReplyClient("local_speak_requested", {
    requestedLanguage: locale,
    utteranceLang: utterance.lang,
    selectedVoiceName: voice?.name ?? null,
    selectedVoiceLang: voice?.lang ?? null,
    voiceCount: voices.length,
    // Distinct langs only (deduped) -- confirms live, on the actual
    // device, whether ANY matching voice is even installed at all,
    // rather than assuming from voiceCount alone.
    availableVoiceLangs: [...new Set(voices.map((v) => v.lang))],
  });

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
