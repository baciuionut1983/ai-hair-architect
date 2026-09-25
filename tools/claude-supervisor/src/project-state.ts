// Outer project snapshot, not a second SupervisorRunState or transition engine.
// Uses persistence.ts's explicit field boundary and ok/reason convention, with
// strict validation via the package's existing Zod dependency. Git is history.
// Evidence labels are recorded attestations, never live verification by this loader.
// Phase B.2 will add the structured report footer and reviewed update/transition
// path. A real activeTaskId may be added then; no fabricated task identity now.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const text = z.string().trim().min(1);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const evidence = z.enum(["CLAIMED", "MACHINE_VERIFIED", "HUMAN_VERIFIED", "UNKNOWN"]);
const count = z.number().int().nonnegative().safe();

// Version 1 deliberately admits only the approved milestone vocabulary.
// Extending the roadmap is a reviewed schema edit, not a silent coercion.
const projectStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  project: text,
  repository: z.strictObject({ canonical: text, branch: text, originSha: sha, approvedSha: sha }),
  operational: z.strictObject({
    milestone: z.enum(["PROJECT_OPERATIONS_ORCHESTRATOR"]),
    phase: z.enum(["PHASE_B_1"]),
    status: z.enum(["IMPLEMENTING", "LOCAL_IMPLEMENTATION_READY_FOR_REVIEW"]),
  }),
  product: z.strictObject({
    lastClosed: z.enum(["T1.6.2.c.2c"]),
    status: z.enum(["CLOSED"]),
    nextAfterOrchestratorMvp: z.enum(["B"]),
    laterRoadmap: z.array(z.enum(["T1.6.2.d"])),
    evidence,
  }),
  ci: z.strictObject({
    status: z.enum(["SUCCESS", "FAILURE", "PENDING", "UNKNOWN"]),
    runId: z.number().int().positive().safe(),
    evidence,
  }),
  production: z.strictObject({
    sha, project: text, environment: text, service: text,
    deploymentId: z.string().uuid(), evidence,
    releaseGate: z.enum(["CANONICAL_PRODUCTION_WAIT_FOR_CI_ENABLED_AND_PROVEN", "UNKNOWN"]),
    releaseGateEvidence: evidence,
    migrations: z.strictObject({ applied: count, pending: count }),
  }),
  blockers: z.array(text),
  deferred: z.array(z.strictObject({
    project: text,
    action: z.enum(["REVIEW_LATER"]),
    blocking: z.literal(false),
    deletionRequiresHumanApproval: z.literal(true),
  })),
  next: z.strictObject({ actor: text, task: text, humanApprovalRequired: z.boolean() }),
});

export type ProjectState = z.infer<typeof projectStateSchema>;
export type ProjectStateResult = { ok: true; state: ProjectState } | { ok: false; reason: string };

// Same location for src/ and compiled dist/; independent of the caller's cwd.
export const PROJECT_STATE_PATH = fileURLToPath(new URL("../../../docs/PROJECT_STATE.json", import.meta.url));

export function validateProjectState(input: unknown): ProjectStateResult {
  const result = projectStateSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, reason: `invalid_state:${result.error.issues.map((issue) => `${issue.path.join(".")}:${issue.code}`).join(",")}` };
  }
  return { ok: true, state: result.data };
}

export function parseProjectState(raw: string): ProjectStateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "parse_failed" };
  }
  return validateProjectState(parsed);
}

export function loadProjectState(filePath: string = PROJECT_STATE_PATH): ProjectStateResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, reason: "read_failed" };
  }
  return parseProjectState(raw);
}

export function summarizeProjectState(state: ProjectState): string {
  return [
    `Project: ${state.project}`,
    `Current: ${state.operational.milestone} / ${state.operational.phase} / ${state.operational.status}`,
    `Last product milestone: ${state.product.lastClosed} ${state.product.status}`,
    `Approved/origin: ${state.repository.approvedSha} / ${state.repository.originSha}`,
    `Production: ${state.production.sha} (${state.production.evidence})`,
    `CI: ${state.ci.status} / run ${state.ci.runId} (${state.ci.evidence})`,
    `Release gate: ${state.production.releaseGate} (${state.production.releaseGateEvidence})`,
    `Blockers: ${state.blockers.length ? state.blockers.join("; ") : "none"}`,
    `Next after Orchestrator MVP: ${state.product.nextAfterOrchestratorMvp}`,
    `Later roadmap: ${state.product.laterRoadmap.join(", ")}`,
    `Deferred: ${state.deferred.map((item) => `${item.project}: ${item.action}, blocking=${item.blocking}, deletionRequiresHumanApproval=${item.deletionRequiresHumanApproval}`).join("; ")}`,
    `Next actor: ${state.next.actor}`,
    `Next task: ${state.next.task}`,
    `Human approval required: ${state.next.humanApprovalRequired ? "YES" : "NO"}`,
  ].join("\n");
}
