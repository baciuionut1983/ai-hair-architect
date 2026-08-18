import { describe, expect, it } from "vitest";

import { parseVoiceLatencyTelemetryPayload, VOICE_LATENCY_TURN_OUTCOMES } from "./voice-latency-telemetry-logic";

function validSummary() {
  return {
    recordingFinalizeMs: 12,
    conversionMs: 34,
    sttNetworkAndServerMs: 200,
    sttProviderMs: 150,
    sttTotalMs: 350,
    consultationProviderMs: 900,
    consultationTotalMs: 1000,
    ttsProviderMs: 400,
    ttsTotalMs: 450,
    audioPreparationMs: 20,
    timeToFirstAudioMs: 1900,
    voiceTurnTotalMs: 2100,
  };
}

describe("parseVoiceLatencyTelemetryPayload", () => {
  it("accepts a fully-populated, valid payload", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "a1b2c3d4-0000-0000-0000-000000000000",
      outcome: "tts_completed",
      summary: validSummary(),
    });

    expect(result).toEqual({
      ok: true,
      value: {
        attemptId: "a1b2c3d4-0000-0000-0000-000000000000",
        outcome: "tts_completed",
        summary: validSummary(),
      },
    });
  });

  it("accepts the non-UUID fallback attemptId format (generateAttemptId's own fallback shape)", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1755500000000-abc123xyz",
      outcome: "stt_failed",
      summary: validSummary(),
    });
    expect(result.ok).toBe(true);
  });

  it("accepts null for any summary field -- never fabricates, never rejects a legitimately unmeasured stage", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "stt_failed",
      summary: {
        recordingFinalizeMs: null,
        conversionMs: null,
        sttNetworkAndServerMs: null,
        sttProviderMs: null,
        sttTotalMs: null,
        consultationProviderMs: null,
        consultationTotalMs: null,
        ttsProviderMs: null,
        ttsTotalMs: null,
        audioPreparationMs: null,
        timeToFirstAudioMs: null,
        voiceTurnTotalMs: null,
      },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: {
          recordingFinalizeMs: null,
          conversionMs: null,
          sttNetworkAndServerMs: null,
          sttProviderMs: null,
          sttTotalMs: null,
          consultationProviderMs: null,
          consultationTotalMs: null,
          ttsProviderMs: null,
          ttsTotalMs: null,
          audioPreparationMs: null,
          timeToFirstAudioMs: null,
          voiceTurnTotalMs: null,
        },
      },
    });
  });

  it("treats a missing summary field the same as an explicit null", () => {
    const { recordingFinalizeMs: _omit, ...rest } = validSummary();
    void _omit;
    const result = parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome: "tts_completed", summary: rest });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.recordingFinalizeMs).toBeNull();
    }
  });

  it("rounds a fractional duration to whole milliseconds, matching computeVoiceLatencySummary's own rounding", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), sttProviderMs: 123.7 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.sttProviderMs).toBe(124);
    }
  });

  it("every VOICE_LATENCY_TURN_OUTCOMES value is individually accepted", () => {
    for (const outcome of VOICE_LATENCY_TURN_OUTCOMES) {
      const result = parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome, summary: validSummary() });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects a non-object body", () => {
    expect(parseVoiceLatencyTelemetryPayload(null)).toEqual({ ok: false, reason: "not_an_object" });
    expect(parseVoiceLatencyTelemetryPayload("not json")).toEqual({ ok: false, reason: "not_an_object" });
    expect(parseVoiceLatencyTelemetryPayload(42)).toEqual({ ok: false, reason: "not_an_object" });
  });

  it("rejects a missing or malformed attemptId", () => {
    expect(parseVoiceLatencyTelemetryPayload({ outcome: "tts_completed", summary: validSummary() })).toEqual({
      ok: false,
      reason: "invalid_attempt_id",
    });
    expect(
      parseVoiceLatencyTelemetryPayload({ attemptId: "not valid!! spaces", outcome: "tts_completed", summary: validSummary() }),
    ).toEqual({ ok: false, reason: "invalid_attempt_id" });
    expect(parseVoiceLatencyTelemetryPayload({ attemptId: "a".repeat(101), outcome: "tts_completed", summary: validSummary() })).toEqual(
      { ok: false, reason: "invalid_attempt_id" },
    );
    expect(parseVoiceLatencyTelemetryPayload({ attemptId: "", outcome: "tts_completed", summary: validSummary() })).toEqual({
      ok: false,
      reason: "invalid_attempt_id",
    });
  });

  it("rejects a missing or out-of-enum outcome -- never a free-form string", () => {
    expect(parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", summary: validSummary() })).toEqual({
      ok: false,
      reason: "invalid_outcome",
    });
    expect(
      parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome: "made_up_outcome", summary: validSummary() }),
    ).toEqual({ ok: false, reason: "invalid_outcome" });
  });

  it("rejects a missing or non-object summary", () => {
    expect(parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome: "tts_completed" })).toEqual({
      ok: false,
      reason: "invalid_summary",
    });
    expect(parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome: "tts_completed", summary: "nope" })).toEqual({
      ok: false,
      reason: "invalid_summary",
    });
  });

  it("rejects a non-numeric summary field value -- e.g. a string smuggled in where a number is expected", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), sttProviderMs: "150" },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:sttProviderMs" });
  });

  it("rejects a negative summary field value", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), voiceTurnTotalMs: -1 },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:voiceTurnTotalMs" });
  });

  it("rejects an implausibly large summary field value (garbage/overflow), never blocking a real slow turn silently", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), voiceTurnTotalMs: 10 * 60 * 1000 },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:voiceTurnTotalMs" });
  });

  it("rejects NaN/Infinity even though typeof is 'number'", () => {
    expect(
      parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome: "tts_completed", summary: { ...validSummary(), sttTotalMs: NaN } }),
    ).toEqual({ ok: false, reason: "invalid_summary_field:sttTotalMs" });
    expect(
      parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: { ...validSummary(), sttTotalMs: Infinity },
      }),
    ).toEqual({ ok: false, reason: "invalid_summary_field:sttTotalMs" });
  });

  it("silently ignores unknown extra fields rather than rejecting the whole payload -- forward-compatible, not brittle", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), transcript: "this must never be accepted or echoed back", audioBase64: "AAAA" },
      extraTopLevelField: "ignored",
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("transcript");
    expect(JSON.stringify(result)).not.toContain("audioBase64");
  });
});
