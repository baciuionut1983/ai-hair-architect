// Pure, independent pre-commit review -- see this round's own task spec
// Phase 3: verify a fixed list of conditions using only real,
// independently-gathered facts (never the executor's own narrative)
// BEFORE any commit action is even attempted. Produces an IMMUTABLE
// ReviewRecord (plain data, never mutated after creation) the
// orchestrator logs verbatim -- "If any condition fails: NO COMMIT" is
// enforced by the caller checking `.ok`, never by this function itself
// performing any action.
import { classifyDiff } from "./scope-guard.js";
import { isSameContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";

export interface PreCommitReviewInput {
  contractAtLaunch: TaskContract;
  contractNow: TaskContract;
  expectedHeadSha: string;
  actualHeadSha: string;
  changedFiles: readonly string[];
  // Real `git status --short` lines, for the untracked-file and
  // .claude/-untouched checks.
  statusLines: readonly string[];
  allowedUntrackedPrefixes: readonly string[];
  checksAllPassed: boolean;
}

export interface ReviewCondition {
  name: string;
  passed: boolean;
  detail: string;
}

export interface ReviewRecord {
  timestamp: string;
  ok: boolean;
  conditions: readonly ReviewCondition[];
}

function isUntrackedLine(line: string): string | null {
  if (!line.startsWith("??")) return null;
  return line.slice(2).trim();
}

export function runPreCommitReview(input: PreCommitReviewInput, now: () => string): ReviewRecord {
  const conditions: ReviewCondition[] = [];

  conditions.push({
    name: "contract_unchanged",
    passed: isSameContract(input.contractAtLaunch, input.contractNow),
    detail: "the approved task contract must be byte-identical to the one launched under",
  });

  conditions.push({
    name: "head_matches_expected",
    passed: input.expectedHeadSha === input.actualHeadSha,
    detail: `expected ${input.expectedHeadSha}, actual ${input.actualHeadSha}`,
  });

  const classification = classifyDiff(input.changedFiles, input.contractNow.protectedAreas);
  conditions.push({
    name: "no_protected_files_touched",
    passed: classification.level === "LEVEL_1_AUTO_CONTINUE",
    detail: classification.violations.length > 0 ? classification.violations.map((v) => `${v.file} (${v.matchedArea})`).join(", ") : "none",
  });
  conditions.push({
    name: "no_level3_files_touched",
    passed: !classification.violations.some((v) => v.level === "LEVEL_3_HARD_STOP"),
    detail: classification.violations.filter((v) => v.level === "LEVEL_3_HARD_STOP").map((v) => v.file).join(", ") || "none",
  });

  conditions.push({
    name: "required_checks_all_passed",
    passed: input.checksAllPassed,
    detail: input.checksAllPassed ? "all required checks passed" : "at least one required check did not pass",
  });

  const unexpectedUntracked = input.statusLines
    .map((line) => isUntrackedLine(line))
    .filter((path): path is string => path !== null)
    .filter((path) => !input.allowedUntrackedPrefixes.some((prefix) => path.startsWith(prefix)));
  conditions.push({
    name: "no_unexpected_untracked_files",
    passed: unexpectedUntracked.length === 0,
    detail: unexpectedUntracked.length > 0 ? unexpectedUntracked.join(", ") : "none",
  });

  // Only a TRACKED change (modified/added/deleted/staged) to .claude/ is
  // a violation here -- .claude/ showing up as a plain UNTRACKED ("??")
  // entry is this whole project's own established, expected state (see
  // ALLOWED_UNTRACKED_PREFIXES in cli.ts) and must never be flagged.
  const claudeDirTouched = input.statusLines.some((line) => {
    if (isUntrackedLine(line) !== null) return false;
    const path = line.slice(2).trim();
    return path.startsWith(".claude/") || path === ".claude";
  });
  conditions.push({
    name: "claude_dir_untouched",
    passed: !claudeDirTouched,
    detail: claudeDirTouched ? "a TRACKED change to .claude/ appeared in git status" : "untouched (or only present as an expected untracked entry)",
  });

  return { timestamp: now(), ok: conditions.every((c) => c.passed), conditions };
}
