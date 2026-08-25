// Pure decision logic for the check/CI-failure correction loop -- see
// this round's own task spec Phase 2 ("If a required check fails...
// send Claude Executor a FIXED correction prompt... resume SAME Claude
// session... rerun checks") and Phase 7 (the same mechanism for a
// Level-1 CI failure). Deliberately reuses restart-policy.ts's own
// MAX_CONSECUTIVE_RESTARTS/backoff (a check/CI failure that never
// converges after 3 attempts is the same class of risk that policy's
// own doc comment already reasons about) and detectNoProgressLoop (an
// identical failure fingerprint across attempts is exactly a diff-stat-
// style "no real progress" signal), rather than inventing a second,
// parallel bound.
import { decideRestart, detectNoProgressLoop, type RestartDecision } from "./restart-policy.js";

export interface CorrectionRequest {
  checkOrCiName: string;
  boundedFailureOutput: string;
}

const MAX_OUTPUT_CHARS_IN_PROMPT = 2_000;

// The FIXED correction prompt template -- never Claude's own free-form
// suggestion, never re-paraphrased per call (same "fixed instruction"
// discipline as claude-cli.ts's own RESUME_INSTRUCTION). Explicitly
// forbids scope expansion in the prompt text itself, on top of the
// independent, mechanical scope re-check the orchestrator performs
// after every correction resume (see orchestrator.ts's own
// runQualityGatesAndCommitPush).
export function buildCorrectionPrompt(request: CorrectionRequest): string {
  const output = request.boundedFailureOutput.trim();
  const bounded = output.length > MAX_OUTPUT_CHARS_IN_PROMPT ? output.slice(output.length - MAX_OUTPUT_CHARS_IN_PROMPT) : output;
  return [
    `The following check failed: ${request.checkOrCiName}`,
    "",
    "Failure output (bounded):",
    bounded,
    "",
    "Fix ONLY what is required to make this specific check pass, strictly within the previously approved task scope.",
    "Do not modify any protected area. Do not expand scope. Do not invent new requirements or new files outside the approved scope.",
  ].join("\n");
}

// Same bound/backoff as executor-interruption restarts -- see
// restart-policy.ts's own MAX_CONSECUTIVE_RESTARTS justification.
export function decideCorrectionAction(currentCorrectionCount: number): RestartDecision {
  return decideRestart(currentCorrectionCount);
}

// A normalized fingerprint of one failure -- whitespace-collapsed so
// trivial formatting differences (e.g. timestamp-prefixed log lines)
// don't mask a genuinely identical failure. Byte-identical fingerprints
// across consecutive attempts is treated as "no real progress",
// independent of the plain restart-count bound.
export function computeFailureFingerprint(checkOrCiName: string, boundedFailureOutput: string): string {
  return `${checkOrCiName}::${boundedFailureOutput.trim().replace(/\s+/g, " ")}`;
}

export function isRepeatedFailure(recentFingerprints: readonly (string | null)[]): boolean {
  return detectNoProgressLoop(recentFingerprints);
}
