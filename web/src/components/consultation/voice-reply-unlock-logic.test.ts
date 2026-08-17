import { describe, expect, it } from "vitest";

import { isValidWavHeader } from "@/lib/tts-audio-format";

import {
  AUDIO_UNLOCK_DATA_URI,
  resolveVoiceReplyEnableOutcome,
  VOICE_REPLY_UNLOCK_FAILED_MESSAGE,
} from "./voice-reply-unlock-logic";

describe("AUDIO_UNLOCK_DATA_URI", () => {
  it("is a real, valid, playable WAV clip -- not just an arbitrary base64 string", () => {
    const base64 = AUDIO_UNLOCK_DATA_URI.slice(AUDIO_UNLOCK_DATA_URI.indexOf(",") + 1);
    const bytes = Buffer.from(base64, "base64");
    expect(isValidWavHeader(bytes)).toEqual({ valid: true });
  });

  it("declares the audio/wav MIME type the app's own player expects", () => {
    expect(AUDIO_UNLOCK_DATA_URI.startsWith("data:audio/wav;base64,")).toBe(true);
  });
});

describe("resolveVoiceReplyEnableOutcome", () => {
  it("enables Voice Reply with no message when the unlock attempt succeeded", () => {
    expect(resolveVoiceReplyEnableOutcome(true)).toEqual({ enabled: true, message: null });
  });

  it("never claims Voice Reply is on when the unlock attempt failed", () => {
    const outcome = resolveVoiceReplyEnableOutcome(false);
    expect(outcome.enabled).toBe(false);
    expect(outcome.message).toBe(VOICE_REPLY_UNLOCK_FAILED_MESSAGE);
  });
});
