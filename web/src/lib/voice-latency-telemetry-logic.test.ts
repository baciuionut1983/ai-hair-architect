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
    consultationPreProviderMs: 15,
    consultationReplyWriteMs: 60,
    consultationFailedFirstAttemptMs: 0,
    consultationServerTotalMs: 975,
    consultationUnattributedMs: 0,
    consultationNetworkAndTransferMs: 25,
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
    // Streaming Voice Reply candidate mode (2026-08-26, DEFAULT OFF): the
    // default, non-streaming shape -- every existing test in this file
    // that reuses validSummary() as-is is exercising a full-WAV turn,
    // exactly like before this round.
    ttsDeliveryMode: null,
    ttsChunkCount: null,
    ttsFirstChunkProviderMs: null,
    ttsFirstPlayableChunkMs: null,
    ttsFirstPlaybackStartedMs: null,
    ttsFallbackToFullUsed: false,
    ttsFallbackReason: null,
    ttsPlaybackGapMaxMs: null,
    ttsAudioTimelineGapMaxMs: null,
    ttsStreamingCompleted: null,
    ttsStreamingError: null,
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
        consultationPreProviderMs: null,
        consultationReplyWriteMs: null,
        consultationFailedFirstAttemptMs: null,
        consultationServerTotalMs: null,
        consultationUnattributedMs: null,
        consultationNetworkAndTransferMs: null,
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
        ttsDeliveryMode: null,
        ttsChunkCount: null,
        ttsFirstChunkProviderMs: null,
        ttsFirstPlayableChunkMs: null,
        ttsFirstPlaybackStartedMs: null,
        ttsFallbackToFullUsed: false,
        ttsFallbackReason: null,
        ttsPlaybackGapMaxMs: null,
        ttsAudioTimelineGapMaxMs: null,
        ttsStreamingCompleted: null,
        ttsStreamingError: null,
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
          consultationPreProviderMs: null,
          consultationReplyWriteMs: null,
          consultationFailedFirstAttemptMs: null,
          consultationServerTotalMs: null,
          consultationUnattributedMs: null,
          consultationNetworkAndTransferMs: null,
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
          ttsDeliveryMode: null,
          ttsChunkCount: null,
          ttsFirstChunkProviderMs: null,
          ttsFirstPlayableChunkMs: null,
          ttsFirstPlaybackStartedMs: null,
          ttsFallbackToFullUsed: false,
          ttsFallbackReason: null,
          ttsPlaybackGapMaxMs: null,
          ttsAudioTimelineGapMaxMs: null,
          ttsStreamingCompleted: null,
          ttsStreamingError: null,
        },
      },
    });
  });

  // Streaming Voice Reply candidate mode (2026-08-26, DEFAULT OFF): proves
  // the new fields are actually threaded through (not silently dropped by
  // the summary allow-list -- see voice-latency-telemetry-logic.ts's own
  // VoiceLatencyStreamingSummaryFields doc comment for why these needed
  // their own, separately-typed validation).
  it("accepts and threads through real streaming Voice Reply summary field values", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: {
        ...validSummary(),
        ttsDeliveryMode: "streaming",
        ttsChunkCount: 12,
        ttsFirstChunkProviderMs: 110,
        ttsFirstPlayableChunkMs: 125,
        ttsFirstPlaybackStartedMs: 140,
        ttsFallbackToFullUsed: false,
        ttsFallbackReason: null,
        ttsPlaybackGapMaxMs: 18,
        ttsAudioTimelineGapMaxMs: 22,
        ttsStreamingCompleted: true,
        ttsStreamingError: null,
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: {
          ...validSummary(),
          ttsDeliveryMode: "streaming",
          ttsChunkCount: 12,
          ttsFirstChunkProviderMs: 110,
          ttsFirstPlayableChunkMs: 125,
          ttsFirstPlaybackStartedMs: 140,
          ttsFallbackToFullUsed: false,
          ttsFallbackReason: null,
          ttsPlaybackGapMaxMs: 18,
          ttsAudioTimelineGapMaxMs: 22,
          ttsStreamingCompleted: true,
          ttsStreamingError: null,
        },
      },
    });
  });

  it("accepts ttsFallbackToFullUsed: true with a real ttsFallbackReason", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsFallbackToFullUsed: true, ttsFallbackReason: "not_configured" },
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        summary: expect.objectContaining({ ttsFallbackToFullUsed: true, ttsFallbackReason: "not_configured" }),
      }),
    });
  });

  it("rejects an invalid ttsDeliveryMode value -- a fixed enum, never a free-form string", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsDeliveryMode: "made_up_mode" },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:ttsDeliveryMode" });
  });

  it("rejects a non-boolean ttsFallbackToFullUsed", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsFallbackToFullUsed: "true" },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:ttsFallbackToFullUsed" });
  });

  it("rejects an implausibly large ttsChunkCount (garbage/overflow), never blocking a real long reply silently", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsChunkCount: 1_000_000 },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:ttsChunkCount" });
  });

  // REAL AudioContext-timeline gap measurement (2026-08-26, ADDITIVE): same
  // validation family (parseNullableStreamingDurationField) as
  // ttsFirstChunkProviderMs/ttsFirstPlayableChunkMs/ttsFirstPlaybackStartedMs/
  // ttsPlaybackGapMaxMs -- these prove it's wired into the exact same
  // strict validation, not merely passed through unchecked.
  it("accepts a real, non-negative ttsAudioTimelineGapMaxMs and rounds a fractional value", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsAudioTimelineGapMaxMs: 150.4 },
    });
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ summary: expect.objectContaining({ ttsAudioTimelineGapMaxMs: 150 }) }) });
  });

  it("rejects a negative ttsAudioTimelineGapMaxMs", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsAudioTimelineGapMaxMs: -1 },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:ttsAudioTimelineGapMaxMs" });
  });

  it("rejects a non-numeric ttsAudioTimelineGapMaxMs", () => {
    const result = parseVoiceLatencyTelemetryPayload({
      attemptId: "attempt-1",
      outcome: "tts_completed",
      summary: { ...validSummary(), ttsAudioTimelineGapMaxMs: "150" },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_summary_field:ttsAudioTimelineGapMaxMs" });
  });

  it("treats a missing ttsAudioTimelineGapMaxMs the same as an explicit null (never fabricated)", () => {
    const { ttsAudioTimelineGapMaxMs: _omit, ...rest } = validSummary();
    void _omit;
    const result = parseVoiceLatencyTelemetryPayload({ attemptId: "attempt-1", outcome: "tts_completed", summary: rest });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary.ttsAudioTimelineGapMaxMs).toBeNull();
    }
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

  // End-of-speech hardening (2026-08-20): the end-to-end telemetry for the
  // production VAD/background-music fix -- see voice-activity-logic.ts's
  // own VoiceActivityDiagnostics doc comments for what each field means.
  describe("VAD diagnostics (vadAutoStopReason / vadRecordingDurationMs / etc.)", () => {
    it("accepts a fully-populated set of VAD diagnostic fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadAutoStopReason: "stop_silence",
        vadRecordingDurationMs: 4500,
        vadSpeechDurationMs: 2200,
        vadSilenceAfterSpeechMs: 2000,
        vadSpeechDetectedAtMs: 300,
        vadSpeechEndedAtMs: 2500,
        vadMaxDurationTriggered: false,
        vadMode: "heuristic-rms-spectral-v1",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadAutoStopReason: "stop_silence",
          vadRecordingDurationMs: 4500,
          vadSpeechDurationMs: 2200,
          vadSilenceAfterSpeechMs: 2000,
          vadSpeechDetectedAtMs: 300,
          vadSpeechEndedAtMs: 2500,
          vadMaxDurationTriggered: false,
          vadMode: "heuristic-rms-spectral-v1",
        }),
      });
    });

    it("accepts every real VoiceActivityAutoStopReason value, including manual_stop", () => {
      for (const reason of ["stop_silence", "stop_no_speech_timeout", "stop_max_duration", "manual_stop"]) {
        const result = parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "tts_completed",
          summary: validSummary(),
          vadAutoStopReason: reason,
        });
        expect(result).toEqual({ ok: true, value: expect.objectContaining({ vadAutoStopReason: reason }) });
      }
    });

    it("rejects a vadAutoStopReason outside the fixed enum -- never a free-form string", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadAutoStopReason: "the music was too loud",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_auto_stop_reason" });
    });

    it("rejects a negative or implausibly large vad*Ms field", () => {
      expect(
        parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "tts_completed",
          summary: validSummary(),
          vadRecordingDurationMs: -5,
        }),
      ).toEqual({ ok: false, reason: "invalid_vad_recording_duration_ms" });

      expect(
        parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "tts_completed",
          summary: validSummary(),
          vadSpeechDurationMs: 99_999_999,
        }),
      ).toEqual({ ok: false, reason: "invalid_vad_speech_duration_ms" });
    });

    it("rejects a non-boolean vadMaxDurationTriggered", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadMaxDurationTriggered: "yes",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_max_duration_triggered" });
    });

    it("rejects a vadMode outside safe identifier characters", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadMode: "not a real mode; DROP TABLE users;",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_mode" });
    });

    it("omits every VAD field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadAutoStopReason",
          "vadRecordingDurationMs",
          "vadSpeechDurationMs",
          "vadSilenceAfterSpeechMs",
          "vadSpeechDetectedAtMs",
          "vadSpeechEndedAtMs",
          "vadMaxDurationTriggered",
          "vadMode",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD false-negative hardening (2026-08-21): lets a real production
  // no-speech-timeout false negative be diagnosed directly from this one
  // log line -- see voice-activity-logic.ts's own VoiceActivityDiagnostics
  // doc comments for exactly what each answers.
  describe("VAD diagnostic accumulators (vadPeakRms / vadPeakSpeechBandRatio / vadFinalNoiseFloor / vadMaxCandidateSpeechMs / vadCandidateResetCount / vadFullyQualifiedSampleCount)", () => {
    it("accepts a fully-populated set of these fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadPeakRms: 0.18,
        vadPeakSpeechBandRatio: 0.41,
        vadFinalNoiseFloor: 0.025,
        vadMaxCandidateSpeechMs: 210,
        vadCandidateResetCount: 4,
        vadFullyQualifiedSampleCount: 9,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadPeakRms: 0.18,
          vadPeakSpeechBandRatio: 0.41,
          vadFinalNoiseFloor: 0.025,
          vadMaxCandidateSpeechMs: 210,
          vadCandidateResetCount: 4,
          vadFullyQualifiedSampleCount: 9,
        }),
      });
    });

    it("accepts zero for every field -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadPeakRms: 0,
        vadCandidateResetCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadPeakRms: 0, vadCandidateResetCount: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadPeakRms: -0.1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_peak_rms" });
    });

    it("rejects a vadPeakSpeechBandRatio outside its real 0..1 range", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadPeakSpeechBandRatio: 1.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_peak_speech_band_ratio" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadCandidateResetCount: 2.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_candidate_reset_count" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadPeakRms",
          "vadPeakSpeechBandRatio",
          "vadFinalNoiseFloor",
          "vadMaxCandidateSpeechMs",
          "vadCandidateResetCount",
          "vadFullyQualifiedSampleCount",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD false-negative hardening, ROUND 2 (2026-08-22): the real
  // production retest of cb0d66c showed the round-1 telemetry alone
  // couldn't distinguish WHICH gate rejected the remaining real-speech
  // samples -- these 5 fields reconstruct the full amplitude/spectral/
  // alignment breakdown. See voice-activity-logic.ts's own ROUND 2
  // VoiceActivityDiagnostics doc comments for exactly what each answers.
  describe("VAD ROUND 2 diagnostic accumulators (vadTotalSampleCount / vadAmplitudeQualifiedSampleCount / vadSpectralQualifiedSampleCount / vadLongestCandidateGapMs / vadPeakNoiseFloor)", () => {
    it("accepts a fully-populated set of these fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadTotalSampleCount: 100,
        vadAmplitudeQualifiedSampleCount: 60,
        vadSpectralQualifiedSampleCount: 15,
        vadLongestCandidateGapMs: 3000,
        vadPeakNoiseFloor: 0.03,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadTotalSampleCount: 100,
          vadAmplitudeQualifiedSampleCount: 60,
          vadSpectralQualifiedSampleCount: 15,
          vadLongestCandidateGapMs: 3000,
          vadPeakNoiseFloor: 0.03,
        }),
      });
    });

    it("accepts zero for every field -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadTotalSampleCount: 0,
        vadLongestCandidateGapMs: 0,
        vadPeakNoiseFloor: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadTotalSampleCount: 0, vadLongestCandidateGapMs: 0, vadPeakNoiseFloor: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadSpectralQualifiedSampleCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_spectral_qualified_sample_count" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadAmplitudeQualifiedSampleCount: 12.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_amplitude_qualified_sample_count" });
    });

    it("rejects an implausible vadPeakNoiseFloor -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadPeakNoiseFloor: 50,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_peak_noise_floor" });
    });

    it("rejects an implausible vadLongestCandidateGapMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadLongestCandidateGapMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_longest_candidate_gap_ms" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadTotalSampleCount",
          "vadAmplitudeQualifiedSampleCount",
          "vadSpectralQualifiedSampleCount",
          "vadLongestCandidateGapMs",
          "vadPeakNoiseFloor",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD false-negative hardening, ROUND 4 (2026-08-22): a third real
  // production recording showed the same shape as rounds 2/3 (healthy
  // individual-gate rates, near-zero same-sample overlap), motivating the
  // windowed-evidence confirmation model -- see voice-activity-logic.ts's
  // own ROUND 4 VoiceActivityDiagnostics doc comment for what this field
  // answers.
  describe("VAD ROUND 4 diagnostic accumulator (vadWindowedCandidateSampleCount)", () => {
    it("accepts a real value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadWindowedCandidateSampleCount: 42,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadWindowedCandidateSampleCount: 42 }),
      });
    });

    it("accepts zero -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadWindowedCandidateSampleCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadWindowedCandidateSampleCount: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadWindowedCandidateSampleCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_windowed_candidate_sample_count" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        vadWindowedCandidateSampleCount: 12.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_windowed_candidate_sample_count" });
    });

    it("omits the field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("vadWindowedCandidateSampleCount" in result.value).toBe(false);
      }
    });
  });

  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): a real production
  // report (user's own ground truth: "the microphone stopped while I was
  // still speaking") proved a false POSITIVE end-of-speech -- CONTINUATION
  // (once speech is already confirmed) needed a weaker evidence rule than
  // START. See voice-activity-logic.ts's own ROUND 6 VoiceActivityDiagnostics
  // doc comments for exactly what each of these answers.
  describe("VAD ROUND 6 diagnostic accumulators (vadPostConfirmationSampleCount / vadContinuationQualifiedSampleCount / vadContinuationSpectralOnlySampleCount / vadContinuationAmplitudeOnlySampleCount / vadLongestPostConfirmationGapMs / vadLastStrongEvidenceAgeAtStopMs)", () => {
    it("accepts a fully-populated set of these fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPostConfirmationSampleCount: 30,
        vadContinuationQualifiedSampleCount: 22,
        vadContinuationSpectralOnlySampleCount: 6,
        vadContinuationAmplitudeOnlySampleCount: 4,
        vadLongestPostConfirmationGapMs: 400,
        vadLastStrongEvidenceAgeAtStopMs: 1500,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadPostConfirmationSampleCount: 30,
          vadContinuationQualifiedSampleCount: 22,
          vadContinuationSpectralOnlySampleCount: 6,
          vadContinuationAmplitudeOnlySampleCount: 4,
          vadLongestPostConfirmationGapMs: 400,
          vadLastStrongEvidenceAgeAtStopMs: 1500,
        }),
      });
    });

    it("accepts zero for every field -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPostConfirmationSampleCount: 0,
        vadLongestPostConfirmationGapMs: 0,
        vadLastStrongEvidenceAgeAtStopMs: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadPostConfirmationSampleCount: 0,
          vadLongestPostConfirmationGapMs: 0,
          vadLastStrongEvidenceAgeAtStopMs: 0,
        }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationSpectralOnlySampleCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_spectral_only_sample_count" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationAmplitudeOnlySampleCount: 3.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_amplitude_only_sample_count" });
    });

    it("rejects an implausible vadLongestPostConfirmationGapMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLongestPostConfirmationGapMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_longest_post_confirmation_gap_ms" });
    });

    it("rejects an implausible vadLastStrongEvidenceAgeAtStopMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLastStrongEvidenceAgeAtStopMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_last_strong_evidence_age_at_stop_ms" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadPostConfirmationSampleCount",
          "vadContinuationQualifiedSampleCount",
          "vadContinuationSpectralOnlySampleCount",
          "vadContinuationAmplitudeOnlySampleCount",
          "vadLongestPostConfirmationGapMs",
          "vadLastStrongEvidenceAgeAtStopMs",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD start-detection hardening, ROUND 7 (2026-08-22): a real production
  // test with background noise present showed START itself never
  // confirming (spectralQualifiedSampleCount 3/100 despite a healthy
  // amplitudeQualifiedSampleCount 30/100) -- see voice-activity-logic.ts's
  // own ROUND 7 VoiceActivityDiagnostics doc comments for what each of
  // these answers.
  describe("VAD ROUND 7 diagnostic accumulators (vadAmbientSpectralRatioEstimate / vadPeakAmbientSpectralRatioEstimate / vadSpectralLiftQualifiedSampleCount)", () => {
    it("accepts a fully-populated set of these fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadAmbientSpectralRatioEstimate: 0.24,
        vadPeakAmbientSpectralRatioEstimate: 0.26,
        vadSpectralLiftQualifiedSampleCount: 9,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadAmbientSpectralRatioEstimate: 0.24,
          vadPeakAmbientSpectralRatioEstimate: 0.26,
          vadSpectralLiftQualifiedSampleCount: 9,
        }),
      });
    });

    it("accepts zero for every field -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadAmbientSpectralRatioEstimate: 0,
        vadSpectralLiftQualifiedSampleCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadAmbientSpectralRatioEstimate: 0, vadSpectralLiftQualifiedSampleCount: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadSpectralLiftQualifiedSampleCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_spectral_lift_qualified_sample_count" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadSpectralLiftQualifiedSampleCount: 4.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_spectral_lift_qualified_sample_count" });
    });

    it("rejects a vadAmbientSpectralRatioEstimate outside its real 0..1 range", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadAmbientSpectralRatioEstimate: 1.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_ambient_spectral_ratio_estimate" });
    });

    it("rejects a vadPeakAmbientSpectralRatioEstimate outside its real 0..1 range", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPeakAmbientSpectralRatioEstimate: -0.1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_peak_ambient_spectral_ratio_estimate" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of ["vadAmbientSpectralRatioEstimate", "vadPeakAmbientSpectralRatioEstimate", "vadSpectralLiftQualifiedSampleCount"]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD start-detection hardening, ROUND 8 (2026-08-22): a real production
  // test with instrumental music and no voice at all produced a false
  // positive at aggregate rates indistinguishable from genuine speech --
  // see voice-activity-logic.ts's own ROUND 8 VoiceActivityDiagnostics
  // doc comments for the temporal-continuity hypothesis these
  // diagnostic-only fields test.
  describe("VAD ROUND 8 diagnostic accumulators (vadLongestSpectralQualifiedRunMs / vadSpectralQualifiedRunCount / vadLongestFullyQualifiedRunMs / vadFullyQualifiedRunCount)", () => {
    it("accepts a fully-populated set of these fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLongestSpectralQualifiedRunMs: 5800,
        vadSpectralQualifiedRunCount: 1,
        vadLongestFullyQualifiedRunMs: 400,
        vadFullyQualifiedRunCount: 6,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadLongestSpectralQualifiedRunMs: 5800,
          vadSpectralQualifiedRunCount: 1,
          vadLongestFullyQualifiedRunMs: 400,
          vadFullyQualifiedRunCount: 6,
        }),
      });
    });

    it("accepts zero for every field -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLongestSpectralQualifiedRunMs: 0,
        vadSpectralQualifiedRunCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadLongestSpectralQualifiedRunMs: 0, vadSpectralQualifiedRunCount: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadFullyQualifiedRunCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_fully_qualified_run_count" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadSpectralQualifiedRunCount: 3.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_spectral_qualified_run_count" });
    });

    it("rejects an implausible vadLongestSpectralQualifiedRunMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLongestSpectralQualifiedRunMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_longest_spectral_qualified_run_ms" });
    });

    it("rejects an implausible vadLongestFullyQualifiedRunMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLongestFullyQualifiedRunMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_longest_fully_qualified_run_ms" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadLongestSpectralQualifiedRunMs",
          "vadSpectralQualifiedRunCount",
          "vadLongestFullyQualifiedRunMs",
          "vadFullyQualifiedRunCount",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  describe("VAD ROUND 9 diagnostic accumulator (vadPeakStreakSpectralHitCount)", () => {
    it("accepts a real value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPeakStreakSpectralHitCount: 1,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadPeakStreakSpectralHitCount: 1 }),
      });
    });

    it("accepts zero -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPeakStreakSpectralHitCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ vadPeakStreakSpectralHitCount: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPeakStreakSpectralHitCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_peak_streak_spectral_hit_count" });
    });

    it("rejects a non-integer count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadPeakStreakSpectralHitCount: 1.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_peak_streak_spectral_hit_count" });
    });

    it("omits the field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("vadPeakStreakSpectralHitCount" in result.value).toBe(false);
      }
    });
  });

  // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: see
  // voice-latency-logic.ts's own VoiceLatencyTerminalDiagnostics doc
  // comment for what each field answers. STRICT SHADOW MODE --
  // diagnostic-only telemetry, never a decision.
  describe("VAD ROUND 10 Silero shadow mode diagnostics", () => {
    it("accepts a fully-populated, real-shaped payload", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelAvailable: true,
        vadModelName: "silero-vad",
        vadModelVersion: "v5",
        vadModelLoadMs: 420,
        vadModelPeakSpeechProbability: 0.97,
        vadModelMeanSpeechProbability: 0.61,
        vadModelSpeechQualifiedSampleCount: 40,
        vadModelTotalSampleCount: 75,
        vadModelInferencePeakMs: 6,
        vadModelInferenceMeanMs: 2,
        vadModelSpeechProbabilityStdDev: 0.22,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadModelAvailable: true,
          vadModelName: "silero-vad",
          vadModelVersion: "v5",
          vadModelLoadMs: 420,
          vadModelPeakSpeechProbability: 0.97,
          vadModelMeanSpeechProbability: 0.61,
          vadModelSpeechQualifiedSampleCount: 40,
          vadModelTotalSampleCount: 75,
          vadModelInferencePeakMs: 6,
          vadModelInferenceMeanMs: 2,
          vadModelSpeechProbabilityStdDev: 0.22,
        }),
      });
    });

    it("accepts vadModelAvailable: false with a vadModelError -- the honest 'shadow mode failed to load' shape", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelAvailable: false,
        vadModelError: "AudioContext is not available in this browser.",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadModelAvailable: false,
          vadModelError: "AudioContext is not available in this browser.",
        }),
      });
    });

    it("accepts zero for every numeric field -- a truthful 'never observed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelLoadMs: 0,
        vadModelPeakSpeechProbability: 0,
        vadModelSpeechQualifiedSampleCount: 0,
        vadModelTotalSampleCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadModelLoadMs: 0,
          vadModelPeakSpeechProbability: 0,
          vadModelSpeechQualifiedSampleCount: 0,
          vadModelTotalSampleCount: 0,
        }),
      });
    });

    it("rejects a non-boolean vadModelAvailable", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelAvailable: "yes",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_available" });
    });

    it("rejects a probability above 1", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPeakSpeechProbability: 1.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_peak_speech_probability" });
    });

    it("rejects a negative sample count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelTotalSampleCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_total_sample_count" });
    });

    it("rejects an unsafe vadModelError string (e.g. embedded newlines/control characters)", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelError: "line one\nline two",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_error" });
    });

    it("rejects an implausible vadModelLoadMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelLoadMs: 60 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_load_ms" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadModelAvailable",
          "vadModelName",
          "vadModelVersion",
          "vadModelLoadMs",
          "vadModelPeakSpeechProbability",
          "vadModelMeanSpeechProbability",
          "vadModelSpeechQualifiedSampleCount",
          "vadModelTotalSampleCount",
          "vadModelInferencePeakMs",
          "vadModelInferenceMeanMs",
          "vadModelSpeechProbabilityStdDev",
          "vadModelError",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD Round 11 (2026-08-23), Phase B: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  describe("VAD ROUND 11 Silero START gate fields", () => {
    it("accepts a fully-populated, real-shaped 'silero confirmed' payload", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateMode: "silero",
        vadStartGateModelThreshold: 0.5,
        vadStartGateModelQualifiedFrames: 9,
        vadStartGateModelConfirmedAtMs: 288,
        vadStartGateFallbackUsed: false,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadStartGateMode: "silero",
          vadStartGateModelThreshold: 0.5,
          vadStartGateModelQualifiedFrames: 9,
          vadStartGateModelConfirmedAtMs: 288,
          vadStartGateFallbackUsed: false,
        }),
      });
    });

    it("accepts a fully-populated 'fallback used' payload", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateMode: "silero",
        vadStartGateFallbackUsed: true,
        vadStartGateFallbackReason: "model_loading",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadStartGateMode: "silero",
          vadStartGateFallbackUsed: true,
          vadStartGateFallbackReason: "model_loading",
        }),
      });
    });

    it("accepts vadStartGateMode: 'legacy' (the flag-off default)", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateMode: "legacy",
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ vadStartGateMode: "legacy" }) });
    });

    it("rejects an unknown vadStartGateMode value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateMode: "hybrid",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_start_gate_mode" });
    });

    it("rejects an unknown vadStartGateFallbackReason value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateFallbackReason: "network_error",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_start_gate_fallback_reason" });
    });

    it("rejects a threshold above 1", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateModelThreshold: 1.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_start_gate_model_threshold" });
    });

    it("rejects a negative qualified-frame count", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateModelQualifiedFrames: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_start_gate_model_qualified_frames" });
    });

    it("rejects a non-boolean vadStartGateFallbackUsed", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadStartGateFallbackUsed: "yes",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_start_gate_fallback_used" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadStartGateMode",
          "vadStartGateModelThreshold",
          "vadStartGateModelQualifiedFrames",
          "vadStartGateModelConfirmedAtMs",
          "vadStartGateFallbackUsed",
          "vadStartGateFallbackReason",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD Round 12 (2026-08-23): see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers --
  // a real production report proved a no-speech recording (radio/music,
  // START correctly never confirmed) still reached STT; these fields let
  // the skip be reported honestly, distinct from "stt_failed".
  describe("VAD ROUND 12 STT-skip fields (sttSkipped/sttSkipReason)", () => {
    it("accepts the real 'skipped, no confirmed speech' shape", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_skipped_no_speech",
        summary: validSummary(),
        sttSkipped: true,
        sttSkipReason: "no_confirmed_speech",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ sttSkipped: true, sttSkipReason: "no_confirmed_speech" }),
      });
    });

    it("accepts sttSkipped: false explicitly (a truthful 'this turn was NOT skipped')", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        sttSkipped: false,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ sttSkipped: false }) });
    });

    it("rejects a non-boolean sttSkipped", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_skipped_no_speech",
        summary: validSummary(),
        sttSkipped: "yes",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_skipped" });
    });

    it("rejects an unknown sttSkipReason value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_skipped_no_speech",
        summary: validSummary(),
        sttSkipReason: "user_cancelled",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_skip_reason" });
    });

    it("omits both fields entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect("sttSkipped" in result.value).toBe(false);
        expect("sttSkipReason" in result.value).toBe(false);
      }
    });

    it("accepts the new stt_skipped_no_speech outcome and maps it to the 'stt' terminal stage", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_skipped_no_speech",
        summary: validSummary(),
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ outcome: "stt_skipped_no_speech" }) });
      expect(terminalStageForOutcome("stt_skipped_no_speech")).toBe("stt");
    });
  });

  // VAD Round 13 (2026-08-24), Phase B.2: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  describe("VAD ROUND 13 Silero preload fields", () => {
    it("accepts the real 'preloaded, ready before mic press' shape", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPreloadAttempted: true,
        vadModelPreloadCompleted: true,
        vadModelPreloadMs: 1120,
        vadModelWasPreloadedAtRecordingStart: true,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadModelPreloadAttempted: true,
          vadModelPreloadCompleted: true,
          vadModelPreloadMs: 1120,
          vadModelWasPreloadedAtRecordingStart: true,
        }),
      });
    });

    it("accepts the 'preload attempted but recording started first' shape (fallback still engaged)", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPreloadAttempted: true,
        vadModelPreloadCompleted: false,
        vadModelWasPreloadedAtRecordingStart: false,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadModelPreloadAttempted: true,
          vadModelPreloadCompleted: false,
          vadModelWasPreloadedAtRecordingStart: false,
        }),
      });
    });

    it("rejects a non-boolean vadModelPreloadAttempted", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPreloadAttempted: "yes",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_preload_attempted" });
    });

    it("rejects a non-boolean vadModelPreloadCompleted", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPreloadCompleted: 1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_preload_completed" });
    });

    it("rejects a non-boolean vadModelWasPreloadedAtRecordingStart", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelWasPreloadedAtRecordingStart: "true",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_was_preloaded_at_recording_start" });
    });

    it("rejects an implausible vadModelPreloadMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPreloadMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_model_preload_ms" });
    });

    it("accepts zero for vadModelPreloadMs -- a truthful 'instant', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadModelPreloadMs: 0,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ vadModelPreloadMs: 0 }) });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadModelPreloadAttempted",
          "vadModelPreloadCompleted",
          "vadModelPreloadMs",
          "vadModelWasPreloadedAtRecordingStart",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VAD Round 14 (2026-08-24), Phase C: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  describe("VAD ROUND 14 Silero continuation gate fields", () => {
    it("accepts a fully-populated, real-shaped 'silero suppressed a premature stop' payload", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationMode: "silero",
        vadContinuationModelThreshold: 0.5,
        vadContinuationModelLastSpeechAtMs: 2800,
        vadContinuationModelSilenceCandidateAtMs: 3100,
        vadContinuationModelSilenceConfirmedAtMs: 4800,
        vadContinuationFallbackUsed: false,
        vadLegacyStopSuppressedByModelCount: 12,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadContinuationMode: "silero",
          vadContinuationModelThreshold: 0.5,
          vadContinuationModelLastSpeechAtMs: 2800,
          vadContinuationModelSilenceCandidateAtMs: 3100,
          vadContinuationModelSilenceConfirmedAtMs: 4800,
          vadContinuationFallbackUsed: false,
          vadLegacyStopSuppressedByModelCount: 12,
        }),
      });
    });

    it("accepts a fully-populated 'fallback used' payload", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationMode: "silero",
        vadContinuationFallbackUsed: true,
        vadContinuationFallbackReason: "model_error",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          vadContinuationMode: "silero",
          vadContinuationFallbackUsed: true,
          vadContinuationFallbackReason: "model_error",
        }),
      });
    });

    it("accepts vadContinuationMode: 'legacy' (the flag-off default)", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationMode: "legacy",
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ vadContinuationMode: "legacy" }) });
    });

    it("accepts zero for vadLegacyStopSuppressedByModelCount -- a truthful 'never needed', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLegacyStopSuppressedByModelCount: 0,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ vadLegacyStopSuppressedByModelCount: 0 }) });
    });

    it("rejects an unknown vadContinuationMode value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationMode: "hybrid",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_mode" });
    });

    it("rejects an unknown vadContinuationFallbackReason value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationFallbackReason: "network_error",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_fallback_reason" });
    });

    it("rejects a threshold above 1", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationModelThreshold: 1.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_model_threshold" });
    });

    it("rejects a negative vadLegacyStopSuppressedByModelCount", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadLegacyStopSuppressedByModelCount: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_legacy_stop_suppressed_by_model_count" });
    });

    it("rejects a non-boolean vadContinuationFallbackUsed", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationFallbackUsed: "yes",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_fallback_used" });
    });

    it("rejects an implausible vadContinuationModelLastSpeechAtMs -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        vadContinuationModelLastSpeechAtMs: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_vad_continuation_model_last_speech_at_ms" });
    });

    it("omits every field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "vadContinuationMode",
          "vadContinuationModelThreshold",
          "vadContinuationModelLastSpeechAtMs",
          "vadContinuationModelSilenceCandidateAtMs",
          "vadContinuationModelSilenceConfirmedAtMs",
          "vadContinuationFallbackUsed",
          "vadContinuationFallbackReason",
          "vadLegacyStopSuppressedByModelCount",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // VOICE NEXT LEVEL, Phase D (2026-08-24): see voice-latency-logic.ts's
  // own VoiceLatencyTerminalDiagnostics doc comment and
  // provider-attempt-telemetry-logic.ts's own doc comment for what each
  // answers and the real production gap this closes (a both-attempts-
  // failed Consult AI/TTS turn previously had no attempt-level breakdown
  // at all).
  describe("VOICE NEXT LEVEL Phase D attempt-level telemetry (consultation/tts/stt x attempt1/attempt2)", () => {
    it("accepts a fully-populated 'both attempts failed' shape for all three pipelines", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_failed",
        summary: validSummary(),
        consultationAttempt1Ms: 30012,
        consultationAttempt1Outcome: "timeout",
        consultationAttempt2Ms: 29876,
        consultationAttempt2Outcome: "timeout",
        ttsAttempt1Ms: 20005,
        ttsAttempt1Outcome: "timeout",
        ttsAttempt2Ms: 19998,
        ttsAttempt2Outcome: "timeout",
        sttAttempt1Ms: 812,
        sttAttempt1Outcome: "success",
        sttAttempt1HttpStatus: 200,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          consultationAttempt1Ms: 30012,
          consultationAttempt1Outcome: "timeout",
          consultationAttempt2Ms: 29876,
          consultationAttempt2Outcome: "timeout",
          ttsAttempt1Ms: 20005,
          ttsAttempt1Outcome: "timeout",
          ttsAttempt2Ms: 19998,
          ttsAttempt2Outcome: "timeout",
          sttAttempt1Ms: 812,
          sttAttempt1Outcome: "success",
          sttAttempt1HttpStatus: 200,
        }),
      });
    });

    it("accepts every real ProviderAttemptOutcome value", () => {
      for (const outcome of ["success", "timeout", "http_429", "http_5xx", "http_error", "network_error", "invalid_response"]) {
        const result = parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "tts_completed",
          summary: validSummary(),
          consultationAttempt1Outcome: outcome,
        });
        expect(result).toEqual({ ok: true, value: expect.objectContaining({ consultationAttempt1Outcome: outcome }) });
      }
    });

    it("rejects an unknown attempt outcome value -- the vocabulary is closed, never a free-form string", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        ttsAttempt2Outcome: "provider_gremlins",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_tts_attempt2_outcome" });
    });

    it("rejects an implausible attempt duration -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        sttAttempt1Ms: 10 * 60 * 1000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_attempt1_ms" });
    });

    it("rejects an implausible attempt httpStatus", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        consultationAttempt2HttpStatus: 9999,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_attempt2_http_status" });
    });

    it("accepts zero for an attempt Ms -- a truthful 'instant', not rejected as missing", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        ttsAttempt1Ms: 0,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ ttsAttempt1Ms: 0 }) });
    });

    it("omits every field entirely when not provided -- never fabricated, and attempt2 stays absent when no retry happened", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "consultationAttempt1Ms",
          "consultationAttempt1Outcome",
          "consultationAttempt1HttpStatus",
          "consultationAttempt2Ms",
          "consultationAttempt2Outcome",
          "consultationAttempt2HttpStatus",
          "ttsAttempt1Ms",
          "ttsAttempt1Outcome",
          "ttsAttempt1HttpStatus",
          "ttsAttempt2Ms",
          "ttsAttempt2Outcome",
          "ttsAttempt2HttpStatus",
          "sttAttempt1Ms",
          "sttAttempt1Outcome",
          "sttAttempt1HttpStatus",
          "sttAttempt2Ms",
          "sttAttempt2Outcome",
          "sttAttempt2HttpStatus",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // STT Flash-Lite root-cause diagnosis (2026-08-20): lets a real
  // production STT failure be attributed, directly from this one log line,
  // to the real Gemini HTTP status/canonical error status, or to a real
  // fetch-level failure (timeout/network) -- see voice-latency-logic.ts's
  // own VoiceLatencyTerminalDiagnostics doc comment.
  describe("STT provider diagnostics (sttProviderHttpStatus / sttProviderErrorStatus / sttProviderErrorMessage / sttProviderFetchErrorName)", () => {
    it("accepts a fully-populated set of provider diagnostic fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderHttpStatus: 404,
        sttProviderErrorStatus: "NOT_FOUND",
        sttProviderErrorMessage: "models/gemini-2.5-flash-lite is not found for API version v1beta, or is not supported for content generation.",
        sttProviderFetchErrorName: "TimeoutError",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          sttProviderHttpStatus: 404,
          sttProviderErrorStatus: "NOT_FOUND",
          sttProviderErrorMessage: "models/gemini-2.5-flash-lite is not found for API version v1beta, or is not supported for content generation.",
          sttProviderFetchErrorName: "TimeoutError",
        }),
      });
    });

    it("rejects an implausible sttProviderHttpStatus (outside 100-599) -- never a real one", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderHttpStatus: 9999,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_http_status" });
    });

    it("rejects an sttProviderErrorStatus outside Google's canonical UPPER_SNAKE_CASE vocabulary -- never a raw provider message smuggled through", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderErrorStatus: "Invalid value at 'contents[0]'",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_error_status" });
    });

    it("rejects an sttProviderFetchErrorName outside real Error.name characters", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderFetchErrorName: "Timeout Error 123",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_fetch_error_name" });
    });

    it("omits all four fields entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of ["sttProviderHttpStatus", "sttProviderErrorStatus", "sttProviderErrorMessage", "sttProviderFetchErrorName"]) {
          expect(field in result.value).toBe(false);
        }
      }
    });

    it("accepts a real Google diagnostic message, including punctuation/slashes/quotes it legitimately uses", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderErrorMessage: "Invalid value at 'contents[0].parts[1].inline_data.mime_type'",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ sttProviderErrorMessage: "Invalid value at 'contents[0].parts[1].inline_data.mime_type'" }),
      });
    });

    it("rejects an sttProviderErrorMessage longer than the safe bound", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderErrorMessage: "x".repeat(301),
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_error_message" });
    });

    it("rejects an empty sttProviderErrorMessage", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderErrorMessage: "",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_error_message" });
    });

    it("rejects an sttProviderErrorMessage containing control characters -- never a crafted multi-line value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderErrorMessage: "line one\nline two",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_error_message" });
    });

    it("rejects a non-string sttProviderErrorMessage", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "stt_failed",
        summary: validSummary(),
        sttProviderErrorMessage: 12345,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_stt_provider_error_message" });
    });
  });

  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // same validation rules as the stt* fields above, reusing the same
  // shared helpers -- see consultation-chat-provider.ts's own
  // ChatProviderError doc comment for exactly what these mean.
  describe("Consult AI provider diagnostics (consultationProviderHttpStatus / consultationProviderErrorStatus / consultationProviderErrorMessage)", () => {
    it("accepts a fully-populated set of provider diagnostic fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
        consultationProviderHttpStatus: 503,
        consultationProviderErrorStatus: "UNAVAILABLE",
        consultationProviderErrorMessage: "The model is overloaded. Please try again later.",
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          consultationProviderHttpStatus: 503,
          consultationProviderErrorStatus: "UNAVAILABLE",
          consultationProviderErrorMessage: "The model is overloaded. Please try again later.",
        }),
      });
    });

    it("rejects an implausible consultationProviderHttpStatus", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
        consultationProviderHttpStatus: 9999,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_provider_http_status" });
    });

    it("rejects a consultationProviderErrorStatus outside Google's canonical UPPER_SNAKE_CASE vocabulary", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
        consultationProviderErrorStatus: "the model said no",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_provider_error_status" });
    });

    it("rejects a consultationProviderErrorMessage containing control characters", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
        consultationProviderErrorMessage: "line one\nline two",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_provider_error_message" });
    });

    it("omits all three fields entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of ["consultationProviderHttpStatus", "consultationProviderErrorStatus", "consultationProviderErrorMessage"]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // Voice latency optimization audit (2026-08-21): lets a real production
  // test correlate reply length directly against both consultationProviderMs
  // and ttsProviderMs from this one log line.
  describe("voiceReplyTextLength", () => {
    it("accepts a real reply length", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        voiceReplyTextLength: 214,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ voiceReplyTextLength: 214 }) });
    });

    it("accepts zero", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        voiceReplyTextLength: 0,
      });
      expect(result).toEqual({ ok: true, value: expect.objectContaining({ voiceReplyTextLength: 0 }) });
    });

    it("rejects a negative length", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        voiceReplyTextLength: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_voice_reply_text_length" });
    });

    it("rejects a length beyond the real MAX_VOICE_REPLY_TEXT_LENGTH ceiling", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        voiceReplyTextLength: 4001,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_voice_reply_text_length" });
    });

    it("rejects a non-integer length", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "tts_completed",
        summary: validSummary(),
        voiceReplyTextLength: 12.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_voice_reply_text_length" });
    });

    it("omits the field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect("voiceReplyTextLength" in result.value).toBe(false);
    });
  });

  // Consult AI provider latency variance audit (2026-08-21): lets a real
  // production test correlate consultationProviderMs's own variance
  // against real Gemini-supplied token usage and context size.
  describe("Consult AI token usage / context size (consultationPromptTokens / consultationOutputTokens / consultationThinkingTokens / consultationCachedTokens / consultationHistoryMessageCount / consultationHistoryChars / consultationMemoryChars / consultationInputChars)", () => {
    it("accepts a fully-populated set of these fields", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_succeeded_no_voice_reply",
        summary: validSummary(),
        consultationPromptTokens: 2400,
        consultationOutputTokens: 95,
        consultationThinkingTokens: 1800,
        consultationCachedTokens: 100,
        consultationHistoryMessageCount: 4,
        consultationHistoryChars: 512,
        consultationMemoryChars: 340,
        consultationInputChars: 27,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          consultationPromptTokens: 2400,
          consultationOutputTokens: 95,
          consultationThinkingTokens: 1800,
          consultationCachedTokens: 100,
          consultationHistoryMessageCount: 4,
          consultationHistoryChars: 512,
          consultationMemoryChars: 340,
          consultationInputChars: 27,
        }),
      });
    });

    it("accepts zero for every field", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_succeeded_no_voice_reply",
        summary: validSummary(),
        consultationThinkingTokens: 0,
        consultationHistoryMessageCount: 0,
      });
      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ consultationThinkingTokens: 0, consultationHistoryMessageCount: 0 }),
      });
    });

    it("rejects a negative value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_succeeded_no_voice_reply",
        summary: validSummary(),
        consultationThinkingTokens: -1,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_thinking_tokens" });
    });

    it("rejects a non-integer value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_succeeded_no_voice_reply",
        summary: validSummary(),
        consultationHistoryChars: 12.5,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_history_chars" });
    });

    it("rejects an implausibly large value", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_succeeded_no_voice_reply",
        summary: validSummary(),
        consultationMemoryChars: 10_000_000,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_memory_chars" });
    });

    it("omits all eight fields entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const field of [
          "consultationPromptTokens",
          "consultationOutputTokens",
          "consultationThinkingTokens",
          "consultationCachedTokens",
          "consultationHistoryMessageCount",
          "consultationHistoryChars",
          "consultationMemoryChars",
          "consultationInputChars",
        ]) {
          expect(field in result.value).toBe(false);
        }
      }
    });
  });

  // Consult AI voice thinking A/B (2026-08-21): lets a real production A/B
  // test tell which thinking mode actually produced a given reply.
  describe("consultationThinkingMode", () => {
    it("accepts every real Gemini 3 thinking level plus the 'default' sentinel", () => {
      for (const mode of ["MINIMAL", "LOW", "MEDIUM", "HIGH", "default"]) {
        const result = parseVoiceLatencyTelemetryPayload({
          attemptId: "attempt-1",
          outcome: "consultation_succeeded_no_voice_reply",
          summary: validSummary(),
          consultationThinkingMode: mode,
        });
        expect(result).toEqual({ ok: true, value: expect.objectContaining({ consultationThinkingMode: mode }) });
      }
    });

    it("rejects a value outside the fixed set -- never a free-form string", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_succeeded_no_voice_reply",
        summary: validSummary(),
        consultationThinkingMode: "ultra-fast",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_consultation_thinking_mode" });
    });

    it("omits the field entirely when not provided -- never fabricated", () => {
      const result = parseVoiceLatencyTelemetryPayload({
        attemptId: "attempt-1",
        outcome: "consultation_failed",
        summary: validSummary(),
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect("consultationThinkingMode" in result.value).toBe(false);
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
