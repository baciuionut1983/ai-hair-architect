// Pure latency/success-rate statistics for TTS measurement work -- no I/O,
// no SDK imports. Same "pure logic, unit tested, no I/O" convention this
// directory already established for TTS: see tts-audio-format.ts (the
// reference for this exact pattern) for why keeping this file free of any
// provider/SDK types matters -- it makes these functions testable with
// plain arrays, no mocking, and safe to import from a standalone script
// without dragging in anything that talks to a network.
//
// The only current caller is scripts/tts-ab-latency-harness.ts (a
// dev-only, manually-run measurement tool -- see that file's own header
// comment for what it is and why it exists). This file itself has no
// awareness of that script, or of Gemini, or of any production route --
// it is deliberately just arithmetic over numbers/strings the caller
// already collected.

export interface LatencyStats {
  median: number;
  // null whenever there are fewer than 10 samples -- a 95th-percentile
  // value computed from a handful of samples would not be a real
  // percentile, it would be a guess wearing a percentile's name. Same
  // null-over-fabrication convention already established in this
  // directory: tts-audio-format.ts never invents a sample rate it wasn't
  // given, and voice-latency-logic.ts's computeVoiceLatencySummary never
  // invents a duration from a mark that was never recorded. This is that
  // same discipline applied to percentiles.
  p95: number | null;
  min: number;
  max: number;
  count: number;
}

export type LatencyOutcome = "success" | "failure";

// Below this many samples, p95 is reported as null rather than computed --
// see the LatencyStats.p95 doc comment above.
const MIN_SAMPLES_FOR_P95 = 10;

// median: the standard definition (average the two middle values for an
// even count). p95: nearest-rank method over the ascending-sorted samples
// -- sort ascending, take the value at index ceil(0.95 * n) - 1 -- only
// once there are at least MIN_SAMPLES_FOR_P95 samples to make that rank
// meaningful.
export function computeLatencyStats(samplesMs: number[]): { median: number; p95: number | null; min: number; max: number; count: number } {
  if (samplesMs.length === 0) {
    // A real Error, never fabricated zeros -- an empty input has no
    // latency to report, and a caller that got 0/0/0/0 back could easily
    // mistake that for "everything was instant" instead of "nothing was
    // ever measured".
    throw new Error("computeLatencyStats: samplesMs must not be empty -- refusing to fabricate stats from zero samples.");
  }

  const sorted = [...samplesMs].sort((a, b) => a - b);
  const count = sorted.length;
  const isEven = count % 2 === 0;
  const median = isEven ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2 : sorted[(count - 1) / 2];
  const p95 = count >= MIN_SAMPLES_FOR_P95 ? sorted[Math.ceil(0.95 * count) - 1] : null;

  return {
    median,
    p95,
    min: sorted[0],
    max: sorted[count - 1],
    count,
  };
}

// Fraction of `outcomes` equal to "success", as a 0..1 number (e.g. 0.5
// for a 50% success rate) -- deliberately not a percentage, since the
// caller (the harness's console report) decides its own display format.
export function computeSuccessRate(outcomes: LatencyOutcome[]): number {
  if (outcomes.length === 0) {
    // Same reasoning as computeLatencyStats above: an empty array has no
    // rate to report, and 0 would falsely read as "every call failed".
    throw new Error("computeSuccessRate: outcomes must not be empty -- refusing to fabricate a rate from zero outcomes.");
  }

  const successCount = outcomes.filter((outcome) => outcome === "success").length;
  return successCount / outcomes.length;
}
