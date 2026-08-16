import { describe, expect, it, vi } from "vitest";

import {
  detectSpeechLocale,
  isSpeechSynthesisSupported,
  resolveReplySpeechLocale,
  selectVoiceForLocale,
  speakReply,
  stopSpeaking,
  VOICE_REPLY_FAILURE_MESSAGE,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
} from "./consultation-chat-tts-logic";

describe("detectSpeechLocale", () => {
  it("detects Romanian from diacritics anywhere in the text", () => {
    expect(detectSpeechLocale("Clienta vrea să își păstreze părul lung.")).toBe("ro-RO");
    expect(detectSpeechLocale("Ședința e programată mâine.")).toBe("ro-RO");
  });

  it("detects English from common English stopwords", () => {
    expect(detectSpeechLocale("The client wants to keep her hair long with volume on top.")).toBe("en-US");
  });

  // Regression: the exact live bug -- a Romanian reply pronounced as
  // English, because the original detector only checked diacritics.
  it("detects Romanian even with NO diacritics at all, via stopwords", () => {
    expect(detectSpeechLocale("Clienta vrea sa pastreze parul lung cu volum in partea de sus.")).toBe("ro-RO");
    expect(detectSpeechLocale("Nu cred ca este o idee buna pentru acest client.")).toBe("ro-RO");
  });

  it("is case-insensitive for both diacritics and stopwords", () => {
    expect(detectSpeechLocale("PĂRUL ei este lung")).toBe("ro-RO");
    expect(detectSpeechLocale("SI CLIENTA vrea asta")).toBe("ro-RO");
  });

  it("returns null (genuinely ambiguous) for text with no signal for either language", () => {
    expect(detectSpeechLocale("")).toBeNull();
    expect(detectSpeechLocale("42")).toBeNull();
    expect(detectSpeechLocale("Maria Popescu")).toBeNull();
  });
});

describe("resolveReplySpeechLocale", () => {
  it("an explicit (non-auto) preference always wins, ignoring the text entirely", () => {
    const result = resolveReplySpeechLocale("This is clearly English text.", "ro-RO", null);
    expect(result.locale).toBe("ro-RO");
    expect(result.conversationLocale).toBe("ro-RO");
  });

  it("auto mode: a confident detection of THIS text wins over any prior conversation locale", () => {
    const result = resolveReplySpeechLocale("Bună ziua, cum vă pot ajuta?", "auto", "en-US");
    expect(result.locale).toBe("ro-RO");
    expect(result.conversationLocale).toBe("ro-RO");
  });

  it("auto mode: falls back to the established conversation locale when this text is ambiguous", () => {
    const result = resolveReplySpeechLocale("42", "auto", "ro-RO");
    expect(result.locale).toBe("ro-RO");
    expect(result.conversationLocale).toBe("ro-RO");
  });

  it("auto mode: falls back to a safe default (en-US) when there's no signal and no prior conversation locale yet", () => {
    const result = resolveReplySpeechLocale("42", "auto", null);
    expect(result.locale).toBe("en-US");
    expect(result.conversationLocale).toBeNull();
  });

  it("auto mode: an ambiguous message never erases a previously-established conversation locale", () => {
    const result = resolveReplySpeechLocale("OK.", "auto", "ro-RO");
    expect(result.conversationLocale).toBe("ro-RO");
  });

  it("switches the conversation locale going forward once a new confident detection arrives", () => {
    const first = resolveReplySpeechLocale("Bună, cum te pot ajuta?", "auto", null);
    expect(first.conversationLocale).toBe("ro-RO");

    const second = resolveReplySpeechLocale("Actually, let's continue in English.", "auto", first.conversationLocale);
    expect(second.locale).toBe("en-US");
    expect(second.conversationLocale).toBe("en-US");
  });
});

