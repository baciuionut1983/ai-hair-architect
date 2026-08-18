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
      ...parsed.value.summary,
    })}`,
  );

  return NextResponse.json({ recorded: true }, { status: 202 });
}
