import { describe, expect, it } from "vitest";

import {
  parseVoiceLatencyTelemetryPayload,
  terminalStageForOutcome,
  VOICE_LATENCY_TURN_OUTCOMES,
} from "./voice-latency-telemetry-logic";

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
    ttsPreProviderMs: 10,
    ttsUsageWriteMs: 300,
    ttsAudioProcessingMs: 5,
    ttsServerTotalMs: 415,
    ttsNetworkAndTransferMs: 35,
    audioPreparationMs: 20,
    timeToFirstAudioMs: 1900,
    voiceTurnTotalMs: 2100,
    timeToPlaybackCompleteMs: 2600,
    voiceTurnUnattributedMs: 84,
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
        ttsPreProviderMs: null,
        ttsUsageWriteMs: null,
        ttsAudioProcessingMs: null,
        ttsServerTotalMs: null,
        ttsNetworkAndTransferMs: null,
        audioPreparationMs: null,
        timeToFirstAudioMs: null,
        voiceTurnTotalMs: null,
        timeToPlaybackCompleteMs: null,
        voiceTurnUnattributedMs: null,
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
          ttsPreProviderMs: null,
          ttsUsageWriteMs: null,
          ttsAudioProcessingMs: null,
          ttsServerTotalMs: null,
          ttsNetworkAndTransferMs: null,
          audioPreparationMs: null,
          timeToFirstAudioMs: null,
          voiceTurnTotalMs: null,
          timeToPlaybackCompleteMs: null,
          voiceTurnUnattributedMs: null,
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

  // Production observability follow-up (2026-08-19): terminal diagnostics
  // for a failed/incomplete turn -- errorCode, providerAttemptCount,
  // elapsedSinceMicRequestMs -- all optional, all strictly validated.
  describe("terminal diagnostics (errorCode / providerAttemptCount / elapsedSinceMicRequestMs)", () => {
    it("accepts a valid errorCode matching this app's own existing code vocabularies", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
        errorCode: "PROVIDER_TIMEOUT",
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ errorCode: "PROVIDER_TIMEOUT" }) });
    });

    it("rejects an errorCode that isn't a safe, bounded identifier -- never a raw provider message or conversation fragment", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
        errorCode: "the client said her hair is falling out and I don't know what to do",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_error_code" });
    });

    it("accepts a valid providerAttemptCount (1 or 2, matching STT/Consult AI's own retry policy)", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        providerAttemptCount: 2,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ providerAttemptCount: 2 }) });
    });

    it("rejects an implausible providerAttemptCount (zero, negative, non-integer, or absurdly large)", () => {
      for (const bad of [0, -1, 1.5, 999]) {
        const result = parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "tts_completed",
          summary: validSummary(),
          providerAttemptCount: bad,
        });
        expect(result).toEqual({ ok: false, reason: "invalid_provider_attempt_count" });
      }
    });

    it("accepts a real elapsedSinceMicRequestMs, or null, but rejects an out-of-bounds or non-numeric value", () => {
      expect(
        parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "stt_failed",
          summary: validSummary(),
          elapsedSinceMicRequestMs: 4200,
        }),
      ).toEqual({ ok: true, value: expect.objectContaining({ elapsedSinceMicRequestMs: 4200 }) });

      expect(
        parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "stt_failed",
          summary: validSummary(),
          elapsedSinceMicRequestMs: null,
        }),
      ).toEqual({ ok: true, value: expect.objectContaining({ elapsedSinceMicRequestMs: null }) });

      expect(
        parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "stt_failed",
          summary: validSummary(),
          elapsedSinceMicRequestMs: -5,
        }),
      ).toEqual({ ok: false, reason: "invalid_elapsed_since_mic_request_ms" });
    });

    it("omits all three terminal-diagnostic fields entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("errorCode" in result.value).toBe(false);
        expect("providerAttemptCount" in result.value).toBe(false);
        expect("elapsedSinceMicRequestMs" in result.value).toBe(false);
      }
    });
  });

  // Round 8: the header-visibility diagnostic used to investigate why 5 TTS
  // timing fields read as null despite the server logging real values.
  describe("ttsResponseHeaders", () => {
    it("accepts a comma-separated list of real HTTP header names", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        ttsResponseHeaders: "Content-Type,X-Provider-Latency-Ms,X-Pre-Provider-Ms",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ ttsResponseHeaders: "Content-Type,X-Provider-Latency-Ms,X-Pre-Provider-Ms" }),
      });
    });

    it("accepts an empty string (a response with no readable headers at all)", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        ttsResponseHeaders: "",
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ ttsResponseHeaders: "" }) });
    });

    it("rejects anything outside real header-name characters -- never a raw string smuggled through", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        ttsResponseHeaders: "Content-Type; DROP TABLE users;",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_tts_response_headers" });
    });

    it("omits the field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect("ttsResponseHeaders" in result.value).toBe(false);
    });
  });

  // Round 9 (stale-client-bundle diagnosis): see next.config.ts's own doc
  // comment on resolveBuildCommitSha.
  describe("clientBuildSha", () => {
    it("accepts a real 40-char git SHA", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        clientBuildSha: "c491a32bede0dd2c4e94c18681314edd3373f047",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ clientBuildSha: "c491a32bede0dd2c4e94c18681314edd3373f047" }),
      });
    });

    it("accepts the 'unknown' fallback resolveBuildCommitSha returns when git was unavailable at build time", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        clientBuildSha: "unknown",
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ clientBuildSha: "unknown" }) });
    });

    it("rejects a non-hex, non-'unknown' value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        clientBuildSha: "not a real sha at all",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_client_build_sha" });
    });
  });

  // Round 11 (gemini-2.5-flash-lite STT evaluation): lets a real production
  // test be attributed to the STT model that actually ran, directly from
  // this one log line.
  describe("sttModel", () => {
    it("accepts a real Gemini model identifier", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        sttModel: "gemini-2.5-flash-lite",
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ sttModel: "gemini-2.5-flash-lite" }) });
    });

    it("rejects a value outside real model-identifier characters -- never a raw string smuggled through", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        sttModel: "gemini-2.5-flash-lite; DROP TABLE users;",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_model" });
    });

    it("omits the field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect("sttModel" in result.value).toBe(false);
    });
  });

  describe("terminalStageForOutcome", () => {
    it("maps every outcome to exactly one of the four real pipeline stages, matching where each outcome actually concludes", () => {
      expect(terminalStageForOutcome("stt_failed")).toBe("stt");
      expect(terminalStageForOutcome("stt_success_not_submitted")).toBe("stt");
      expect(terminalStageForOutcome("consultation_failed")).toBe("consultation");
      expect(terminalStageForOutcome("consultation_succeeded_no_voice_reply")).toBe("consultation");
      expect(terminalStageForOutcome("tts_unsupported_language")).toBe("tts");
      expect(terminalStageForOutcome("tts_failed")).toBe("tts");
      expect(terminalStageForOutcome("tts_fallback_local")).toBe("tts");
      expect(terminalStageForOutcome("tts_completed")).toBe("playback");
    });

    it("covers every declared outcome -- never throws or returns undefined for a real VOICE_LATENCY_TURN_OUTCOMES value", () => {
      for (const outcome of VOICE_LATENCY_TURN_OUTCOMES) {
        expect(terminalStageForOutcome(outcome)).toBeTruthy();
      }
    });
  });
});
