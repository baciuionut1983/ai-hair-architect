import { describe, expect, it } from "vitest";

import {
  advanceSileroRecurrentState,
  buildSileroModelInput,
  createSileroRecurrentState,
  initSileroShadowDiagnostics,
  recordSileroFrameError,
  recordSileroFrameResult,
  SILERO_CONTEXT_SAMPLES,
  SILERO_DIAGNOSTIC_SPEECH_THRESHOLD,
  SILERO_FRAME_SAMPLES,
  SILERO_STATE_LENGTH,
  summarizeSileroShadowDiagnostics,
} from "./silero-vad-shadow-logic";

describe("createSileroRecurrentState", () => {
  it("starts with a zeroed [2,1,128] state and a zeroed 64-sample context, per the official reference implementation's own reset_states()", () => {
    const recurrent = createSileroRecurrentState();
    expect(recurrent.state.length).toBe(SILERO_STATE_LENGTH);
    expect(recurrent.context.length).toBe(SILERO_CONTEXT_SAMPLES);
    expect(Array.from(recurrent.state).every((v) => v === 0)).toBe(true);
    expect(Array.from(recurrent.context).every((v) => v === 0)).toBe(true);
  });
});

describe("buildSileroModelInput", () => {
  it("concatenates the carried context BEFORE the new frame, matching the official reference implementation's torch.cat([context, x]) exactly", () => {
    const recurrent = createSileroRecurrentState();
    recurrent.context.fill(7);
    const frame = new Float32Array(SILERO_FRAME_SAMPLES).fill(3);

    const combined = buildSileroModelInput(recurrent, frame);

    expect(combined.length).toBe(SILERO_CONTEXT_SAMPLES + SILERO_FRAME_SAMPLES);
    expect(Array.from(combined.slice(0, SILERO_CONTEXT_SAMPLES)).every((v) => v === 7)).toBe(true);
    expect(Array.from(combined.slice(SILERO_CONTEXT_SAMPLES)).every((v) => v === 3)).toBe(true);
  });

  it("throws on a wrongly-sized frame rather than silently padding/truncating -- a framing bug must fail loudly", () => {
    const recurrent = createSileroRecurrentState();
    const wrongFrame = new Float32Array(SILERO_FRAME_SAMPLES - 1);
    expect(() => buildSileroModelInput(recurrent, wrongFrame)).toThrow(/512/);
  });
});

describe("advanceSileroRecurrentState", () => {
  it("replaces the state wholesale with the model's own output (never merged), matching the reference implementation exactly", () => {
    const recurrent = createSileroRecurrentState();
    const frame = new Float32Array(SILERO_FRAME_SAMPLES).fill(1);
    const modelInput = buildSileroModelInput(recurrent, frame);
    const outputState = new Float32Array(SILERO_STATE_LENGTH).fill(0.5);

    const next = advanceSileroRecurrentState(modelInput, outputState);

    expect(next.state).toBe(outputState);
    expect(Array.from(next.state).every((v) => v === 0.5)).toBe(true);
  });

  it("carries forward the trailing 64 samples of the JUST-FED input tensor as the next call's context", () => {
    const recurrent = createSileroRecurrentState();
    const frame = new Float32Array(SILERO_FRAME_SAMPLES);
    // Make the frame's own tail distinguishable from its head.
    frame.fill(1);
    frame.fill(9, frame.length - SILERO_CONTEXT_SAMPLES);
    const modelInput = buildSileroModelInput(recurrent, frame);
    const outputState = new Float32Array(SILERO_STATE_LENGTH);

    const next = advanceSileroRecurrentState(modelInput, outputState);

    expect(next.context.length).toBe(SILERO_CONTEXT_SAMPLES);
    expect(Array.from(next.context).every((v) => v === 9)).toBe(true);
  });

  it("a SECOND frame's context is exactly what advanceSileroRecurrentState carried forward from the first -- proves the recurrence actually chains across calls", () => {
    let recurrent = createSileroRecurrentState();
    const firstFrame = new Float32Array(SILERO_FRAME_SAMPLES).fill(1);
    firstFrame.fill(4, firstFrame.length - SILERO_CONTEXT_SAMPLES);
    const firstInput = buildSileroModelInput(recurrent, firstFrame);
    recurrent = advanceSileroRecurrentState(firstInput, new Float32Array(SILERO_STATE_LENGTH));

    const secondFrame = new Float32Array(SILERO_FRAME_SAMPLES).fill(2);
    const secondInput = buildSileroModelInput(recurrent, secondFrame);

    expect(Array.from(secondInput.slice(0, SILERO_CONTEXT_SAMPLES)).every((v) => v === 4)).toBe(true);
    expect(Array.from(secondInput.slice(SILERO_CONTEXT_SAMPLES)).every((v) => v === 2)).toBe(true);
  });

  it("throws on a wrongly-shaped output state rather than silently accepting a corrupted recurrent state", () => {
    const recurrent = createSileroRecurrentState();
    const frame = new Float32Array(SILERO_FRAME_SAMPLES);
    const modelInput = buildSileroModelInput(recurrent, frame);
    const wrongState = new Float32Array(SILERO_STATE_LENGTH - 1);
    expect(() => advanceSileroRecurrentState(modelInput, wrongState)).toThrow(/256/);
  });
});

