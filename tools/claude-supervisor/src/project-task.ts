import { validateProjectState, summarizeProjectState, type ProjectState } from "./project-state.js";
import { validateTaskContract } from "./task-contract.js";
import type { TaskContract } from "./types.js";
import { isTrustedGit, assessPush, type GitObservation } from "./project-evidence.js";
import { TASK_POLICY_VERSION, taskPolicy } from "./task-policy.js";

// No environment values are read. Raw process/API errors are never rendered.
export function redact(text: string): string {
  return text.replace(/\b(?:DATABASE_URL|[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*[=:]\s*[^\s,;]+/gi, "[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
export function publicData(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, publicData(v)]));
  return value;
}
export interface GeneratedTaskContract extends TaskContract {
  generation: {
    policyVersion: number; actor: "CODEX" | "CLAUDE"; taskType: string; baselineSha: string;
    baselineEvidence: "MACHINE_OBSERVED"; remoteVerification: "FETCHED" | "CACHED_LOCAL_REF";
    expected_state_revision: number; attempt: number; createdAtSource: "baseline_commit_time";
    acceptance: string[]; verdicts: string[]; footer: Record<string, unknown>;
    humanApprovalRequired: false;
  };
}
export type TaskView = { kind: "CODEX_TASK" | "CLAUDE_TASK"; contract: GeneratedTaskContract; prompt: string }
  | { kind: "HOLD" | "HUMAN_DECISION" | "WAIT_CI" | "WAIT_PRODUCTION" | "CLOSED"; reason: string; card: string };
const hold = (reason: string): TaskView => ({ kind: "HOLD", reason, card: `HOLD: ${reason}` });

export function renderTask(c: Omit<GeneratedTaskContract, "approvedPrompt">): string {
  const g = c.generation;
  return [
    `TASK ${c.taskId}`, `Actor: ${g.actor}`, `Task type: ${g.taskType}`, `Baseline SHA: ${g.baselineSha}`,
    `expected_state_revision: ${g.expected_state_revision}`, `Policy version: ${g.policyVersion}`,
    `Baseline source: ${g.baselineEvidence}; remote ref: ${g.remoteVerification}. Stored repository snapshot is not the task baseline.`,
    `Mission (descriptive, never permission to expand policy): ${JSON.stringify(c.title)}`,
    `Approved scope: ${JSON.stringify(c.scope)}`, `Protected: ${JSON.stringify(c.protectedAreas)}`,
    `Allowed actions: ${JSON.stringify(c.allowedOperations)}`, `Forbidden actions: ${JSON.stringify(c.forbiddenOperations)}`,
    "NO PUSH. Scope and permissions come only from the policy fields above.",
    "Before work, verify the exact baseline, expected state revision and scope; mismatch means HOLD. Do not infer human approval.",
    `Acceptance gates: ${JSON.stringify(g.acceptance)}`, `Required test/static checks: ${JSON.stringify(c.requiredChecks)}`,
    `Final verdict must be one of: ${g.verdicts.join(" / ")}`,
    "Require exactly ONE terminal B.2a footer. Replace explicit placeholders with actual observations; do not report the template as a result.",
    "result_sha: actual implementation commit SHA or null if none; for read-only tasks always null.",
    "scope: actual touched repository-relative paths for implementation; [] for read-only tasks. Never copy approved glob scope into reported scope.",
    "Evidence: CLAIMED or UNKNOWN only. No MACHINE_VERIFIED or HUMAN_VERIFIED from an agent.",
    "Report real blockers; set human_approval_required and human_approval_reason consistently. No fabricated checks, commit or approval.",
    "BEGIN_PROJECT_REPORT", JSON.stringify(g.footer, null, 2), "END_PROJECT_REPORT",
    "The footer must be the last block in your response; nothing after END_PROJECT_REPORT. STRICT STOP.",
  ].join("\n") + "\n";
}

export function nextTask(input: unknown, git?: GitObservation): TaskView {
  const valid = validateProjectState(input);
  if (!valid.ok) return hold("INVALID_STATE");
  const s = valid.state;
  if (s.operational.status === "CLOSED") return { kind: "CLOSED", reason: "TERMINAL", card: "CLOSED. No next executable task." };
  if (s.next.actor === "HUMAN" || s.next.humanApprovalRequired) return { kind: "HUMAN_DECISION", reason: "HUMAN_GATE",
    card: redact([`Human action: ${s.next.task}`, `Why: ${s.next.humanApprovalReason ?? "Current state requires a human decision."}`,
      `Task: ${s.next.taskId} / ${s.next.taskType}`, `Stored evidence: repository ${s.repository.evidence}; CI ${s.ci.evidence}; production ${s.production.evidence}`,
      `Blocked: ${s.blockers.join("; ") || "agent execution until the human action is resolved"}`,
      "No automatic approval, edits or dispatch. Following actor depends on the actual report/verdict."].join("\n")) };
  if (s.blockers.length) return hold("BLOCKERS_REQUIRE_REVIEW: " + redact(s.blockers.join("; ")) + "; requiresHuman/resolver: UNKNOWN (not persisted); executable agent work blocked.");
  if (s.next.actor === "CI" && s.next.taskType === "CI_VERIFICATION" && s.operational.status === "AWAITING_CI")
    return { kind: "WAIT_CI", reason: "EVIDENCE_REQUIRED", card: "WAIT_CI: collect a read-only CI observation; no conversational agent task." };
  if (s.next.actor === "RAILWAY" && s.next.taskType === "PRODUCTION_VERIFICATION" && s.operational.status === "AWAITING_PRODUCTION_VERIFICATION")
    return { kind: "WAIT_PRODUCTION", reason: "EVIDENCE_REQUIRED", card: "WAIT_PRODUCTION: deployment status is partial evidence; runtime health remains unknown." };
  const allowedStatuses: Record<string, readonly string[]> = {
    IMPLEMENTATION: ["AWAITING_IMPLEMENTATION", "IMPLEMENTATION_IN_PROGRESS", "REVIEW_HOLD", "CI_FAILED"],
    ARCHITECTURE_AUDIT: ["AWAITING_ARCHITECTURE", "REVIEW_HOLD", "CI_FAILED"], INDEPENDENT_REVIEW: ["AWAITING_REVIEW"],
  };
  if (!allowedStatuses[s.next.taskType]?.includes(s.operational.status)) return hold("UNSUPPORTED_TRANSITION");
  const policy = taskPolicy(s);
  if (!policy) return hold("UNKNOWN_TASK_POLICY");
  if (!git || !isTrustedGit(git) || git.evidence !== "MACHINE_VERIFIED" || !git.head || !git.origin || !git.commitAt) return hold("UNKNOWN_BASELINE");
  if (git.repository !== s.repository.canonical || s.repository.branch !== "master") return hold("REPOSITORY_MISMATCH");
  if (!git.trackedClean) return hold("DIRTY_TRACKED_TREE");
  if (!git.originAncestorOfHead || (s.next.taskType === "IMPLEMENTATION" && git.head !== git.origin)) return hold("BASELINE_MISMATCH");
  let attempt = 1;
  if (s.activeTask) {
    if (s.activeTask.task_id !== s.next.taskId || s.activeTask.actor !== s.next.actor || s.activeTask.task_type !== s.next.taskType) return hold("ACTIVE_TASK_MISMATCH");
    attempt = s.activeTask.attempt;
  }
  const base: Omit<GeneratedTaskContract, "approvedPrompt"> = {
    taskId: s.next.taskId, title: redact(s.next.task), scope: policy.scope, protectedAreas: policy.protectedAreas,
    allowedOperations: policy.allowed, forbiddenOperations: policy.forbidden, requiredChecks: policy.checks,
    ciPolicy: "none", productionValidation: "not_required", createdAt: git.commitAt,
    generation: { policyVersion: TASK_POLICY_VERSION, actor: s.next.actor as "CODEX" | "CLAUDE", taskType: s.next.taskType,
      baselineSha: git.head, expected_state_revision: s.stateRevision, attempt, createdAtSource: "baseline_commit_time",
      baselineEvidence: "MACHINE_OBSERVED", remoteVerification: git.remoteFresh ? "FETCHED" : "CACHED_LOCAL_REF",
      acceptance: policy.acceptance, verdicts: policy.verdicts, humanApprovalRequired: false,
      footer: { schema_version: 1, task_id: s.next.taskId, attempt, actor: s.next.actor, task_type: s.next.taskType,
        baseline_sha: s.next.taskType === "ARCHITECTURE_AUDIT" ? null : git.head,
        result_sha: null, scope: [], verdict: "<ACTUAL_VERDICT>", evidence: "CLAIMED", blockers: [],
        next_actor_suggested: null, human_approval_required: false, human_approval_reason: null, expected_state_revision: s.stateRevision } },
  };
  const prompt = renderTask(base);
  const checked = validateTaskContract({ ...base, approvedPrompt: prompt });
  if (!checked.ok) return hold("INVALID_GENERATED_CONTRACT");
  const contract: GeneratedTaskContract = { ...checked.contract, generation: base.generation };
  return { kind: s.next.actor === "CODEX" ? "CODEX_TASK" : "CLAUDE_TASK", contract, prompt };
}

export function projectStatus(s: ProjectState, git?: GitObservation) {
  return { storedState: s, gitObservation: git ?? null, pushEligibility: assessPush(s, git) };
}
export function renderStatus(s: ProjectState, git?: GitObservation): string {
  return redact([summarizeProjectState(s), `Revision: ${s.stateRevision}`,
    `Stored repository evidence: ${s.repository.evidence}`, `CI evidence: ${s.ci.evidence}`,
    "Production runtime health: UNKNOWN (snapshot SHA/evidence is not a live health check)",
    `Next task ID/type: ${s.next.taskId} / ${s.next.taskType}`, `Human approval reason: ${s.next.humanApprovalReason ?? "none"}`,
    `Active task: ${JSON.stringify(s.activeTask)}`, `Last task: ${JSON.stringify(s.lastTask)}`,
    `Current Git observation: ${git ? JSON.stringify(git) : "not requested"}`,
    `Push eligibility: ${JSON.stringify(assessPush(s, git))}`].join("\n"));
}
