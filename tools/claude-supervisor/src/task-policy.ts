// Versioned code-owned policies. No report/prose can supply scope or permissions.
import type { ProjectState } from "./project-state.js";
import type { RequiredCheckName } from "./types.js";
export const TASK_POLICY_VERSION = 1;
export interface TaskPolicy {
  scope: string[]; protectedAreas: string[]; allowed: string[]; forbidden: string[];
  checks: RequiredCheckName[]; acceptance: string[]; verdicts: string[];
}
export function taskPolicy(s: ProjectState): TaskPolicy | null {
  const { actor, taskType, taskId } = s.next;
  const forbidden = ["push", "PROJECT_STATE mutation", "bootstrap", "product B", "T1.6.2.d", "Railway", "database", "provider calls", "agent dispatch", "dependency changes"];
  const protectedAreas = ["docs/PROJECT_STATE.json", "web/**", "prisma/**", ".github/**", "**/railway*", "**/Dockerfile*", "**/package.json", "**/*lock*", "**/.env*", "production configuration"];
  if (actor === "CODEX" && taskType === "IMPLEMENTATION" && taskId === "ORCH-B3-IMPL-001" && s.operational.phase === "PHASE_B_3") {
    return { scope: ["tools/claude-supervisor/**"], protectedAreas,
      allowed: ["read required Supervisor source", "edit approved Supervisor scope", "add/update Supervisor tests", "run Supervisor checks", "git diff --check", "commit"], forbidden,
      checks: ["supervisor_test", "supervisor_typecheck", "supervisor_lint", "supervisor_build"],
      acceptance: [
        "One package-local CLI: project status, next-task, ingest-report, refresh-evidence and read-only push eligibility; no daemon or dispatch.",
        "Status is data-derived: milestone/phase/status/revision, repository/CI/production evidence, roadmap, blockers/deferred, next actor/task/type, human gate, activeTask and lastTask.",
        "Reuse TaskContract and the existing check registry. Render the task from its contract, with a terminal B.2a footer requirement. Same state, Git observation and versioned policy produce identical output.",
        "Scope comes only from code-owned task policies. Unknown policy/baseline, mismatched repository/HEAD/remote, dirty tracked tree or blockers fail closed; HUMAN gets a decision card and CI/RAILWAY get wait views.",
        "Use independently observed Git for executable baselines; never substitute UNKNOWN stored repository evidence. status/next-task never fetch by default; explicit refresh may fetch once with bounds.",
        "ingest-report accepts exactly one stdin/file source, calls the reviewed updater once, returns nonzero on failure and refreshed status on success/duplicate; no retry or second writer.",
        "Reuse Git/CI helpers for bounded read-only observations. Errors/rate limits mean UNKNOWN. Railway GitHub checks are partial deployment evidence, never runtime/migration health. Never persist machine evidence or accept it in raw reports.",
        "Assess push without executing it: require current human push gate, represented review GO, clean tracked tree, fresh trusted Git and consistent approved SHA relationship; otherwise NO/UNKNOWN with reasons.",
        "Use temporary fixtures for all write tests; prove authority/scope boundaries, failure handling, deterministic output and raw MACHINE_VERIFIED rejection. Never print secrets or raw credential-bearing errors.",
        "Preserve real PROJECT_STATE bytes and revision; hash before/after all gates. Preserve known scratch artifacts. No product work, dependencies or deployment changes.",
        "All required checks and git diff --check pass. Create exactly ONE local commit only after all gates pass.",
      ], verdicts: ["READY_FOR_REVIEW", "BLOCKED"] };
  }
  if (actor === "CLAUDE" && ["ARCHITECTURE_AUDIT", "INDEPENDENT_REVIEW"].includes(taskType)
    && ((s.operational.phase === "PHASE_B_2B" && taskId.startsWith("ORCH-B2-")) || (s.operational.phase === "PHASE_B_3" && taskId.startsWith("ORCH-B3-")))
    && /^ORCH-B[23]-(ARCHITECTURE-AUDIT|INDEPENDENT-REVIEW)-\d{3,}$/.test(taskId)
    && taskId.includes(taskType.replaceAll("_", "-"))) {
    return { scope: ["tools/claude-supervisor/** (READ ONLY)"], protectedAreas: ["**/*"],
      allowed: ["read Supervisor source and existing verification results", "read-only Git inspection"],
      forbidden: [...forbidden, "edits", "commit", "running write-producing tests/builds"], checks: [],
      acceptance: ["Review scope, correctness, authority boundaries and available test/static evidence.", "Report missing verification as a limitation; do not fabricate results."],
      verdicts: taskType === "ARCHITECTURE_AUDIT" ? ["READY_FOR_IMPLEMENTATION", "HOLD"] : ["GO", "HOLD"] };
  }
  return null;
}
