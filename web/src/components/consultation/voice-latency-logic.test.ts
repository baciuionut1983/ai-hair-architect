import { describe, expect, it, vi } from "vitest";

import {
  computeVoiceLatencySummary,
  logVoiceLatencySummary,
  markVoiceLatencyStage,
  mergeVoiceLatencyMarks,
  reportVoiceLatencySummary,
  type VoiceLatencyMarks,
} from "./voice-latency-logic";

describe("markVoiceLatencyStage", () => {
  it("records a stage's timestamp", () => {
    const marks = markVoiceLatencyStage({}, "recording_stopped", 1000);
    expect(marks.recording_stopped).toBe(1000);
  });

  it("never overwrites an already-recorded stage -- the first real measurement is preserved", () => {
    const marks = markVoiceLatencyStage({ recording_stopped: 1000 }, "recording_stopped", 5000);
    expect(marks.recording_stopped).toBe(1000);
  });

  it("does not mutate the input marks object", () => {
    const input: VoiceLatencyMarks = { recording_stopped: 1000 };
    markVoiceLatencyStage(input, "blob_created", 1010);
    expect(input).toEqual({ recording_stopped: 1000 });
  });
});

describe("mergeVoiceLatencyMarks", () => {
  it("combines marks from two independently-tracked layers (e.g. the STT phase and the Consult AI phase)", () => {
    const sttMarks: VoiceLatencyMarks = { recording_stopped: 1000, transcript_ready: 1500 };
    const consultationMarks: VoiceLatencyMarks = { consultation_request_started: 1500, consultation_response_received: 2500 };

    const merged = mergeVoiceLatencyMarks(sttMarks, consultationMarks);

    expect(merged).toEqual({
      recording_stopped: 1000,
      transcript_ready: 1500,
      consultation_request_started: 1500,
      consultation_response_received: 2500,
    });
  });
});

