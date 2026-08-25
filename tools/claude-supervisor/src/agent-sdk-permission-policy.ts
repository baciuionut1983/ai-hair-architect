// Supervisor v1.3 -- Agent SDK executor permission policy. Pure, fully
// tested: decides exactly which tools the SDK-driven executor may use.
// This is a POLICY layer only -- see this package's own top-level
// architectural rule (v1.3's own task spec): the SDK executor is never
// the security authority. Everything here is defense-in-depth on top of
// the real boundary, which remains scope-guard.ts's own independent
// post-hoc git-diff classification.
//
// Tool set is the literal minimum this round's task spec names in its
// own Phase 3 ("At minimum: Read, Write, Edit"), confirmed with the user
// rather than silently widened -- no Glob/Grep, no Bash. Widening this
// later (e.g. for a real task that needs repo-wide exploration) is a
// one-line, separately-reviewable change to EXECUTOR_ALLOWED_TOOLS, not
// a redesign of this module.
//
// CRITICAL, empirically-discovered behavior this design accounts for
// (see this round's own live probe `write-probe.mjs`, which produced a
// real runtime warning: CLAUDE_SDK_CAN_USE_TOOL_SHADOWED): a bare tool
// name in `allowedTools` auto-approves BEFORE `canUseTool` is ever
// consulted. So `createExecutorCanUseTool` below is never the primary
// gate for Read/Write/Edit -- those are auto-approved by allowedTools
// directly. It is the FAIL-CLOSED BACKSTOP for any tool name not already
// covered by allowedTools/disallowedTools (e.g. a future SDK version
// that adds a new built-in tool this policy hasn't been updated for
// yet) -- "unknown tool -> denied" is made true here, not assumed.
import type { CanUseTool, PermissionMode } from "@anthropic-ai/claude-agent-sdk";

export const EXECUTOR_ALLOWED_TOOLS = ["Read", "Write", "Edit"] as const;

// Explicit, not exhaustive -- see the doc comment above: canUseTool's
// fail-closed default is what actually guarantees "anything else is
// denied," this list only makes the denial happen without ever reaching
// the model (removed from its context entirely) for the specific tools
// this round's task spec calls out by name. `Task` is included
// deliberately: a spawned subagent could otherwise carry its own,
// separately-configured tool grant, which would silently widen this
// policy's own guarantee.
export const EXECUTOR_DISALLOWED_TOOLS = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"] as const;

// Never "acceptEdits", never "bypassPermissions" -- this round's task
// spec explicitly forbids bypassPermissions, and "acceptEdits" is the
// exact mode the CLI transport already proved unreliable for real
// Write/Edit enforcement in non-interactive mode (see claude-cli.ts's
// own doc comment). "default" plus an explicit allowedTools/canUseTool
// pair does not depend on that prompt-based auto-accept behavior at all.
export const EXECUTOR_PERMISSION_MODE: PermissionMode = "default";

const ALLOWED_TOOL_SET: ReadonlySet<string> = new Set(EXECUTOR_ALLOWED_TOOLS);

// Fail-closed: only ever returns "allow" for a tool name in
// EXECUTOR_ALLOWED_TOOLS. Every other tool name -- known-disallowed or
// entirely unrecognized -- is denied with a fixed, non-negotiable
// message (never echoing arbitrary executor-controlled input back into
// the denial reason).
export function createExecutorCanUseTool(): CanUseTool {
  return async (toolName) => {
    if (ALLOWED_TOOL_SET.has(toolName)) {
      return { behavior: "allow" };
    }
    return {
      behavior: "deny",
      message: `${toolName} is not permitted for this Supervisor-managed executor session. Only Read, Write, and Edit are allowed.`,
    };
  };
}
