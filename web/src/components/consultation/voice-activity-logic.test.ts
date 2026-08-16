import { describe, expect, it } from "vitest";

import {
  DEFAULT_VAD_CONFIG,
  evaluateVadSample,
  initVadState,
  shouldAutoSubmitTranscript,
  type VadState,
} from "./voice-activity-logic";

const LOUD = 0.5;
const QUIET = 0.001;

describe("evaluateVadSample", () => {
  it("does not stop while the stylist is actively speaking", () => {
    const state = initVadState(0);
    const result = evaluateVadSample(state, LOUD, 100);
    expect(result.decision).toBe("continue");
    expect(result.state.hasDetectedSpeech).toBe(true);
  });

  // The exact required scenario: speech detected, then ~2s of silence ->
  // auto stop.
  it("auto-stops after silenceDurationMs of quiet following detected speech", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, LOUD, 500); // speech at t=500
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, QUIET, 1500); // 1000ms of silence so far
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, QUIET, 2500); // 2000ms of silence since t=500
    expect(result.decision).toBe("stop_silence");
  });

  // Required: a short pause between words (well under the threshold) must
  // never trip an auto-stop.
  it("does NOT stop on a short silence below the threshold", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, LOUD, 500);
    state = result.state;

    result = evaluateVadSample(state, QUIET, 1200); // only 700ms of silence
    expect(result.decision).toBe("continue");
  });

  // Required: NOT a fixed "2 seconds from start" timer -- a new loud
  // sample must restart the silence countdown from scratch, so speech
  // separated by brief pauses is never cut off.
  it("a fresh loud sample resets the silence countdown, even after some quiet time has already passed", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, LOUD, 0);
    state = result.state;

    result = evaluateVadSample(state, QUIET, 1500); // 1500ms quiet
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, LOUD, 1600); // speaks again -- resets the clock
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, QUIET, 3000); // only 1400ms since the t=1600 speech
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, QUIET, 3700); // now 2100ms since t=1600
    expect(result.decision).toBe("stop_silence");
  });

  // Required: if the stylist never speaks at all, a safe timeout must
  // still end the recording.
  it("stops via the no-speech safety timeout when nothing is ever said", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, QUIET, 5000);
    expect(result.decision).toBe("continue");
    state = result.state;

    result = evaluateVadSample(state, QUIET, 10000);
    expect(result.decision).toBe("stop_no_speech_timeout");
  });

  it("never applies the no-speech timeout once real speech has been detected, even much later", () => {
    let state = initVadState(0);
    let result = evaluateVadSample(state, LOUD, 100);
    state = result.state;

    // Well past noSpeechTimeoutMs (10s), but speech WAS detected -- this
    // must be judged purely on the silence-after-speech rule, not the
    // no-speech safety net.
    result = evaluateVadSample(state, QUIET, 11000);
    expect(result.decision).toBe("stop_silence");
  });

  it("respects a custom config", () => {
    const config = { speechLevelThreshold: 0.1, silenceDurationMs: 500, noSpeechTimeoutMs: 3000 };
    let state = initVadState(0);
    let result = evaluateVadSample(state, 0.2, 0, config);
    state = result.state;

    result = evaluateVadSample(state, 0.01, 600, config);
    expect(result.decision).toBe("stop_silence");
  });

  it("a sample sitting exactly at the loudness threshold counts as speech", () => {
    const state = initVadState(0);
    const result = evaluateVadSample(state, DEFAULT_VAD_CONFIG.speechLevelThreshold, 0);
    expect(result.state.hasDetectedSpeech).toBe(true);
  });
});

describe("shouldAutoSubmitTranscript", () => {
  it("is true for a real, non-empty transcript", () => {
    expect(shouldAutoSubmitTranscript("Vreau să păstrez lungimea.")).toBe(true);
  });

  // Required: "transcript gol -> zero submit".
  it("is false for an empty or whitespace-only transcript", () => {
    expect(shouldAutoSubmitTranscript("")).toBe(false);
    expect(shouldAutoSubmitTranscript("   ")).toBe(false);
  });

  // Required: "STT eșuează -> zero submit" -- a failed transcription never
  // even produces a string to check (see finishRecording's onFailure path,
  // structurally separate from onSuccess), but this function is
  // defensively correct for null/undefined too, matching that guarantee.
  it("is false for null or undefined (no transcript at all, e.g. a failed transcription)", () => {
    expect(shouldAutoSubmitTranscript(null)).toBe(false);
    expect(shouldAutoSubmitTranscript(undefined)).toBe(false);
  });
});

describe("initVadState", () => {
  it("starts with no speech detected and no lastSpeechAt", () => {
    const state: VadState = initVadState(1234);
    expect(state).toEqual({ hasDetectedSpeech: false, lastSpeechAt: null, recordingStartedAt: 1234 });
  });
});