describe("selectVoiceForLocale", () => {
  it("prefers an exact lang match over anything else", () => {
    const voices = [
      { lang: "ro-MD", name: "Moldovan" },
      { lang: "ro-RO", name: "Romanian" },
      { lang: "en-US", name: "English", default: true },
    ];
    expect(selectVoiceForLocale(voices, "ro-RO")?.name).toBe("Romanian");
  });

  it("falls back to a same-language voice when no exact match exists", () => {
    const voices = [
      { lang: "ro-MD", name: "Moldovan" },
      { lang: "en-US", name: "English", default: true },
    ];
    expect(selectVoiceForLocale(voices, "ro-RO")?.name).toBe("Moldovan");
  });

  it("returns null when the browser reports zero installed voices", () => {
    expect(selectVoiceForLocale([], "ro-RO")).toBeNull();
  });

  // Regression (bug #1): a live test with Language: Romanian selected
  // showed the reply's text correctly in Romanian, but read aloud with an
  // English voice. An earlier version of this function fell back to the
  // browser's "default" voice (often en-*) or simply the first available
  // voice when no ro-* voice existed -- these two tests pin down that it
  // must NEVER substitute a voice from an unrelated language, even when
  // one is flagged as the browser's own default or is simply first in the
  // list, regardless of the target language actually being installed.
  it("never substitutes the browser's default voice when it belongs to a different language than requested", () => {
    const voices = [
      { lang: "fr-FR", name: "French" },
      { lang: "en-US", name: "English", default: true },
    ];
    expect(selectVoiceForLocale(voices, "ro-RO")).toBeNull();
  });

  it("never substitutes the first available voice when no voice matches the requested language at all", () => {
    const voices = [
      { lang: "fr-FR", name: "French" },
      { lang: "de-DE", name: "German" },
    ];
    expect(selectVoiceForLocale(voices, "ro-RO")).toBeNull();
  });
});

function fakeUtterance(): SpeechUtteranceLike {
  return { lang: "", voice: null, onstart: null, onend: null, onerror: null };
}

function fakeSynth(
  overrides: Partial<SpeechSynthesisLike> = {},
): SpeechSynthesisLike & { speakCalls: SpeechUtteranceLike[]; cancelCalls: number; resumeCalls: number } {
  const speakCalls: SpeechUtteranceLike[] = [];
  let cancelCalls = 0;
  let resumeCalls = 0;
  return {
    speak: overrides.speak ?? ((u: SpeechUtteranceLike) => { speakCalls.push(u); }),
    cancel: overrides.cancel ?? (() => { cancelCalls += 1; }),
    resume: overrides.resume ?? (() => { resumeCalls += 1; }),
    getVoices: overrides.getVoices ?? (() => []),
    get speakCalls() { return speakCalls; },
    get cancelCalls() { return cancelCalls; },
    get resumeCalls() { return resumeCalls; },
  };
}

