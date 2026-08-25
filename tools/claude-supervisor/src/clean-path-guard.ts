// Supervisor v1.3.1 -- clean-path precondition. Pure, fully tested.
//
// This round's own live clean-path isolation validation found that
// Claude Code's built-in "sensitive file" Write/Edit classifier fires
// nondeterministically whenever the working directory sits under an
// ancestor path segment literally named ".claude" (as this repo's own
// canonical checkout does: ~/.claude/projects/ai-hair-architect) -- and
// that the SAME real disposable create/edit/read/resume-edit cycle
// succeeds cleanly and deterministically once that segment is absent
// from the path. That is an operational precondition, not something the
// SDK enforces on its own, so Supervisor enforces it itself, fail-closed,
// before ever launching a real executor -- see cli.ts's own ACTIVE-mode
// startup sequence.

// Case-insensitive (Windows paths/drive letters are not case-sensitive,
// same reasoning as agent-sdk-permission-policy.ts's own isPathWithinCwd),
// and matches only an EXACT ".claude" path segment -- never a substring
// match against an unrelated name that merely contains "claude" (e.g. a
// real project directory legitimately named "claude-supervisor-fork"
// must never trip this).
export function containsClaudeDirSegment(candidatePath: string): boolean {
  const segments = candidatePath.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.some((segment) => segment.toLowerCase() === ".claude");
}
