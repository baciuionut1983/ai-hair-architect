// VOICE NEXT LEVEL, Phase D (2026-08-24): a single, pure, shared
// classification for "what happened on ONE real provider HTTP attempt" --
// reused identically by STT (teach-ai-panel-logic.ts), Consult AI
// (consultation-chat-service.ts), and TTS (voice-reply/route.ts) so a
// production report can compare attempt-level outcomes across all three
// pipelines with one shared vocabulary, rather than three independently
// invented ones that could drift.
//
// Real production evidence this exists for (Phase D task): two real
// failures (a Consult AI PROVIDER_TIMEOUT after providerAttemptCount=2,
// consultationTotalMs~=59435ms; a TTS VOICE_REPLY_TIMEOUT after
// providerAttemptCount=2) both showed only an AGGREGATE total duration --
// no way to tell, from existing telemetry alone, whether attempt 1 or
// attempt 2 (or both) actually timed out, or how long each one indiv
// -idually took. Root cause, confirmed by reading the code (not guessed):
// consultation-chat-service.ts already computes a per-attempt duration
// (failedFirstAttemptMs) for a FAILED first attempt, but only ever
// returns/logs it on the branch where the SECOND attempt then succeeds --
// the branch where BOTH attempts fail (exactly Case 1's own shape)
// discards it entirely; nothing in the codebase measures attempt 2's own
// duration/outcome/status at all, on either provider. voice-reply/route.ts
// has the identical shape.
//
// Outcome enum: the Phase D task itself suggested "success, timeout,
// http_429, http_5xx, network_error, abort, invalid_response" as
// illustrative ("distinguish outcomes such as") examples, with the
// explicit instruction to use "the smallest truthful enum supported by
// the REAL implementation" -- not to invent every theoretically possible
// value. Two adjustments were made deliberately, both evidence-based:
//   - "abort" (a deliberate, non-timeout cancellation) is NOT included:
//     every one of the three pipelines' own AbortController is ONLY ever
//     aborted by that same call's own timeout firing (confirmed by
//     reading consultation-chat-provider-gemini.ts's respond(),
//     tts-provider-gemini.ts's synthesize(), and teach-ai-panel-logic.ts's
//     attemptUpload() -- none of the three ever calls .abort() from
//     anywhere else in the current codebase; Consult AI's own
//     `outerSignal` parameter exists as a forward-compatible seam but
//     nothing in this codebase ever triggers it today). Since "timeout"
//     already covers every real abort this implementation can produce,
//     adding a separate, currently-unreachable "abort" value would not be
//     truthful to what the real implementation supports -- it would be
//     dead code with no test able to exercise it honestly.
//   - "http_error" (a NEW, minimal addition beyond the task's own list) IS
//     included: all three providers can genuinely return a real,
//     classified HTTP failure that is neither 429 nor >=500 (e.g. Gemini
//     401/403 auth failure, mapped to NOT_CONFIGURED; a 400-class
//     rejection) -- a real, reachable code path
//     (GeminiConsultationChatProvider.classifyError /
//     classifyTtsError's own NOT_CONFIGURED branches), just not one of
//     the four HTTP-status buckets the task's own illustrative list named.
//     Folding it into "invalid_response" would be untruthful (the
//     response was not malformed, it was correctly-shaped but rejected);
//     folding it into "network_error" would be untruthful (a real HTTP
//     response WAS received). A dedicated bucket is the smallest truthful
//     option, not a speculative addition.
export type ProviderAttemptOutcome =
  | "success"
  | "timeout"
  | "http_429"
  | "http_5xx"
  | "http_error"
  | "network_error"
  | "invalid_response";

export interface ClassifyProviderAttemptOutcomeInput {
  succeeded: boolean;
  // True only when THIS attempt's own AbortController fired because its
  // own timeoutMs elapsed -- never inferred from "some request somewhere
  // was slow", always read directly from the real signal.aborted flag at
  // the exact call site (see each integration's own call to this
  // function).
  timedOut: boolean;
  // The real HTTP status a response actually carried, when one was
  // genuinely received -- undefined whenever no HTTP response exists at
  // all (a network-level failure, or the request never completing before
  // its own timeout fired).
  httpStatus?: number;
  // True only when the failure is specifically "the response body could
  // not be parsed/understood" (malformed JSON, an empty/invalid provider
  // payload) -- distinct from a network failure (no response at all) or
  // an HTTP error status (a real, well-formed rejection).
  invalidResponse?: boolean;
}

// Precedence, deliberately fixed and total (every real call site's inputs
// resolve to exactly one bucket, never ambiguous): success first (nothing
// else matters once the attempt genuinely succeeded); timeout next (a
// timed-out attempt has no real HTTP status to report, even if some
// partial response data existed); then a real HTTP ERROR status, most
// specific bucket first (429, then >=500, then any other real >=400
// status); then invalid_response (a response existed and was read --
// deliberately checked AFTER error-status buckets, since a real 429/5xx
// classification is more informative than a generic parse failure, but
// BEFORE the final catch-all, since a 2xx status whose body could not be
// used -- e.g. malformed JSON -- must never be misreported as
// "http_error", a name that specifically implies an HTTP-level rejection
// occurred); network_error is the final, catch-all truth for "no usable
// response and not a timeout" -- a genuine connection-level failure.
export function classifyProviderAttemptOutcome(input: ClassifyProviderAttemptOutcomeInput): ProviderAttemptOutcome {
  if (input.succeeded) return "success";
  if (input.timedOut) return "timeout";
  if (input.httpStatus === 429) return "http_429";
  if (typeof input.httpStatus === "number" && input.httpStatus >= 500) return "http_5xx";
  if (typeof input.httpStatus === "number" && input.httpStatus >= 400) return "http_error";
  if (input.invalidResponse) return "invalid_response";
  return "network_error";
}

// One real attempt's own timing/outcome/status -- the exact shape
// threaded through all three pipelines' own telemetry (see
// voice-latency-logic.ts's own sttAttempt1Ms/consultationAttempt1Ms/
// ttsAttempt1Ms field families, all built from this same shape).
export interface ProviderAttemptTelemetry {
  ms: number;
  outcome: ProviderAttemptOutcome;
  httpStatus?: number;
}