describe("speakReply", () => {
  // Regression-proofing by construction: Voice Reply must never overlap
  // two AI voices at once, no matter how quickly successive replies
  // arrive -- every speakReply call cancels whatever was playing first.
  it("always cancels any previous utterance before speaking a new one -- never two overlapping replies", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.cancelCalls).toBe(1);
    expect(synth.speakCalls).toHaveLength(1);
  });

  // Regression (bug #2): a live test showed Voice Reply silently not
  // starting at all, but ONLY for a reply that followed a chat-composer
  // voice-input message -- the exact same code path worked normally for a
  // typed message. getUserMedia (the chat mic's own STT capture) is a
  // documented trigger for some Chromium builds leaving the speech
  // synthesis engine internally paused; cancel() alone doesn't reliably
  // unstick it. resume() must be called unconditionally, every time --
  // it's a no-op when the engine isn't paused, so there's no reason to
  // ever skip it based on message origin.
  it("always calls resume() (in addition to cancel()) before speaking, regardless of message origin", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.resumeCalls).toBe(1);
  });

  it("speaks in exactly the locale it's given, never re-deriving one from the text itself", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    // Deliberately mismatched: English text, but told to speak Romanian --
    // speakReply must obey the caller, not the text.
    speakReply("This is English text.", "ro-RO", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.speakCalls[0].lang).toBe("ro-RO");
  });

  it("assigns a matching voice when the browser has one installed for the given locale", () => {
    const synth = fakeSynth({ getVoices: () => [{ lang: "ro-RO", name: "Romanian" }, { lang: "en-US", name: "English" }] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Bună ziua.", "ro-RO", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.speakCalls[0].voice).toEqual({ lang: "ro-RO", name: "Romanian" });
  });

  it("still speaks (with no voice assigned) when the browser has no voices installed at all, rather than refusing to try", () => {
    const synth = fakeSynth({ getVoices: () => [] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.speakCalls).toHaveLength(1);
    expect(synth.speakCalls[0].voice).toBeNull();
  });

  // Regression (bug #1, honest-fallback half): the fix for "reads Romanian
  // text with an English voice" is to never assign an unrelated-language
  // voice -- but simply going silent about it would be its own kind of
  // dishonesty ("pretend Romanian Voice is active"). onVoiceUnavailable
  // must fire so the UI can tell the stylist plainly, in both the
  // "wrong-language voices exist" and "zero voices installed at all" cases
  // -- from the stylist's perspective, both mean the same thing: no
  // guarantee this will sound like the requested language.
  it("calls onVoiceUnavailable when the browser has voices installed but none for the requested language", () => {
    const synth = fakeSynth({ getVoices: () => [{ lang: "en-US", name: "English", default: true }] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn(), onVoiceUnavailable: vi.fn() };

    speakReply("Bună ziua.", "ro-RO", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(callbacks.onVoiceUnavailable).toHaveBeenCalledWith("ro-RO");
    expect(synth.speakCalls[0].voice).toBeNull();
    // Still attempts to speak, best-effort, via utterance.lang alone.
    expect(synth.speakCalls[0].lang).toBe("ro-RO");
  });

  it("calls onVoiceUnavailable when the browser has zero voices installed at all", () => {
    const synth = fakeSynth({ getVoices: () => [] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn(), onVoiceUnavailable: vi.fn() };

    speakReply("Bună ziua.", "ro-RO", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(callbacks.onVoiceUnavailable).toHaveBeenCalledWith("ro-RO");
  });

  it("never calls onVoiceUnavailable when a matching-language voice is actually found", () => {
    const synth = fakeSynth({ getVoices: () => [{ lang: "ro-RO", name: "Romanian" }] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn(), onVoiceUnavailable: vi.fn() };

    speakReply("Bună ziua.", "ro-RO", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(callbacks.onVoiceUnavailable).not.toHaveBeenCalled();
  });

  it("does not throw when onVoiceUnavailable is omitted (optional callback)", () => {
    const synth = fakeSynth({ getVoices: () => [{ lang: "en-US", name: "English" }] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    expect(() => speakReply("Bună ziua.", "ro-RO", { synth, createUtterance: fakeUtterance }, callbacks)).not.toThrow();
  });

  it("calls onStart/onEnd through the utterance's own event handlers", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);
    const utterance = synth.speakCalls[0];
    utterance.onstart?.();
    utterance.onend?.();

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  // Requirement: if TTS fails, the text conversation must continue
  // normally with clear feedback, never blocking the chat.
  it("calls onError with a clear, non-blocking message via the utterance's async onerror event", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);
    synth.speakCalls[0].onerror?.();

    expect(callbacks.onError).toHaveBeenCalledWith(VOICE_REPLY_FAILURE_MESSAGE);
  });

  it("calls onError with the same message when speak() itself throws synchronously", () => {
    const synth = fakeSynth({ speak: () => { throw new Error("synthesis unavailable"); } });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    expect(() => speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks)).not.toThrow();
    expect(callbacks.onError).toHaveBeenCalledWith(VOICE_REPLY_FAILURE_MESSAGE);
  });

  it("never calls onStart or onEnd when speak() throws synchronously", () => {
    const synth = fakeSynth({ speak: () => { throw new Error("synthesis unavailable"); } });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });
});

describe("stopSpeaking", () => {
  it("calls cancel on the synthesis engine", () => {
    const synth = fakeSynth();
    stopSpeaking(synth);
    expect(synth.cancelCalls).toBe(1);
  });
});

describe("isSpeechSynthesisSupported", () => {
  it("is true when the browser exposes speechSynthesis", () => {
    expect(isSpeechSynthesisSupported({ speechSynthesis: {} })).toBe(true);
  });

  it("is false when speechSynthesis is undefined (unsupported browser) -- Voice Reply must degrade to text-only honestly", () => {
    expect(isSpeechSynthesisSupported({ speechSynthesis: undefined })).toBe(false);
  });

  it("is false when given undefined (e.g. no window at all, matching teach-ai-panel.tsx's own feature-detection pattern)", () => {
    expect(isSpeechSynthesisSupported(undefined)).toBe(false);
  });
});

// Explicit requirement: Voice Reply must never touch professional memory
// or the Proposed Memory Confirm/Edit/Reject flow in any way -- it is
// purely a read-aloud of text already on screen. This is true by
// construction (this module never imports fetch or any memory-related
// API at all), but this test pins that guarantee down directly rather
// than leaving it merely implicit.
describe("Voice Reply never touches professional memory", () => {
  it("speakReply calls only the injected speech synthesis dependency -- no network request of any kind", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch call from speakReply"));
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Remember this as a professional observation.", "en-US", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
