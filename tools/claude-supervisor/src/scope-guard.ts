// Pure scope enforcement: given the REAL list of changed files (from
// git, never from the executor's own narrative) and a TaskContract's own
// protectedAreas, decide the DecisionLevel this run resolves to. This is
// the module scope-guard-related tests exercise directly -- see this
// package's own README-equivalent (the final report) for the canonical
// LEVEL 1/2/3 examples this implementation is built from.
//
// Matching semantics: a protectedAreas entry matches a changed file path
// if the path CONTAINS the entry as a case-insensitive substring, OR the
// entry is a glob-like pattern (contains "*") matched via a minimal,
// dependency-free glob-to-regex translation (only "*" as "any run of
// characters", "**" is treated identically to "*" -- this package
// deliberately has zero dependencies, so no real glob library). This is
// intentionally permissive-to-match (a substring match can over-trigger)
// rather than permissive-to-miss (a stricter matcher could under-trigger
// and silently let a real protected-area edit through) -- a false
// Level-2-pause that a human dismisses in ten seconds is categorically
// safer than a missed scope violation that ships.
import type { DecisionLevel, RequiredCheckName } from "./types.js";

// Areas that are ALWAYS Level 3 (hard stop), regardless of what the
// task's own contract says -- see this round's own task spec's "Similar
// pentru: billing; auth; migrations; infrastructure; protected features"
// -- these are treated as a standing, contract-independent floor, not
// something a single task's protectedAreas list could accidentally omit
// and thereby weaken. Matched the same substring/glob way as
// protectedAreas itself.
export const HARD_STOP_AREAS: readonly string[] = [
  "billing",
  "webhook",
  "stripe",
  "auth",
  "session-request-auth",
  "prisma/migrations",
  ".github/workflows",
  ".env",
];

// File-path FRAGMENTS that always indicate a destructive git/shell
// operation was attempted, independent of any file diff -- used by
// classifyOperation below (see its own doc comment) for the "requested
// operation" half of Level 3, distinct from the "changed file" half
// scope-guard's own classifyDiff handles.
const DESTRUCTIVE_OPERATION_PATTERNS: readonly RegExp[] = [
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+push\s+.*-f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+branch\s+-D\b/i,
  /\bgit\s+filter-branch\b/i,
  /\brebase\s+-i\b/i,
  /\brm\s+-rf\s+\/(?!tmp\/)/i,
];

function normalize(pathOrPattern: string): string {
  return pathOrPattern.toLowerCase().replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*+/g, ".*");
  return new RegExp(`^${escaped}$|/${escaped}$|${escaped}/`, "i");
}

// A protectedAreas entry is very often an ABSTRACT CONCEPT NAME (this
// round's own task spec's own example: `protectedAreas: ["VAD",
// "billing", "auth"]`), not a literal path fragment -- "VAD" is never
// itself a substring of the real file that implements it
// (voice-activity-logic.ts, silero-start-gate-logic.ts, etc.). A bare
// substring match alone would therefore silently miss the exact example
// the task spec itself gives, which would be a genuinely dangerous
// failure mode for a scope-enforcement module. This is a small, curated,
// HAND-VERIFIED dictionary of concept name -> real path fragments,
// built directly from this project's own real file layout (confirmed by
// reading the actual repo during this round's own audit, not guessed) --
// deliberately NOT a generic fuzzy-matching heuristic, since a wrong
// guess here fails exactly the way this module's own doc comment already
// commits to (permissive-to-match, never permissive-to-miss) only for
// entries verified against the real repo, while an UNLISTED concept name
// still falls back to the plain substring match below (so a task author
// naming a real path fragment directly, e.g. "billing-repository", still
// works with zero aliasing needed).
const CONCEPT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  vad: [
    "voice-activity-logic",
    "silero-start-gate-logic",
    "silero-continuation-gate-logic",
    "silero-vad-shadow-logic",
    "silero-vad-shadow-runtime",
    "use-voice-recording",
    "vad-models",
    "async-singleton-cache",
  ],
  billing: ["billing", "stripe", "webhook"],
  auth: ["auth", "session-request-auth"],
  migrations: ["prisma/migrations"],
  ci: [".github/workflows"],
};

