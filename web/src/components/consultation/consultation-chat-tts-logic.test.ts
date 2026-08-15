import { describe, expect, it, vi } from "vitest";

import {
  detectSpeechLocale,
  isSpeechSynthesisSupported,
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

  it("defaults to English when no Romanian diacritics are present", () => {
    expect(detectSpeechLocale("The client wants to keep her hair long with volume on top.")).toBe("en-US");
  });

  it("is case-insensitive for diacritics", () => {
    expect(detectSpeechLocale("PĂRUL ei este lung")).toBe("ro-RO");
  });

  it("treats an empty string as English (a safe, non-crashing default)", () => {
    expect(detectSpeechLocale("")).toBe("en-US");
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

  it("falls back to the browser's default voice when no matching language exists at all", () => {
    const voices = [
      { lang: "fr-FR", name: "French" },
      { lang: "en-US", name: "English", default: true },
    ];
    expect(selectVoiceForLocale(voices, "ro-RO")?.name).toBe("English");
  });

  it("falls back to the first available voice when there's no language match and no default flagged", () => {
    const voices = [
      { lang: "fr-FR", name: "French" },
      { lang: "de-DE", name: "German" },
    ];
    expect(selectVoiceForLocale(voices, "ro-RO")?.name).toBe("French");
  });

  it("returns null when the browser reports zero installed voices", () => {
    expect(selectVoiceForLocale([], "ro-RO")).toBeNull();
  });
});

function fakeUtterance(): SpeechUtteranceLike {
  return { lang: "", voice: null, onstart: null, onend: null, onerror: null };
}

function fakeSynth(overrides: Partial<SpeechSynthesisLike> = {}): SpeechSynthesisLike & { speakCalls: SpeechUtteranceLike[]; cancelCalls: number } {
  const speakCalls: SpeechUtteranceLike[] = [];
  let cancelCalls = 0;
  return {
    speak: overrides.speak ?? ((u: SpeechUtteranceLike) => { speakCalls.push(u); }),
    cancel: overrides.cancel ?? (() => { cancelCalls += 1; }),
    getVoices: overrides.getVoices ?? (() => []),
    get speakCalls() { return speakCalls; },
    get cancelCalls() { return cancelCalls; },
  };
}

describe("speakReply", () => {
  // Regression-proofing by construction: Voice Reply must never overlap
  // two AI voices at once, no matter how quickly successive replies
  // arrive -- every speakReply call cancels whatever was playing first.
  it("always cancels any previous utterance before speaking a new one -- never two overlapping replies", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.cancelCalls).toBe(1);
    expect(synth.speakCalls).toHaveLength(1);
  });

  it("sets the utterance's lang to the detected locale of the actual text being spoken", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Părul ei este lung.", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.speakCalls[0].lang).toBe("ro-RO");
  });

  it("assigns a matching voice when the browser has one installed for the detected locale", () => {
    const synth = fakeSynth({ getVoices: () => [{ lang: "ro-RO", name: "Romanian" }, { lang: "en-US", name: "English" }] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Bună ziua.", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.speakCalls[0].voice).toEqual({ lang: "ro-RO", name: "Romanian" });
  });

  it("still speaks (with no voice assigned) when the browser has no voices installed at all, rather than refusing to try", () => {
    const synth = fakeSynth({ getVoices: () => [] });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(synth.speakCalls).toHaveLength(1);
    expect(synth.speakCalls[0].voice).toBeNull();
  });

  it("calls onStart/onEnd through the utterance's own event handlers", () => {
    const synth = fakeSynth();
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", { synth, createUtterance: fakeUtterance }, callbacks);
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

    speakReply("Hello", { synth, createUtterance: fakeUtterance }, callbacks);
    synth.speakCalls[0].onerror?.();

    expect(callbacks.onError).toHaveBeenCalledWith(VOICE_REPLY_FAILURE_MESSAGE);
  });

  it("calls onError with the same message when speak() itself throws synchronously", () => {
    const synth = fakeSynth({ speak: () => { throw new Error("synthesis unavailable"); } });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    expect(() => speakReply("Hello", { synth, createUtterance: fakeUtterance }, callbacks)).not.toThrow();
    expect(callbacks.onError).toHaveBeenCalledWith(VOICE_REPLY_FAILURE_MESSAGE);
  });

  it("never calls onStart or onEnd when speak() throws synchronously", () => {
    const synth = fakeSynth({ speak: () => { throw new Error("synthesis unavailable"); } });
    const callbacks = { onStart: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };

    speakReply("Hello", { synth, createUtterance: fakeUtterance }, callbacks);

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

    speakReply("Remember this as a professional observation.", { synth, createUtterance: fakeUtterance }, callbacks);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
