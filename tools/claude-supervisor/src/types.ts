// Supervisor Agent v1 -- shared type definitions. Pure types only, zero
// runtime logic here, so every other module in this package can import
// from a single, stable source without a dependency cycle.
//
// SCOPE REMINDER (see this package's own top-level doc comment): this is
// LOCAL DEV INFRASTRUCTURE for watching a Claude Code coding session on
// this repo. It is never imported by web/, never bundled, never deployed.

// The immutable contract for one task the Supervisor is asked to watch
// over. Treated as read-only for the entire lifetime of a task run --
// see state-machine.ts's own doc comment for why a contract change
// mid-run is always a HARD_STOP, never a silent merge.
export interface TaskContract {
  taskId: string;
  title: string;
  // The EXACT prompt text the human approved for the executor -- the
  // Supervisor never rewrites or paraphrases this; it is passed to
  // Claude Code verbatim on first launch, and only ever combined with a
  // resume message (never a replacement) on continuation.
  approvedPrompt: string;
  // Free-text description of what this task is allowed to touch --
  // informational for humans reading the contract; scope ENFORCEMENT
  // itself is done via protectedAreas (below), not this field, since
  // "in scope" is usually easier to say honestly than to enumerate
  // exhaustively, while "never touch this" is enumerable and checkable.
  scope: string[];
  // Glob-style patterns (see scope-guard.ts's own doc comment for the
  // exact matching semantics) that must NEVER appear in a changed-files
  // list for this task. A match is always at least a Level 2 pause, and
  // for a fixed set of especially sensitive areas (billing/auth/
  // migrations/CI config), always a Level 3 hard stop -- see
  // scope-guard.ts's own HARD_STOP_AREAS.
  protectedAreas: string[];
  // Commands the Supervisor itself will run to independently verify the
  // executor's own claims -- never taken from the executor's own output,
  // always from this fixed, human-approved list. Free-text labels (e.g.
  // "tsc", "eslint", "vitest", "build") resolved to real, fixed-argv
  // commands by safe-exec.ts's own COMMAND_REGISTRY -- never an
  // arbitrary shell string.
  requiredChecks: RequiredCheckName[];
  // Documentation-only, for the human reading the contract -- mirrors
  // protectedAreas/requiredChecks in spirit but is never itself
  // mechanically enforced (only protectedAreas is pattern-matched
  // against the real diff).
  allowedOperations?: string[];
  forbiddenOperations?: string[];
  createdAt: string;
}

export type RequiredCheckName = "tsc" | "eslint" | "vitest" | "build" | "ci";

export interface TaskContractValidationOk {
  ok: true;
  contract: TaskContract;
}

export interface TaskContractValidationError {
  ok: false;
  reason: string;
}

export type TaskContractValidationResult = TaskContractValidationOk | TaskContractValidationError;

// The Supervisor's own explicit state machine -- see state-machine.ts's
// own doc comment for the full transition table. Named exactly per this
// round's own task spec, so a human reading a persisted state file
// recognizes it immediately against the task's own requested list.
export type SupervisorState =
  | "IDLE"
  | "TASK_RECEIVED"
  | "PREFLIGHT"
  | "EXECUTOR_RUNNING"
  | "EXECUTOR_INTERRUPTED"
  | "RESUMING"
  | "TECHNICAL_REVIEW"
  | "CHECKS_RUNNING"
  | "COMMIT_READY"
  | "PUSHED"
  | "CI_WAITING"
  | "CI_FAILED"
  | "WAITING_FOR_HUMAN"
  | "COMPLETED"
  | "ESCALATED"
  | "HARD_STOP";

// The decision level a given observation resolves to -- see
// scope-guard.ts's own doc comment for exactly how each is derived, and
// this package's own README-equivalent (the final report) for the
// canonical examples of each level from the task spec.
export type DecisionLevel = "LEVEL_1_AUTO_CONTINUE" | "LEVEL_2_REVIEW_REQUIRED" | "LEVEL_3_HARD_STOP";

// Every fact the Supervisor persists about one task run -- see
// persistence.ts's own doc comment for the "never store secrets"
// contract this shape is designed around: every field here is either a
// public git fact (a SHA, a file path, a diff stat count) or the
// Supervisor's own bookkeeping (state, counters, timestamps) -- never a
// token, credential, or raw API response body.
export interface SupervisorRunState {
  taskId: string;
  state: SupervisorState;
  // The Claude Code session id this task is bound to, once launched --
  // see claude-cli.ts's own doc comment for why this is PRE-ASSIGNED by
  // the Supervisor (via --session-id) rather than discovered after the
  // fact.
  executorSessionId: string | null;
  restartCount: number;
  lastKnownHeadSha: string | null;
  // A short, human-readable summary (e.g. "M files changed, N
  // insertions(+), N deletions(-)") -- never the full diff body, which
  // could be large and is always re-derivable live from git itself when
  // actually needed.
  lastDiffSummary: string | null;
  createdAt: string;
  updatedAt: string;
  // The single most recent action the Supervisor itself took, for a
  // human skimming the state file to understand "what just happened"
  // without replaying the full log.
  lastAction: string;
}

// One line of the Supervisor's own structured log -- see logger.ts's own
// doc comment for the redaction contract.
export interface SupervisorLogEntry {
  taskId: string;
  state: SupervisorState;
  executorSession: string | null;
  action: string;
  result: string;
  timestamp: string;
}