function matchesArea(filePath: string, area: string): boolean {
  const normalizedPath = normalize(filePath);
  const normalizedArea = normalize(area);

  const aliases = CONCEPT_ALIASES[normalizedArea];
  if (aliases && aliases.some((alias) => normalizedPath.includes(alias))) {
    return true;
  }

  if (normalizedArea.includes("*")) {
    return globToRegExp(normalizedArea).test(normalizedPath) || normalizedPath.includes(normalizedArea.replace(/\*/g, ""));
  }
  return normalizedPath.includes(normalizedArea);
}

export interface ScopeViolation {
  file: string;
  matchedArea: string;
  level: DecisionLevel;
}

export interface ScopeClassification {
  level: DecisionLevel;
  violations: ScopeViolation[];
  // The subset of requiredChecks (from the task contract) this
  // classification result has NOT yet verified -- purely informational,
  // populated by the caller (technical-review.ts), never computed here;
  // present in the type for callers that want one shape to carry both.
}

// Classifies a real, git-derived list of changed file paths against the
// task's own protectedAreas plus the standing HARD_STOP_AREAS floor.
// Returns the MOST SEVERE level found across every changed file, plus
// every individual violation (so a human reviewing a pause/stop sees
// exactly which files triggered it, not just the worst one).
export function classifyDiff(changedFiles: readonly string[], protectedAreas: readonly string[]): ScopeClassification {
  const violations: ScopeViolation[] = [];

  for (const file of changedFiles) {
    for (const hardStopArea of HARD_STOP_AREAS) {
      if (matchesArea(file, hardStopArea)) {
        violations.push({ file, matchedArea: hardStopArea, level: "LEVEL_3_HARD_STOP" });
      }
    }
    for (const area of protectedAreas) {
      if (matchesArea(file, area)) {
        violations.push({ file, matchedArea: area, level: "LEVEL_2_REVIEW_REQUIRED" });
      }
    }
  }

  if (violations.some((v) => v.level === "LEVEL_3_HARD_STOP")) {
    return { level: "LEVEL_3_HARD_STOP", violations };
  }
  if (violations.length > 0) {
    return { level: "LEVEL_2_REVIEW_REQUIRED", violations };
  }
  return { level: "LEVEL_1_AUTO_CONTINUE", violations: [] };
}

// Classifies a REQUESTED shell/git operation string (e.g. one line the
// Supervisor is about to consider running, or one it observed the
// executor's own tool-call stream requesting) as destructive or not --
// completely independent of file-diff scope (a destructive git command
// can be requested without touching any tracked file at all, e.g. `git
// reset --hard`). Never itself EXECUTES the string -- see safe-exec.ts's
// own doc comment for why the Supervisor never evaluates arbitrary text
// as a command.
export function classifyOperation(commandText: string): DecisionLevel {
  return DESTRUCTIVE_OPERATION_PATTERNS.some((pattern) => pattern.test(commandText))
    ? "LEVEL_3_HARD_STOP"
    : "LEVEL_1_AUTO_CONTINUE";
}

// New-dependency / new-env-var / new-feature-flag detection -- Level 2
// per this round's own task spec ("dependency nou; ... env var nou;
// feature flag nou"). Deliberately narrow, pattern-based (not a real
// package.json/AST diff) -- a false positive here just means an
// unnecessary pause, never a missed one, matching this module's own
// stated "permissive-to-match" bias.
const LEVEL_2_FILE_PATTERNS: readonly RegExp[] = [/package\.json$/i, /package-lock\.json$/i, /\.env\.example$/i];

export function containsLevel2FilePattern(changedFiles: readonly string[]): string[] {
  return changedFiles.filter((file) => LEVEL_2_FILE_PATTERNS.some((pattern) => pattern.test(file)));
}

export function summarizeRequiredChecks(checks: readonly RequiredCheckName[]): string {
  return checks.join(", ");
}
