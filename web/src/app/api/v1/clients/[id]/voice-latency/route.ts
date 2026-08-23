import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import { checkRateLimit } from "@/lib/hardening";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { parseVoiceLatencyTelemetryPayload, terminalStageForOutcome } from "@/lib/voice-latency-telemetry-logic";

// Voice latency audit follow-up (2026-08-19): this endpoint exists ONLY to
// close a demonstrated gap -- the VOICE_LATENCY summary voice-latency-
// logic.ts computes is only ever console.log'd from inside "use client"
// components, so it runs in the stylist's browser and NEVER reaches this
// server process at all (confirmed: zero occurrences of
// logVoiceLatencySummary outside "use client" files). Railway Deploy Logs
// only ever capture THIS process's stdout/stderr, so no search string --
// no matter how it's phrased -- could ever have found it there.
//
// This route accepts ONLY the same 12 already-documented timing numbers
// (see VoiceLatencySummary), the existing attemptId, and a fixed-enum
// outcome -- never audio, never a transcript, never AI reply text, never
// any other field (see voice-latency-telemetry-logic.ts's own strict,
// allow-list validation). It never calls an AI provider and never writes
// to AI Usage Metering (recordAiUsageEvent) -- purely free, non-blocking
// observability, not a second metered operation. The browser call is
// fire-and-forget (see reportVoiceLatencySummary in voice-latency-
// logic.ts): a failure or rejection here must never surface to the
// stylist or affect the voice pipeline in any way.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`voice-latency:${user.id}`, 30, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "Invalid request." }, { status: 400 });
  }

  const parsed = parseVoiceLatencyTelemetryPayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "INVALID_REQUEST", message: "Invalid telemetry payload." }, { status: 400 });
  }

  // The literal, space-separated phrase "VOICE LATENCY SUMMARY" is
  // intentional and load-bearing: it is the EXACT string the app's own
  // production-verification instructions ask an operator to search for in
  // Railway Deploy Logs. The previous round's client-only tag
  // ("VOICE_LATENCY", underscored, no "SUMMARY") never matched that phrase
  // even when read straight from the browser console -- this line fixes
  // both gaps at once: server-side visibility, and a search string that
  // actually matches.
  console.log(
    `VOICE LATENCY SUMMARY ${JSON.stringify({
      tag: "VOICE_LATENCY_SERVER",
      ownerUserId: user.id,
      clientId: id,
      attemptId: parsed.value.attemptId,
      outcome: parsed.value.outcome,
      // Derived from `outcome` (never sent separately -- see
      // terminalStageForOutcome's own comment), so it and `outcome` can
      // never disagree. Lets an operator filter Railway logs by exactly
      // which stage a turn ended at (STT/consultation/TTS/playback)
      // without needing to memorize all 8 outcome values.
      terminalStage: terminalStageForOutcome(parsed.value.outcome),
      errorCode: parsed.value.errorCode ?? null,
      providerAttemptCount: parsed.value.providerAttemptCount ?? null,
      elapsedSinceMicRequestMs: parsed.value.elapsedSinceMicRequestMs ?? null,
      ttsResponseHeaders: parsed.value.ttsResponseHeaders ?? null,
      // Round 9: see voice-latency-telemetry-logic.ts's own doc comment on
      // VoiceLatencyTelemetryInput.clientBuildSha -- compare this against
      // the currently-deployed HEAD commit to confirm whether a given test
      // actually ran the round's code, or a stale cached bundle.
      clientBuildSha: parsed.value.clientBuildSha ?? null,
      // Round 11 (gemini-2.5-flash-lite STT evaluation): see
      // voice-latency-telemetry-logic.ts's own doc comment on
      // VoiceLatencyTelemetryInput.sttModel -- lets a real production test
      // be attributed to a model directly from this one log line.
      sttModel: parsed.value.sttModel ?? null,
      // End-of-speech hardening (2026-08-20): see voice-activity-logic.ts's
      // own VoiceActivityDiagnostics doc comments for exactly what each of
      // these means -- never audio, never a transcript.
      vadAutoStopReason: parsed.value.vadAutoStopReason ?? null,
      vadRecordingDurationMs: parsed.value.vadRecordingDurationMs ?? null,
      vadSpeechDurationMs: parsed.value.vadSpeechDurationMs ?? null,
      vadSilenceAfterSpeechMs: parsed.value.vadSilenceAfterSpeechMs ?? null,
      vadSpeechDetectedAtMs: parsed.value.vadSpeechDetectedAtMs ?? null,
      vadSpeechEndedAtMs: parsed.value.vadSpeechEndedAtMs ?? null,
      vadMaxDurationTriggered: parsed.value.vadMaxDurationTriggered ?? null,
      vadMode: parsed.value.vadMode ?? null,
      vadPeakRms: parsed.value.vadPeakRms ?? null,
      vadPeakSpeechBandRatio: parsed.value.vadPeakSpeechBandRatio ?? null,
      vadFinalNoiseFloor: parsed.value.vadFinalNoiseFloor ?? null,
      vadMaxCandidateSpeechMs: parsed.value.vadMaxCandidateSpeechMs ?? null,
      vadCandidateResetCount: parsed.value.vadCandidateResetCount ?? null,
      vadFullyQualifiedSampleCount: parsed.value.vadFullyQualifiedSampleCount ?? null,
      vadTotalSampleCount: parsed.value.vadTotalSampleCount ?? null,
      vadAmplitudeQualifiedSampleCount: parsed.value.vadAmplitudeQualifiedSampleCount ?? null,
      vadSpectralQualifiedSampleCount: parsed.value.vadSpectralQualifiedSampleCount ?? null,
      vadLongestCandidateGapMs: parsed.value.vadLongestCandidateGapMs ?? null,
      vadPeakNoiseFloor: parsed.value.vadPeakNoiseFloor ?? null,
      vadWindowedCandidateSampleCount: parsed.value.vadWindowedCandidateSampleCount ?? null,
      vadPostConfirmationSampleCount: parsed.value.vadPostConfirmationSampleCount ?? null,
      vadContinuationQualifiedSampleCount: parsed.value.vadContinuationQualifiedSampleCount ?? null,
      vadContinuationSpectralOnlySampleCount: parsed.value.vadContinuationSpectralOnlySampleCount ?? null,
      vadContinuationAmplitudeOnlySampleCount: parsed.value.vadContinuationAmplitudeOnlySampleCount ?? null,
      vadLongestPostConfirmationGapMs: parsed.value.vadLongestPostConfirmationGapMs ?? null,
      vadLastStrongEvidenceAgeAtStopMs: parsed.value.vadLastStrongEvidenceAgeAtStopMs ?? null,
      vadAmbientSpectralRatioEstimate: parsed.value.vadAmbientSpectralRatioEstimate ?? null,
      vadPeakAmbientSpectralRatioEstimate: parsed.value.vadPeakAmbientSpectralRatioEstimate ?? null,
      vadSpectralLiftQualifiedSampleCount: parsed.value.vadSpectralLiftQualifiedSampleCount ?? null,
      vadLongestSpectralQualifiedRunMs: parsed.value.vadLongestSpectralQualifiedRunMs ?? null,
      vadSpectralQualifiedRunCount: parsed.value.vadSpectralQualifiedRunCount ?? null,
      vadLongestFullyQualifiedRunMs: parsed.value.vadLongestFullyQualifiedRunMs ?? null,
      vadFullyQualifiedRunCount: parsed.value.vadFullyQualifiedRunCount ?? null,
      // VAD start-detection hardening, ROUND 9 (2026-08-23): see
      // voice-activity-logic.ts's own ROUND 9 VoiceActivityDiagnostics doc
      // comment for what this answers.
      vadPeakStreakSpectralHitCount: parsed.value.vadPeakStreakSpectralHitCount ?? null,
      // VAD Round 10 (2026-08-23), Silero shadow mode, Phase A: see
      // voice-latency-logic.ts's own VoiceLatencyTerminalDiagnostics doc
      // comment for what each answers. STRICT SHADOW MODE, diagnostic-only.
      vadModelAvailable: parsed.value.vadModelAvailable ?? null,
      vadModelName: parsed.value.vadModelName ?? null,
      vadModelVersion: parsed.value.vadModelVersion ?? null,
      vadModelLoadMs: parsed.value.vadModelLoadMs ?? null,
      vadModelPeakSpeechProbability: parsed.value.vadModelPeakSpeechProbability ?? null,
      vadModelMeanSpeechProbability: parsed.value.vadModelMeanSpeechProbability ?? null,
      vadModelSpeechQualifiedSampleCount: parsed.value.vadModelSpeechQualifiedSampleCount ?? null,
      vadModelTotalSampleCount: parsed.value.vadModelTotalSampleCount ?? null,
      vadModelInferencePeakMs: parsed.value.vadModelInferencePeakMs ?? null,
      vadModelInferenceMeanMs: parsed.value.vadModelInferenceMeanMs ?? null,
      vadModelSpeechProbabilityStdDev: parsed.value.vadModelSpeechProbabilityStdDev ?? null,
      vadModelError: parsed.value.vadModelError ?? null,
      // STT Flash-Lite root-cause diagnosis (2026-08-20): see
      // voice-latency-telemetry-logic.ts's own doc comment on these same 3
      // fields for exactly what they mean and why.
      sttProviderHttpStatus: parsed.value.sttProviderHttpStatus ?? null,
      sttProviderErrorStatus: parsed.value.sttProviderErrorStatus ?? null,
      sttProviderErrorMessage: parsed.value.sttProviderErrorMessage ?? null,
      sttProviderFetchErrorName: parsed.value.sttProviderFetchErrorName ?? null,
      consultationProviderHttpStatus: parsed.value.consultationProviderHttpStatus ?? null,
      consultationProviderErrorStatus: parsed.value.consultationProviderErrorStatus ?? null,
      consultationProviderErrorMessage: parsed.value.consultationProviderErrorMessage ?? null,
      voiceReplyTextLength: parsed.value.voiceReplyTextLength ?? null,
      consultationPromptTokens: parsed.value.consultationPromptTokens ?? null,
      consultationOutputTokens: parsed.value.consultationOutputTokens ?? null,
      consultationThinkingTokens: parsed.value.consultationThinkingTokens ?? null,
      consultationCachedTokens: parsed.value.consultationCachedTokens ?? null,
      consultationHistoryMessageCount: parsed.value.consultationHistoryMessageCount ?? null,
      consultationHistoryChars: parsed.value.consultationHistoryChars ?? null,
      consultationMemoryChars: parsed.value.consultationMemoryChars ?? null,
      consultationInputChars: parsed.value.consultationInputChars ?? null,
      consultationThinkingMode: parsed.value.consultationThinkingMode ?? null,
      ...parsed.value.summary,
    })}`,
  );

  return NextResponse.json({ recorded: true }, { status: 202 });
}
