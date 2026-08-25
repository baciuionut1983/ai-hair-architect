// Supervisor v1.3 -- real Agent SDK executor transport. Thin,
// deliberately under-tested glue (same "pure logic vs. real-I/O glue"
// split this whole package already uses everywhere else -- see
// claude-cli.ts's own top-level doc comment): a real `query()` call
// cannot be meaningfully mocked without re-implementing the SDK itself,
// so this boundary is verified by a real live smoke test instead (see
// this round's own final report). All of the actual DECISION logic
// (permission policy, message-to-outcome reduction) lives in
// agent-sdk-permission-policy.ts / agent-sdk-events.ts, both fully unit
// tested with fakes, imported here rather than duplicated.
import { AbortError, query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { RESUME_INSTRUCTION } from "./claude-cli.js";
import { reduceSdkOutcome } from "./agent-sdk-events.js";
import { createExecutorCanUseTool, EXECUTOR_ALLOWED_TOOLS, EXECUTOR_DISALLOWED_TOOLS, EXECUTOR_PERMISSION_MODE } from "./agent-sdk-permission-policy.js";
import type { ExecutorLauncher } from "./orchestrator.js";
import { normalizeWindowsCwd } from "./real-executor-launcher.js";
import type { ExecutorOutcome } from "./stream-events.js";

export interface AgentSdkExecutorLauncher extends ExecutorLauncher {
  // Phase 2's own required capability. See this round's own final
  // report / the approved plan's "Decisions confirmed with the user":
  // implemented and unit-tested here, deliberately NOT wired into any
  // orchestrator.ts call site in this round -- no such trigger exists
  // for the CLI transport either, and adding one is new orchestrator
  // behavior beyond "migrate the transport."
  cancel(sessionId: string): void;
}

type SessionSelector = { sessionId: string } | { resume: string };

async function runQuery(prompt: string, cwd: string, sessionSelector: SessionSelector, abortController: AbortController): Promise<ExecutorOutcome> {
  const messages: SDKMessage[] = [];
  let transportError: string | null = null;
  let wasCancelled = false;

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: normalizeWindowsCwd(cwd),
        ...sessionSelector,
        allowedTools: [...EXECUTOR_ALLOWED_TOOLS],
        disallowedTools: [...EXECUTOR_DISALLOWED_TOOLS],
        canUseTool: createExecutorCanUseTool(),
        permissionMode: EXECUTOR_PERMISSION_MODE,
        abortController,
      },
    })) {
      messages.push(message);
    }
  } catch (err) {
    // Empirically confirmed live (this round's own resume-probe.mjs
    // stack trace): an error-subtype result does not just get yielded --
    // the async generator THROWS on its next pull. Every messages
    // already yielded before the throw are still in `messages` above,
    // so reduceSdkOutcome can still find the terminal result message
    // among them; this catch only needs to record what stopped
    // iteration, never re-derive the outcome itself.
    if (err instanceof AbortError) {
      wasCancelled = true;
    } else {
      transportError = err instanceof Error ? err.message : String(err);
    }
  }

  return reduceSdkOutcome({ messages, transportError, wasCancelled });
}

export function createAgentSdkExecutorLauncher(): AgentSdkExecutorLauncher {
  const abortControllers = new Map<string, AbortController>();

  async function runForSession(sessionId: string, prompt: string, cwd: string, sessionSelector: SessionSelector): Promise<ExecutorOutcome> {
    const controller = new AbortController();
    abortControllers.set(sessionId, controller);
    try {
      return await runQuery(prompt, cwd, sessionSelector, controller);
    } finally {
      abortControllers.delete(sessionId);
    }
  }

  return {
    launch(sessionId, prompt, cwd) {
      return runForSession(sessionId, prompt, cwd, { sessionId });
    },
    resume(sessionId, cwd, prompt = RESUME_INSTRUCTION) {
      return runForSession(sessionId, prompt, cwd, { resume: sessionId });
    },
    cancel(sessionId) {
      abortControllers.get(sessionId)?.abort();
    },
  };
}
