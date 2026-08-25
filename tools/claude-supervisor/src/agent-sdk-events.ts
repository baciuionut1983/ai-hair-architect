// Supervisor v1.3 -- Agent SDK message reduction. Pure, fully tested:
// the SDK-transport sibling of stream-events.ts. No JSON-line parsing is
// needed here (the SDK hands back real, already-typed message objects
// off its async generator), so this module's job is narrower than
// stream-events.ts's own: fold a collected sequence of SDKMessage
// objects (plus whatever the caller observed independently: a caught
// exception, a deliberate cancellation) into the EXISTING, UNCHANGED
// ExecutorOutcome shape orchestrator.ts already consumes -- so
// orchestrator.ts/decide-next-action.ts/state-machine.ts need zero
// changes for this transport migration.
//
// EMPIRICALLY-REQUIRED CALLER CONTRACT (see this round's own live probe
// `resume-probe.mjs`, a real captured stack trace): when a turn ends on
// an error-subtype result, the SDK's async generator does not just
// yield that result message -- it then THROWS a real exception on the
// next pull. The caller (agent-sdk-executor-launcher.ts) MUST wrap its
// `for await` loop in try/catch, collect whatever messages were yielded
// BEFORE the throw, and pass the caught error's message in as
// `transportError` here. This mirrors stream-events.ts's own
// combineExecutorResult: enrich "incomplete" with independent signals,
// never let the reducer itself throw.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { ExecutorOutcome, SdkOutcomeKind } from "./stream-events.js";

export interface ReduceSdkOutcomeInput {
  messages: readonly SDKMessage[];
  // Set when the caller's own try/catch around the async generator
  // caught something. `wasCancelled` distinguishes a deliberate abort
  // (this package's own cancel(), see agent-sdk-executor-launcher.ts)
  // from every other transport failure -- the SDK's own AbortError
  // class is how the caller tells these apart before calling in here.
  transportError: string | null;
  wasCancelled: boolean;
}

function isResultMessage(message: SDKMessage): message is Extract<SDKMessage, { type: "result" }> {
  return message.type === "result";
}

// Reduces a full sequence of SDK messages (everything yielded for one
// launch/resume attempt, in order) to a single ExecutorOutcome. A
// `result` message is the CLI's own documented turn-complete signal
// ("The CLI emits exactly one result message per turn"); this takes the
// LAST one observed, matching stream-events.ts's own
// reduceExecutorOutcome convention (defensive against any future
// multi-turn shape, never assumes exactly one).
export function reduceSdkOutcome(input: ReduceSdkOutcomeInput): ExecutorOutcome {
  let sessionId: string | null = null;
  let apiRetryCount = 0;
  let permissionDenialCount = 0;

  for (const message of input.messages) {
    if (message.type === "system" && message.subtype === "init") sessionId = message.session_id;
    if (message.type === "system" && message.subtype === "api_retry") apiRetryCount += 1;
    if (message.type === "system" && message.subtype === "permission_denied") permissionDenialCount += 1;
  }

  const lastResult = [...input.messages].reverse().find(isResultMessage);
  if (lastResult) {
    sessionId = lastResult.session_id;
    permissionDenialCount += lastResult.permission_denials.length;
  }

  if (input.wasCancelled) {
    return {
      status: "incomplete",
      detail: "executor session was cancelled",
      sessionId,
      apiRetryCount,
      outcomeKind: "cancelled",
      permissionDenialCount,
    };
  }

  if (lastResult) {
    if (lastResult.subtype === "success") {
      return {
        status: "completed_success",
        detail: "result message with subtype success",
        sessionId,
        apiRetryCount,
        outcomeKind: "success",
        permissionDenialCount,
      };
    }
    return {
      status: "completed_error",
      detail: `result message with subtype ${lastResult.subtype}`,
      sessionId,
      apiRetryCount,
      outcomeKind: "executor_error",
      permissionDenialCount,
    };
  }

  // No result message was ever observed -- exactly the "incomplete" case
  // stream-events.ts's own doc comment describes: a dropped transport,
  // never confused with a clean failure the executor itself reported
  // (that would BE a result message, just non-success).
  const details: string[] = ["no result message observed before the stream ended"];
  if (input.transportError !== null) details.push(`transport exception: ${input.transportError}`);
  const outcomeKind: SdkOutcomeKind = permissionDenialCount > 0 && input.messages.length <= 2 ? "permission_denied_only" : input.transportError !== null ? "transport_error" : "malformed";
  return {
    status: "incomplete",
    detail: details.join("; "),
    sessionId,
    apiRetryCount,
    outcomeKind,
    permissionDenialCount,
  };
}