describe("computeVoiceLatencySummary", () => {
  it("computes every requested duration from real marks, never fabricating a value for a missing stage", () => {
    const marks: VoiceLatencyMarks = {
      mic_requested: 0,
      recording_stopped: 5000,
      blob_created: 5050,
      conversion_started: 5050,
      conversion_completed: 5200,
      stt_request_started: 5200,
      transcript_ready: 6200,
      consultation_request_started: 6200,
      consultation_response_received: 9200,
      tts_request_started: 9200,
      tts_audio_received: 10700,
      audio_ready: 10750,
      playback_started: 10800,
    };

    const summary = computeVoiceLatencySummary(marks, {
      sttProviderMs: 800,
      consultationProviderMs: 2700,
      ttsProviderMs: 1300,
    });

    expect(summary).toEqual({
      recordingFinalizeMs: 50,
      conversionMs: 150,
      sttNetworkAndServerMs: 200, // 1000 total - 800 provider
      sttProviderMs: 800,
      sttTotalMs: 1000,
      consultationProviderMs: 2700,
      consultationTotalMs: 3000,
      consultationPreProviderMs: null,
      consultationReplyWriteMs: null,
      consultationFailedFirstAttemptMs: null,
      consultationServerTotalMs: null,
      consultationUnattributedMs: null,
      consultationNetworkAndTransferMs: null,
      ttsProviderMs: 1300,
      ttsTotalMs: 1500,
      ttsPreProviderMs: null,
      ttsUsageWriteMs: null,
      ttsAudioProcessingMs: null,
      ttsServerTotalMs: null,
      ttsNetworkAndTransferMs: null,
      audioPreparationMs: 50,
      timeToFirstAudioMs: 5800, // playback_started(10800) - recording_stopped(5000)
      voiceTurnTotalMs: 10800, // playback_started(10800) - mic_requested(0)
      timeToPlaybackCompleteMs: null, // playback_ended never reached in this test
      // 50 (recordingFinalizeMs) + 150 (conversionMs) + 1000 (sttTotalMs) +
      // 3000 (consultationTotalMs) + 1500 (ttsTotalMs) + 50 (audioPreparationMs)
      // = 5750; timeToFirstAudioMs is 5800 -- a genuine, if small, 50ms gap.
      voiceTurnUnattributedMs: 50,
    });
  });

  it("computes timeToPlaybackCompleteMs from recording_stopped to playback_ended, when the turn actually finished playing", () => {
    const summary = computeVoiceLatencySummary({
      recording_stopped: 5000,
      playback_started: 10800,
      playback_ended: 12300,
    });

    expect(summary.timeToPlaybackCompleteMs).toBe(7300);
  });

  it("returns null (never a fabricated 0 or estimate) for any duration whose marks were never reached -- e.g. a turn with Voice Reply off never reaches TTS stages", () => {
    const marks: VoiceLatencyMarks = {
      mic_requested: 0,
      recording_stopped: 5000,
      blob_created: 5050,
      stt_request_started: 5100,
      transcript_ready: 6100,
      consultation_request_started: 6100,
      consultation_response_received: 9100,
      // No tts_* or playback_started marks -- Voice Reply was off.
    };

    const summary = computeVoiceLatencySummary(marks);

    expect(summary.ttsTotalMs).toBeNull();
    expect(summary.audioPreparationMs).toBeNull();
    expect(summary.timeToFirstAudioMs).toBeNull();
    expect(summary.voiceTurnTotalMs).toBeNull();
    expect(summary.sttTotalMs).toBe(1000);
    expect(summary.consultationTotalMs).toBe(3000);
  });

  it("returns null for a provider-only duration when the server never reported one, never inventing a number the server didn't actually measure", () => {
    const marks: VoiceLatencyMarks = { stt_request_started: 1000, transcript_ready: 2000 };

    const summary = computeVoiceLatencySummary(marks);

    expect(summary.sttTotalMs).toBe(1000);
    expect(summary.sttProviderMs).toBeNull();
    expect(summary.sttNetworkAndServerMs).toBeNull();
  });

  it("computes sttNetworkAndServerMs as the real gap between the round-trip total and the server's own reported provider time", () => {
    const marks: VoiceLatencyMarks = { stt_request_started: 0, transcript_ready: 1200 };

    const summary = computeVoiceLatencySummary(marks, { sttProviderMs: 900 });

    expect(summary.sttTotalMs).toBe(1200);
    expect(summary.sttProviderMs).toBe(900);
    expect(summary.sttNetworkAndServerMs).toBe(300);
  });

  // Voice latency Round 12: mirrors the TTS Round 7 breakdown tests below
  // exactly, but for Consult AI -- a real production test showed
  // consultationTotalMs (~42.445s) nearly TRIPLE consultationProviderMs
  // (~14.831s), a ~27.6s gap with no way to tell whether it was network,
  // DB reads, the reply write, or something else. Reproduces that exact
  // test's real numbers to prove consultationNetworkAndTransferMs surfaces
  // the gap automatically once the server's own breakdown is available.
  it("threads through the full Consult AI server timing breakdown when the server reported one, using the actual Round 12 production numbers", () => {
    const marks: VoiceLatencyMarks = { consultation_request_started: 0, consultation_response_received: 42445 };

    const summary = computeVoiceLatencySummary(marks, {
      consultationProviderMs: 14831,
      consultationPreProviderMs: 40,
      consultationReplyWriteMs: 55,
      consultationFailedFirstAttemptMs: 0,
      consultationServerTotalMs: 14950,
    });

    expect(summary.consultationTotalMs).toBe(42445);
    expect(summary.consultationProviderMs).toBe(14831);
    expect(summary.consultationServerTotalMs).toBe(14950);
    // The real, measured answer this round exists to get: 42445 total -
    // 14950 the server itself accounts for (pre-provider + provider +
    // reply write) leaves ~27.5s that is genuinely network/client-side --
    // not explained by anything the server measured.
    expect(summary.consultationNetworkAndTransferMs).toBe(27495);
  });

  it("returns consultationNetworkAndTransferMs as null (never fabricated) when the server never reported consultationServerTotalMs", () => {
    const marks: VoiceLatencyMarks = { consultation_request_started: 0, consultation_response_received: 42445 };

    const summary = computeVoiceLatencySummary(marks, { consultationProviderMs: 14831 });

    expect(summary.consultationTotalMs).toBe(42445);
    expect(summary.consultationServerTotalMs).toBeNull();
    expect(summary.consultationNetworkAndTransferMs).toBeNull();
  });

  // Round 7: mirrors the sttNetworkAndServerMs tests above exactly, but for
  // TTS's own new, more granular server-side breakdown (see voice-reply/
  // route.ts's X-Pre-Provider-Ms/X-Usage-Write-Ms/X-Audio-Processing-Ms/
  // X-Server-Total-Ms) -- proving the real production question this round
  // exists to answer: given ttsTotalMs and the server's own authoritative
  // ttsServerTotalMs, how much of the gap is genuinely network/client-side
  // versus already accounted for server-side.
  it("threads through the full TTS server timing breakdown when the server reported one, never inventing a number it didn't", () => {
    const marks: VoiceLatencyMarks = { tts_request_started: 0, tts_audio_received: 40265 };

    const summary = computeVoiceLatencySummary(marks, {
      ttsProviderMs: 19573,
      ttsPreProviderMs: 45,
      ttsUsageWriteMs: 18300,
      ttsAudioProcessingMs: 12,
      ttsServerTotalMs: 19930,
    });

    expect(summary.ttsTotalMs).toBe(40265);
    expect(summary.ttsProviderMs).toBe(19573);
    expect(summary.ttsPreProviderMs).toBe(45);
    expect(summary.ttsUsageWriteMs).toBe(18300);
    expect(summary.ttsAudioProcessingMs).toBe(12);
    expect(summary.ttsServerTotalMs).toBe(19930);
    // The real, measured answer this round exists to get: 40265 total -
    // 19930 the server itself accounts for (pre-provider + provider +
    // usage write + audio processing) leaves ~20.3s that is genuinely
    // network/client-side (request+response transfer, response.blob()).
    expect(summary.ttsNetworkAndTransferMs).toBe(20335);
  });

  it("returns ttsNetworkAndTransferMs as null (never fabricated) when the server never reported ttsServerTotalMs", () => {
    const marks: VoiceLatencyMarks = { tts_request_started: 0, tts_audio_received: 40265 };

    const summary = computeVoiceLatencySummary(marks, { ttsProviderMs: 19573 });

    expect(summary.ttsTotalMs).toBe(40265);
    expect(summary.ttsServerTotalMs).toBeNull();
    expect(summary.ttsNetworkAndTransferMs).toBeNull();
  });

  // Round 8: a real production test showed timeToFirstAudioMs (~52.9s)
  // nearly double the sum of sttTotalMs + consultationTotalMs + ttsTotalMs
  // (~25.5s) -- this reproduces that exact test's real numbers to prove
  // voiceTurnUnattributedMs surfaces the ~27.4s gap automatically, without
  // requiring manual arithmetic across a partially-pasted log line.
  it("surfaces voiceTurnUnattributedMs as the real gap between timeToFirstAudioMs and every named phase, using the actual Round 8 production numbers", () => {
    const marks: VoiceLatencyMarks = {
      recording_stopped: 0,
      blob_created: 20, // recordingFinalizeMs: 20
      conversion_started: 20,
      conversion_completed: 27000, // conversionMs: 26980 -- the dominant candidate this round
      stt_request_started: 27000,
      transcript_ready: 30319, // sttTotalMs: 3319
      consultation_request_started: 30319,
      consultation_response_received: 38913, // consultationTotalMs: 8594
      tts_request_started: 38913,
      tts_audio_received: 52475, // ttsTotalMs: 13562
      audio_ready: 52527, // audioPreparationMs: 52
      playback_started: 52927, // timeToFirstAudioMs: 52927
    };

    const summary = computeVoiceLatencySummary(marks, {
      sttProviderMs: 2654,
      consultationProviderMs: 6258,
      ttsProviderMs: 13166,
    });

    expect(summary.timeToFirstAudioMs).toBe(52927);
    expect(summary.sttTotalMs).toBe(3319);
    expect(summary.consultationTotalMs).toBe(8594);
    expect(summary.ttsTotalMs).toBe(13562);
    // 52927 - (20 + 26980 + 3319 + 8594 + 13562 + 52) = 400 -- with these
    // particular marks, conversionMs alone explains almost the entire real
    // gap. The actual production log line (not fabricated here) is what
    // tells us whether it really is conversionMs, some other phase, or
    // split across several -- this test only proves the field computes
    // correctly, not which phase is the real cause.
    expect(summary.voiceTurnUnattributedMs).toBe(400);
  });

  it("returns voiceTurnUnattributedMs as null (never fabricated) when any named phase was never measured", () => {
    const marks: VoiceLatencyMarks = {
      recording_stopped: 0,
      stt_request_started: 0,
      transcript_ready: 1000,
      consultation_request_started: 1000,
      consultation_response_received: 2000,
      tts_request_started: 2000,
      tts_audio_received: 3000,
      playback_started: 3100,
      // No blob_created/conversion_started/conversion_completed/audio_ready
      // -- recordingFinalizeMs, conversionMs, and audioPreparationMs are
      // all null, so the sum they'd contribute to is genuinely unknown.
    };

    const summary = computeVoiceLatencySummary(marks);

    expect(summary.timeToFirstAudioMs).toBe(3100);
    expect(summary.recordingFinalizeMs).toBeNull();
    expect(summary.voiceTurnUnattributedMs).toBeNull();
  });

  it("returns an all-null summary for an empty marks object -- no stage ever reached", () => {
    const summary = computeVoiceLatencySummary({});

    expect(Object.values(summary).every((value) => value === null)).toBe(true);
  });
});