describe("Silero shadow diagnostics accumulator", () => {
  it("starts fully zeroed/null -- a fresh recording has no history", () => {
    const diagnostics = initSileroShadowDiagnostics();
    expect(diagnostics).toEqual({
      totalSampleCount: 0,
      speechQualifiedSampleCount: 0,
      peakSpeechProbability: 0,
      probabilitySum: 0,
      probabilitySumSquares: 0,
      peakInferenceMs: 0,
      inferenceMsSum: 0,
      errorCount: 0,
      lastError: null,
    });
  });

  it("counts a sample as speech-qualified only at/above SILERO_DIAGNOSTIC_SPEECH_THRESHOLD -- diagnostic-only, never a decision", () => {
    let diagnostics = initSileroShadowDiagnostics();
    diagnostics = recordSileroFrameResult(diagnostics, SILERO_DIAGNOSTIC_SPEECH_THRESHOLD - 0.01, 1);
    expect(diagnostics.speechQualifiedSampleCount).toBe(0);
    diagnostics = recordSileroFrameResult(diagnostics, SILERO_DIAGNOSTIC_SPEECH_THRESHOLD, 1);
    expect(diagnostics.speechQualifiedSampleCount).toBe(1);
  });

  it("tracks peak probability and peak inference time as running maxima across multiple frames", () => {
    let diagnostics = initSileroShadowDiagnostics();
    diagnostics = recordSileroFrameResult(diagnostics, 0.2, 3);
    diagnostics = recordSileroFrameResult(diagnostics, 0.9, 1);
    diagnostics = recordSileroFrameResult(diagnostics, 0.4, 7);
    expect(diagnostics.peakSpeechProbability).toBe(0.9);
    expect(diagnostics.peakInferenceMs).toBe(7);
    expect(diagnostics.totalSampleCount).toBe(3);
  });

  it("a failed frame increments errorCount and records lastError, WITHOUT touching any probability/timing accumulator -- a run of errors can never be misread as confident silence", () => {
    let diagnostics = initSileroShadowDiagnostics();
    diagnostics = recordSileroFrameResult(diagnostics, 0.7, 2);
    const beforeError = { ...diagnostics };
    diagnostics = recordSileroFrameError(diagnostics, "session.run failed: shape mismatch");

    expect(diagnostics.errorCount).toBe(1);
    expect(diagnostics.lastError).toBe("session.run failed: shape mismatch");
    // Every prior accumulator is untouched.
    expect(diagnostics.totalSampleCount).toBe(beforeError.totalSampleCount);
    expect(diagnostics.peakSpeechProbability).toBe(beforeError.peakSpeechProbability);
    expect(diagnostics.probabilitySum).toBe(beforeError.probabilitySum);
    expect(diagnostics.peakInferenceMs).toBe(beforeError.peakInferenceMs);
  });

  it("lastError reflects the MOST RECENT error, not the first", () => {
    let diagnostics = initSileroShadowDiagnostics();
    diagnostics = recordSileroFrameError(diagnostics, "first error");
    diagnostics = recordSileroFrameError(diagnostics, "second error");
    expect(diagnostics.errorCount).toBe(2);
    expect(diagnostics.lastError).toBe("second error");
  });
});

describe("summarizeSileroShadowDiagnostics", () => {
  it("never fabricates a mean/stddev/mean-inference from zero samples -- null, not 0 or NaN", () => {
    const summary = summarizeSileroShadowDiagnostics(initSileroShadowDiagnostics());
    expect(summary.meanSpeechProbability).toBeNull();
    expect(summary.speechProbabilityStdDev).toBeNull();
    expect(summary.meanInferenceMs).toBeNull();
    expect(summary.totalSampleCount).toBe(0);
    expect(summary.peakSpeechProbability).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(summary.lastError).toBeNull();
  });

  it("computes a real mean and stddev from a genuine, hand-checkable sample set", () => {
    let diagnostics = initSileroShadowDiagnostics();
    // [0.2, 0.4, 0.6, 0.8] -- mean 0.5, population variance 0.05, stddev ~0.2236.
    for (const probability of [0.2, 0.4, 0.6, 0.8]) {
      diagnostics = recordSileroFrameResult(diagnostics, probability, 2);
    }
    const summary = summarizeSileroShadowDiagnostics(diagnostics);
    expect(summary.totalSampleCount).toBe(4);
    expect(summary.meanSpeechProbability).toBeCloseTo(0.5, 10);
    expect(summary.speechProbabilityStdDev).toBeCloseTo(Math.sqrt(0.05), 10);
    expect(summary.meanInferenceMs).toBe(2);
    expect(summary.peakInferenceMs).toBe(2);
  });

  it("a constant probability stream has zero variance -- the same shape a sustained musical tone would produce on this metric", () => {
    let diagnostics = initSileroShadowDiagnostics();
    for (let i = 0; i < 10; i += 1) {
      diagnostics = recordSileroFrameResult(diagnostics, 0.9, 1);
    }
    const summary = summarizeSileroShadowDiagnostics(diagnostics);
    expect(summary.speechProbabilityStdDev).toBeCloseTo(0, 10);
    expect(summary.meanSpeechProbability).toBeCloseTo(0.9, 10);
  });

  it("carries the accumulated error count/lastError straight through, unaffected by whether any successful samples also exist", () => {
    let diagnostics = initSileroShadowDiagnostics();
    diagnostics = recordSileroFrameResult(diagnostics, 0.5, 1);
    diagnostics = recordSileroFrameError(diagnostics, "boom");
    const summary = summarizeSileroShadowDiagnostics(diagnostics);
    expect(summary.errorCount).toBe(1);
    expect(summary.lastError).toBe("boom");
    // The one successful sample is still honestly reflected.
    expect(summary.totalSampleCount).toBe(1);
  });
});
