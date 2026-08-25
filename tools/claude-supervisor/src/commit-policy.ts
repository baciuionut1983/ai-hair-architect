// Pure commit/push authorization + staging policy -- see this round's
// own task spec Phase 4: "Supervisor may allow a normal commit ONLY
// when contract explicitly contains: allowedOperations includes:
// 'commit'." v1.1's own types.ts doc comment called allowedOperations
// "documentation-only" -- this is the exact place that stops being true.
import type { TaskContract } from "./types.js";

export function isCommitAllowed(contract: TaskContract): boolean {
  return (contract.allowedOperations ?? []).includes("commit");
}

export function isPushAllowed(contract: TaskContract): boolean {
  return (contract.allowedOperations ?? []).includes("push");
}

// Deterministic, safe commit message -- never Claude-authored free text.
// The WHOLE string is passed as a single argv element to `git commit -m`
// (never a shell string), so it cannot inject additional git flags or
// shell syntax regardless of what `title`/`taskId` contain.
export function buildCommitMessage(contract: TaskContract): string {
  return `${contract.title}\n\nSupervisor task ${contract.taskId} -- automated commit after independent verification of required checks and scope.`;
}

// Never staged, regardless of task scope -- see this round's own task
// spec Phase 4's explicit "Never stage" list. Runtime/local-only
// artifacts and secrets are excluded even if a diff somehow listed them
// (defense in depth on top of .gitignore, which already excludes
// state/* and should already exclude any real .env file).
const NEVER_STAGE_PREFIXES = [".claude/", "tools/claude-supervisor/state/"];
const NEVER_STAGE_PATTERNS = [/(^|\/)\.env(\..+)?$/i, /(^|\/)secrets?(\/|\.|$)/i];

export interface StagingFilter {
  stageable: string[];
  blocked: string[];
}

// Pure filter: given the independently-captured changed-files list
// (never the executor's own claim), splits it into what may be staged
// and what must never be, regardless of what scope-guard.ts's own
// Level 1/2/3 classification already said -- this is a SEPARATE,
// unconditional floor, not a duplicate of scope enforcement.
export function filterStageableFiles(changedFiles: readonly string[]): StagingFilter {
  const stageable: string[] = [];
  const blocked: string[] = [];
  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, "/");
    const isBlocked = NEVER_STAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || NEVER_STAGE_PATTERNS.some((pattern) => pattern.test(normalized));
    (isBlocked ? blocked : stageable).push(file);
  }
  return { stageable, blocked };
}