describe("logVoiceLatencySummary", () => {
  it("logs a single VOICE_LATENCY line with the attemptId and every computed duration", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const summary = computeVoiceLatencySummary({ stt_request_started: 0, transcript_ready: 500 });
    logVoiceLatencySummary("attempt-123", summary);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ tag: "VOICE_LATENCY", attemptId: "attempt-123", sttTotalMs: 500 });

    logSpy.mockRestore();
  });

  it("never logs audio bytes, transcript content, or the AI reply -- only the attemptId and numeric durations", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const summary = computeVoiceLatencySummary({ stt_request_started: 0, transcript_ready: 500 });
    logVoiceLatencySummary("attempt-123", summary);

    const logged = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(logged) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (key === "tag" || key === "attemptId") continue;
      expect(typeof value === "number" || value === null).toBe(true);
    }

    logSpy.mockRestore();
  });
});

// Round 9 (stale-client-bundle diagnosis): a real production test showed 5
// TTS timing fields still null despite Round 8 shipping them, while an
// OLDER field kept working -- the only explanation covering every symptom
// is a browser tab running a JS bundle built before those changes shipped.
// clientBuildSha (NEXT_PUBLIC_APP_COMMIT_SHA, statically inlined at build
// time -- see next.config.ts) rides along on every report automatically,
// so the next real test settles this with real evidence instead of
// presuming again.
describe("reportVoiceLatencySummary", () => {
  it("includes clientBuildSha (from NEXT_PUBLIC_APP_COMMIT_SHA) in every POST body, without any call site having to pass it", async () => {
    const originalSha = process.env.NEXT_PUBLIC_APP_COMMIT_SHA;
    process.env.NEXT_PUBLIC_APP_COMMIT_SHA = "abc1234567890abc1234567890abc1234567890";
    try {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null));
      const summary = computeVoiceLatencySummary({ stt_request_started: 0, transcript_ready: 500 });

      reportVoiceLatencySummary("client-1", "attempt-123", "stt_failed", summary, { fetch: fetchMock });

      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as { body: string }).body);
      expect(body.clientBuildSha).toBe("abc1234567890abc1234567890abc1234567890");
    } finally {
      process.env.NEXT_PUBLIC_APP_COMMIT_SHA = originalSha;
    }
  });

  it("posts to the voice-latency endpoint for the given clientId with the attemptId/outcome/summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    const summary = computeVoiceLatencySummary({ stt_request_started: 0, transcript_ready: 500 });

    reportVoiceLatencySummary("client-42", "attempt-abc", "tts_completed", summary, { fetch: fetchMock });

    await Promise.resolve();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/clients/client-42/voice-latency");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({ attemptId: "attempt-abc", outcome: "tts_completed" });
  });

  it("never throws or rejects when the fetch itself fails -- best-effort observability only", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const summary = computeVoiceLatencySummary({ stt_request_started: 0, transcript_ready: 500 });

    expect(() => reportVoiceLatencySummary("client-1", "attempt-1", "stt_failed", summary, { fetch: fetchMock })).not.toThrow();
  });
});
