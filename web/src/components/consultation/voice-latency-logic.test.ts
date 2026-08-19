import { describe, expect, it, vi } from "vitest";

import {
  computeVoiceLatencySummary,
  logVoiceLatencySummary,
  markVoiceLatencyStage,
  mergeVoiceLatencyMarks,
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
