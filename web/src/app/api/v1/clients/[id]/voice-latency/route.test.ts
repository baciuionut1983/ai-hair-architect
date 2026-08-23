import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const clientRepoMock = vi.hoisted(() => ({ resolveOwnedClient: vi.fn() }));
const hardeningMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/client-repository", () => clientRepoMock);
vi.mock("@/lib/hardening", () => hardeningMock);

import { POST } from "./route";

const OWNER = { id: "owner-1", email: "owner@example.com", role: "professional", locale: "en" };
const CLIENT = { id: "client-1", ownerUserId: "owner-1", fullName: "Jane Doe", email: "", phone: "", notes: "", createdAt: "", updatedAt: "" };

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
    timeToPlaybackCompleteMs: 2600,
  };
}

function invoke(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/clients/client-1/voice-latency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "client-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER);
  clientRepoMock.resolveOwnedClient.mockResolvedValue(CLIENT);
  hardeningMock.checkRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
});

describe("POST /api/v1/clients/[id]/voice-latency", () => {
  it("returns 401 without a session, never resolving the client or logging anything", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(401);
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns 429 when rate-limited, never resolving the client or logging anything", async () => {
    hardeningMock.checkRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(429);
    expect(clientRepoMock.resolveOwnedClient).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns 404 when the client isn't owned by the caller, never logging anything", async () => {
    clientRepoMock.resolveOwnedClient.mockResolvedValue(null);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(404);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns whatever Response resolveOwnedClient itself returns for a cross-owner client id (matches every other client-scoped route)", async () => {
    const crossOwnerResponse = new Response(null, { status: 403 });
    clientRepoMock.resolveOwnedClient.mockResolvedValue(crossOwnerResponse);

    const response = await invoke({ attemptId: "attempt-1", outcome: "tts_completed", summary: validSummary() });

    expect(response).toBe(crossOwnerResponse);
  });

  it("returns 400 for unparseable JSON", async () => {
    const response = await invoke("not json");
    expect(response.status).toBe(400);
  });

  it("returns 400 for a payload that fails strict validation (e.g. a made-up outcome), never logging it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-1", outcome: "made_up", summary: validSummary() });

    expect(response.status).toBe(400);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("accepts a valid payload and logs the literal, searchable 'VOICE LATENCY SUMMARY' string server-side", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await invoke({ attemptId: "attempt-42", outcome: "tts_completed", summary: validSummary() });

    expect(response.status).toBe(202);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line.startsWith("VOICE LATENCY SUMMARY ")).toBe(true);
    const jsonPart = line.slice("VOICE LATENCY SUMMARY ".length);
    const parsed = JSON.parse(jsonPart);
    expect(parsed).toMatchObject({
      tag: "VOICE_LATENCY_SERVER",
      ownerUserId: "owner-1",
      clientId: "client-1",
      attemptId: "attempt-42",
      outcome: "tts_completed",
      ...validSummary(),
    });
    logSpy.mockRestore();
  });

  // Regression this proves: never let a stylist's audio, spoken words, or
  // the AI's reply text reach this endpoint's own logs, even if a buggy or
  // malicious client tried to smuggle them in via extra fields.
  it("never logs a smuggled transcript/reply-text/audio field, even if present in the request body", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-42",
      outcome: "tts_completed",
      summary: { ...validSummary(), transcript: "Spune-mi ce tunsoare recomanzi", replyText: "some AI reply", audioBase64: "AAAA" },
    });

    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain("tunsoare");
    expect(logged).not.toContain("some AI reply");
    expect(logged).not.toContain("AAAA");
    logSpy.mockRestore();
  });

  it("never calls any AI provider and never touches AI Usage Metering -- pure, free observability", async () => {
    // No provider/usage-repository module is mocked at all for this test
    // file -- if the route imported and called either, this test would
    // throw (a real network/DB call attempted in a unit test), not merely
    // silently pass.
    const response = await invoke({ attemptId: "attempt-1", outcome: "stt_failed", summary: validSummary() });
    expect(response.status).toBe(202);
  });

  // Production observability follow-up (2026-08-19): a failed turn's
  // terminal diagnostics (errorCode/providerAttemptCount/
  // elapsedSinceMicRequestMs) and the mechanically-derived terminalStage
  // both land in the SAME "VOICE LATENCY SUMMARY" log line -- an operator
  // never needs a second log format to tell STT failed from Consult AI
  // failing from TTS failing.
  it("includes terminalStage (derived from outcome) and the terminal diagnostics fields in the log line for a failed turn", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-99",
      outcome: "consultation_failed",
      summary: validSummary(),
      errorCode: "PROVIDER_TIMEOUT",
      providerAttemptCount: 2,
      elapsedSinceMicRequestMs: 4321,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      outcome: "consultation_failed",
      terminalStage: "consultation",
      errorCode: "PROVIDER_TIMEOUT",
      providerAttemptCount: 2,
      elapsedSinceMicRequestMs: 4321,
    });
    logSpy.mockRestore();
  });

  it("logs errorCode/providerAttemptCount/elapsedSinceMicRequestMs as null (never omitted, never fabricated) when not reported", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-100", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      terminalStage: "playback",
      errorCode: null,
      providerAttemptCount: null,
      elapsedSinceMicRequestMs: null,
    });
    logSpy.mockRestore();
  });

  // Round 9 (stale-client-bundle diagnosis): clientBuildSha is the one
  // field that lets an operator directly confirm, from this log line
  // alone, whether a given production test actually ran the code a given
  // round shipped -- see next.config.ts's own doc comment.
  it("logs clientBuildSha when the client reported one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-101",
      outcome: "tts_completed",
      summary: validSummary(),
      clientBuildSha: "c491a32bede0dd2c4e94c18681314edd3373f047",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ clientBuildSha: "c491a32bede0dd2c4e94c18681314edd3373f047" });
    logSpy.mockRestore();
  });

  it("logs clientBuildSha as null (never fabricated) when the client didn't report one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-102", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ clientBuildSha: null });
    logSpy.mockRestore();
  });

  // Round 11 (gemini-2.5-flash-lite STT evaluation): sttModel is what lets
  // a real production test be attributed to a model directly from this log
  // line -- the entire point of this round's controlled evaluation.
  it("logs sttModel when the client reported one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-103",
      outcome: "tts_completed",
      summary: validSummary(),
      sttModel: "gemini-2.5-flash-lite",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ sttModel: "gemini-2.5-flash-lite" });
    logSpy.mockRestore();
  });

  it("logs sttModel as null (never fabricated) when the client didn't report one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-104", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ sttModel: null });
    logSpy.mockRestore();
  });

  // End-of-speech hardening (2026-08-20): the end-to-end telemetry for the
  // production VAD/background-music fix.
  it("logs the full VAD diagnostics breakdown when the client reported one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-105",
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

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadAutoStopReason: "stop_silence",
      vadRecordingDurationMs: 4500,
      vadSpeechDurationMs: 2200,
      vadSilenceAfterSpeechMs: 2000,
      vadSpeechDetectedAtMs: 300,
      vadSpeechEndedAtMs: 2500,
      vadMaxDurationTriggered: false,
      vadMode: "heuristic-rms-spectral-v1",
    });
    logSpy.mockRestore();
  });

  it("logs every VAD diagnostic field as null (never fabricated) when the client didn't report VAD at all -- e.g. VAD setup failed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-106", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadAutoStopReason: null,
      vadRecordingDurationMs: null,
      vadSpeechDurationMs: null,
      vadSilenceAfterSpeechMs: null,
      vadSpeechDetectedAtMs: null,
      vadSpeechEndedAtMs: null,
      vadMaxDurationTriggered: null,
      vadMode: null,
    });
    logSpy.mockRestore();
  });

  // VAD false-negative hardening (2026-08-21): lets a real production
  // no-speech-timeout false negative be diagnosed directly from this log
  // line.
  it("logs the VAD diagnostic accumulators when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-118",
      outcome: "stt_failed",
      summary: validSummary(),
      vadPeakRms: 0.18,
      vadPeakSpeechBandRatio: 0.41,
      vadFinalNoiseFloor: 0.025,
      vadMaxCandidateSpeechMs: 210,
      vadCandidateResetCount: 4,
      vadFullyQualifiedSampleCount: 9,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadPeakRms: 0.18,
      vadPeakSpeechBandRatio: 0.41,
      vadFinalNoiseFloor: 0.025,
      vadMaxCandidateSpeechMs: 210,
      vadCandidateResetCount: 4,
      vadFullyQualifiedSampleCount: 9,
    });
    logSpy.mockRestore();
  });

  it("logs the VAD diagnostic accumulators as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-119", outcome: "stt_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadPeakRms: null,
      vadPeakSpeechBandRatio: null,
      vadFinalNoiseFloor: null,
      vadMaxCandidateSpeechMs: null,
      vadCandidateResetCount: null,
      vadFullyQualifiedSampleCount: null,
    });
    logSpy.mockRestore();
  });

  // VAD false-negative hardening, ROUND 2 (2026-08-22): the real
  // production retest of cb0d66c showed the round-1 accumulators alone
  // couldn't distinguish which gate rejected the remaining real-speech
  // samples -- these 5 fields let an operator read the full amplitude/
  // spectral/alignment breakdown directly from this log line.
  it("logs the VAD ROUND 2 diagnostic accumulators when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-120",
      outcome: "stt_failed",
      summary: validSummary(),
      vadTotalSampleCount: 100,
      vadAmplitudeQualifiedSampleCount: 60,
      vadSpectralQualifiedSampleCount: 15,
      vadLongestCandidateGapMs: 3000,
      vadPeakNoiseFloor: 0.03,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadTotalSampleCount: 100,
      vadAmplitudeQualifiedSampleCount: 60,
      vadSpectralQualifiedSampleCount: 15,
      vadLongestCandidateGapMs: 3000,
      vadPeakNoiseFloor: 0.03,
    });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 2 diagnostic accumulators as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-121", outcome: "stt_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadTotalSampleCount: null,
      vadAmplitudeQualifiedSampleCount: null,
      vadSpectralQualifiedSampleCount: null,
      vadLongestCandidateGapMs: null,
      vadPeakNoiseFloor: null,
    });
    logSpy.mockRestore();
  });

  // VAD false-negative hardening, ROUND 4 (2026-08-22): a third real
  // production recording showed the same healthy-individual-gates/near-
  // zero-overlap shape as rounds 2/3, motivating the windowed-evidence
  // confirmation model -- see voice-activity-logic.ts's own ROUND 4
  // VoiceActivityDiagnostics doc comment for what this field answers.
  it("logs the VAD ROUND 4 diagnostic accumulator when the client reported it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-122",
      outcome: "stt_failed",
      summary: validSummary(),
      vadWindowedCandidateSampleCount: 42,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ vadWindowedCandidateSampleCount: 42 });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 4 diagnostic accumulator as null (never fabricated) when the client didn't report it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-123", outcome: "stt_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ vadWindowedCandidateSampleCount: null });
    logSpy.mockRestore();
  });

  // VAD end-of-speech hardening, ROUND 6 (2026-08-22): a real production
  // report (user's own ground truth: mic stopped mid-utterance) proved a
  // false POSITIVE end-of-speech -- see voice-activity-logic.ts's own
  // ROUND 6 VoiceActivityDiagnostics doc comments for what each answers.
  it("logs the VAD ROUND 6 diagnostic accumulators when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-124",
      outcome: "tts_completed",
      summary: validSummary(),
      vadPostConfirmationSampleCount: 30,
      vadContinuationQualifiedSampleCount: 22,
      vadContinuationSpectralOnlySampleCount: 6,
      vadContinuationAmplitudeOnlySampleCount: 4,
      vadLongestPostConfirmationGapMs: 400,
      vadLastStrongEvidenceAgeAtStopMs: 1500,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadPostConfirmationSampleCount: 30,
      vadContinuationQualifiedSampleCount: 22,
      vadContinuationSpectralOnlySampleCount: 6,
      vadContinuationAmplitudeOnlySampleCount: 4,
      vadLongestPostConfirmationGapMs: 400,
      vadLastStrongEvidenceAgeAtStopMs: 1500,
    });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 6 diagnostic accumulators as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-125", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadPostConfirmationSampleCount: null,
      vadContinuationQualifiedSampleCount: null,
      vadContinuationSpectralOnlySampleCount: null,
      vadContinuationAmplitudeOnlySampleCount: null,
      vadLongestPostConfirmationGapMs: null,
      vadLastStrongEvidenceAgeAtStopMs: null,
    });
    logSpy.mockRestore();
  });

  // VAD start-detection hardening, ROUND 7 (2026-08-22): a real production
  // test with background noise present showed START itself never
  // confirming -- see voice-activity-logic.ts's own ROUND 7
  // VoiceActivityDiagnostics doc comments for what each of these answers.
  it("logs the VAD ROUND 7 diagnostic accumulators when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-126",
      outcome: "tts_completed",
      summary: validSummary(),
      vadAmbientSpectralRatioEstimate: 0.24,
      vadPeakAmbientSpectralRatioEstimate: 0.26,
      vadSpectralLiftQualifiedSampleCount: 9,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadAmbientSpectralRatioEstimate: 0.24,
      vadPeakAmbientSpectralRatioEstimate: 0.26,
      vadSpectralLiftQualifiedSampleCount: 9,
    });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 7 diagnostic accumulators as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-127", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadAmbientSpectralRatioEstimate: null,
      vadPeakAmbientSpectralRatioEstimate: null,
      vadSpectralLiftQualifiedSampleCount: null,
    });
    logSpy.mockRestore();
  });

  // VAD start-detection hardening, ROUND 8 (2026-08-22): a real production
  // test with instrumental music and no voice at all produced a false
  // positive at aggregate rates indistinguishable from genuine speech --
  // see voice-activity-logic.ts's own ROUND 8 VoiceActivityDiagnostics
  // doc comments for what each of these answers.
  it("logs the VAD ROUND 8 diagnostic accumulators when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-128",
      outcome: "tts_completed",
      summary: validSummary(),
      vadLongestSpectralQualifiedRunMs: 5800,
      vadSpectralQualifiedRunCount: 1,
      vadLongestFullyQualifiedRunMs: 400,
      vadFullyQualifiedRunCount: 6,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadLongestSpectralQualifiedRunMs: 5800,
      vadSpectralQualifiedRunCount: 1,
      vadLongestFullyQualifiedRunMs: 400,
      vadFullyQualifiedRunCount: 6,
    });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 8 diagnostic accumulators as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-129", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadLongestSpectralQualifiedRunMs: null,
      vadSpectralQualifiedRunCount: null,
      vadLongestFullyQualifiedRunMs: null,
      vadFullyQualifiedRunCount: null,
    });
    logSpy.mockRestore();
  });

  // VAD start-detection hardening, ROUND 9 (2026-08-23): see
  // voice-activity-logic.ts's own ROUND 9 VoiceActivityDiagnostics doc
  // comment for what this answers.
  it("logs the VAD ROUND 9 diagnostic accumulator when the client reported it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-130",
      outcome: "tts_completed",
      summary: validSummary(),
      vadPeakStreakSpectralHitCount: 1,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ vadPeakStreakSpectralHitCount: 1 });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 9 diagnostic accumulator as null (never fabricated) when the client didn't report it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-131", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ vadPeakStreakSpectralHitCount: null });
    logSpy.mockRestore();
  });

  // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: see
  // voice-latency-logic.ts's own VoiceLatencyTerminalDiagnostics doc
  // comment for what each answers. STRICT SHADOW MODE, diagnostic-only.
  it("logs the VAD ROUND 10 Silero shadow diagnostics when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-132",
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

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
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
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 10 Silero shadow diagnostics as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-133", outcome: "tts_completed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadModelAvailable: null,
      vadModelName: null,
      vadModelVersion: null,
      vadModelLoadMs: null,
      vadModelPeakSpeechProbability: null,
      vadModelMeanSpeechProbability: null,
      vadModelSpeechQualifiedSampleCount: null,
      vadModelTotalSampleCount: null,
      vadModelInferencePeakMs: null,
      vadModelInferenceMeanMs: null,
      vadModelSpeechProbabilityStdDev: null,
      vadModelError: null,
    });
    logSpy.mockRestore();
  });

  it("logs an honest 'model unavailable' shape (available: false, a real error message) exactly as the fail-open contract requires", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-134",
      outcome: "tts_completed",
      summary: validSummary(),
      vadModelAvailable: false,
      vadModelError: "AudioContext is not available in this browser.",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadModelAvailable: false,
      vadModelError: "AudioContext is not available in this browser.",
    });
    logSpy.mockRestore();
  });

  // VAD Round 11 (2026-08-23), Phase B: see voice-latency-logic.ts's own
  // VoiceLatencyTerminalDiagnostics doc comment for what each answers.
  it("logs the VAD ROUND 11 START gate fields when Silero confirmed START", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-135",
      outcome: "tts_completed",
      summary: validSummary(),
      vadStartGateMode: "silero",
      vadStartGateModelThreshold: 0.5,
      vadStartGateModelQualifiedFrames: 9,
      vadStartGateModelConfirmedAtMs: 288,
      vadStartGateFallbackUsed: false,
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadStartGateMode: "silero",
      vadStartGateModelThreshold: 0.5,
      vadStartGateModelQualifiedFrames: 9,
      vadStartGateModelConfirmedAtMs: 288,
      vadStartGateFallbackUsed: false,
    });
    logSpy.mockRestore();
  });

  it("logs the VAD ROUND 11 fallback shape when Silero was unavailable", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-136",
      outcome: "tts_completed",
      summary: validSummary(),
      vadStartGateMode: "silero",
      vadStartGateFallbackUsed: true,
      vadStartGateFallbackReason: "model_unavailable",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadStartGateMode: "silero",
      vadStartGateFallbackUsed: true,
      vadStartGateFallbackReason: "model_unavailable",
    });
    logSpy.mockRestore();
  });

  it("logs vadStartGateMode 'legacy' and every other Round 11 field as null when the flag was off / not reported", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-137", outcome: "tts_completed", summary: validSummary(), vadStartGateMode: "legacy" });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      vadStartGateMode: "legacy",
      vadStartGateModelThreshold: null,
      vadStartGateModelQualifiedFrames: null,
      vadStartGateModelConfirmedAtMs: null,
      vadStartGateFallbackUsed: null,
      vadStartGateFallbackReason: null,
    });
    logSpy.mockRestore();
  });

  // STT Flash-Lite root-cause diagnosis (2026-08-20): the real Gemini
  // provider failure detail, closing the gap where a provider HTTP error,
  // a network/timeout failure, and an empty-transcript response all
  // collapsed into the same generic errorCode with no way to tell them
  // apart from this log line alone.
  it("logs the STT provider diagnostics fields when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-107",
      outcome: "stt_failed",
      summary: validSummary(),
      sttProviderHttpStatus: 404,
      sttProviderErrorStatus: "NOT_FOUND",
      sttProviderErrorMessage: "models/gemini-2.5-flash-lite is not found for API version v1beta, or is not supported for content generation.",
      sttProviderFetchErrorName: "TimeoutError",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      sttProviderHttpStatus: 404,
      sttProviderErrorStatus: "NOT_FOUND",
      sttProviderErrorMessage: "models/gemini-2.5-flash-lite is not found for API version v1beta, or is not supported for content generation.",
      sttProviderFetchErrorName: "TimeoutError",
    });
    logSpy.mockRestore();
  });

  it("logs the STT provider diagnostics fields as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-108", outcome: "stt_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      sttProviderHttpStatus: null,
      sttProviderErrorStatus: null,
      sttProviderErrorMessage: null,
      sttProviderFetchErrorName: null,
    });
    logSpy.mockRestore();
  });

  // Consult AI 404/PROVIDER_UNAVAILABLE root-cause diagnosis (2026-08-21):
  // mirrors the STT provider diagnostics fields exactly, for the
  // consultation stage instead.
  it("logs the Consult AI provider diagnostics fields when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-110",
      outcome: "consultation_failed",
      summary: validSummary(),
      consultationProviderHttpStatus: 503,
      consultationProviderErrorStatus: "UNAVAILABLE",
      consultationProviderErrorMessage: "The model is overloaded. Please try again later.",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      consultationProviderHttpStatus: 503,
      consultationProviderErrorStatus: "UNAVAILABLE",
      consultationProviderErrorMessage: "The model is overloaded. Please try again later.",
    });
    logSpy.mockRestore();
  });

  it("logs the Consult AI provider diagnostics fields as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-111", outcome: "consultation_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      consultationProviderHttpStatus: null,
      consultationProviderErrorStatus: null,
      consultationProviderErrorMessage: null,
    });
    logSpy.mockRestore();
  });

  // Voice latency optimization audit (2026-08-21): lets a real production
  // test correlate reply length directly against provider latency.
  it("logs voiceReplyTextLength when the client reported one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-112", outcome: "tts_completed", summary: validSummary(), voiceReplyTextLength: 214 });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ voiceReplyTextLength: 214 });
    logSpy.mockRestore();
  });

  it("logs voiceReplyTextLength as null (never fabricated) when the client didn't report one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-113", outcome: "consultation_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ voiceReplyTextLength: null });
    logSpy.mockRestore();
  });

  // Consult AI provider latency variance audit (2026-08-21): lets a real
  // production test correlate consultationProviderMs variance against
  // real Gemini-supplied token usage and context size.
  it("logs Consult AI token usage / context size fields when the client reported them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-114",
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

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      consultationPromptTokens: 2400,
      consultationOutputTokens: 95,
      consultationThinkingTokens: 1800,
      consultationCachedTokens: 100,
      consultationHistoryMessageCount: 4,
      consultationHistoryChars: 512,
      consultationMemoryChars: 340,
      consultationInputChars: 27,
    });
    logSpy.mockRestore();
  });

  it("logs Consult AI token usage / context size fields as null (never fabricated) when the client didn't report them", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-115", outcome: "consultation_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({
      consultationPromptTokens: null,
      consultationOutputTokens: null,
      consultationThinkingTokens: null,
      consultationCachedTokens: null,
      consultationHistoryMessageCount: null,
      consultationHistoryChars: null,
      consultationMemoryChars: null,
      consultationInputChars: null,
    });
    logSpy.mockRestore();
  });

  // Consult AI voice thinking A/B (2026-08-21): lets a real production A/B
  // test tell which thinking mode actually produced a given reply.
  it("logs consultationThinkingMode when the client reported one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({
      attemptId: "attempt-116",
      outcome: "consultation_succeeded_no_voice_reply",
      summary: validSummary(),
      consultationThinkingMode: "LOW",
    });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ consultationThinkingMode: "LOW" });
    logSpy.mockRestore();
  });

  it("logs consultationThinkingMode as null (never fabricated) when the client didn't report one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await invoke({ attemptId: "attempt-117", outcome: "consultation_failed", summary: validSummary() });

    const [line] = logSpy.mock.calls[0] as [string];
    const parsed = JSON.parse(line.slice("VOICE LATENCY SUMMARY ".length));
    expect(parsed).toMatchObject({ consultationThinkingMode: null });
    logSpy.mockRestore();
  });
});
