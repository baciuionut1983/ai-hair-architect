// Outer project snapshot, not a second SupervisorRunState or transition engine.
// Uses persistence.ts's explicit field boundary and ok/reason convention, with
// strict validation via the package's existing Zod dependency. Git is history.
// Evidence labels are recorded attestations, never live verification by this loader.
// V2 is an explicit Git migration, never migration-on-read. B.2b-2 will add
// the controlled update path; this module still only reads and validates.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { agentReportFieldSchemas as task } from "./agent-report-footer.js";

const text = z.string().trim().min(1);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const evidence = z.enum(["CLAIMED", "MACHINE_VERIFIED", "HUMAN_VERIFIED", "UNKNOWN"]);
const count = z.number().int().nonnegative().safe();
const commitEntry = z.strictObject({ sha, subject: text });

const taskFields = { task_id: task.taskId, attempt: task.attempt, task_type: task.taskType, actor: task.actor };
const timestamp = z.iso.datetime({ precision: 3 });
// Version 2 deliberately admits only the approved milestone vocabulary.
// Extending the roadmap is a reviewed schema edit, not a silent coercion.
//
// Milestone-B state-reconciliation task (schema v3, this revision):
// `product` stays EXACTLY as v2 defined it -- the frozen historical record
// of the Orchestrator MVP's own closure (T1.6.2.c.2c closed, B next). It is
// NEVER rewritten by this or any later revision; a milestone this file
// already closed does not get reopened or restated.
// `productMilestoneB` is NEW, additive, and required if and only if
// schemaVersion is 3 -- the live tracking surface for milestone B's own
// progress, deliberately kept separate from `product`. Its ONLY two facts
// are the ones a real reconciliation can actually attest without
// conflating them (see project-state-updater.ts's own header comment on
// why `repository.approvedSha` is never inferred from "exists on origin"):
//   - what this file's own `repository.originSha`/`approvedSha` already
//     represent (published, human-approved) needs no duplicate field here;
//   - `localOnlyCommits`: real commits sitting on top of that published
//     SHA that a human has NOT yet reviewed/approved for push -- named
//     here explicitly so nothing can quietly promote a local-only commit
//     to "approved" by omission.
// `operational.milestone` gains "PRODUCT_MILESTONE_B" so the SAME
// status/phase state machine (`compatible`/`route`/`actors` in
// project-state-updater.ts) can be reused unmodified for tracking B's own
// pipeline -- "milestone" names WHICH effort a status cycle is currently
// about, it is not a second state machine.
const projectStateSchema = z.strictObject({
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  stateRevision: z.number().int().positive().safe(),
  activeTask: z.strictObject({ ...taskFields, startedAt: timestamp }).nullable(),
  lastTask: z.strictObject({ ...taskFields, verdict: task.verdict, footerDigest: z.string().regex(/^[a-fA-F0-9]{64}$/), at: timestamp }).nullable(),
  project: text,
  repository: z.strictObject({ canonical: text, branch: text, originSha: sha, approvedSha: sha, evidence }),
  operational: z.strictObject({
    milestone: z.enum(["PROJECT_OPERATIONS_ORCHESTRATOR", "PRODUCT_MILESTONE_B"]),
    phase: text,
    status: z.enum(["AWAITING_ARCHITECTURE", "AWAITING_IMPLEMENTATION", "IMPLEMENTATION_IN_PROGRESS", "AWAITING_REVIEW", "REVIEW_HOLD", "AWAITING_PUSH_AUTHORIZATION", "AWAITING_CI", "CI_FAILED", "AWAITING_PRODUCTION_VERIFICATION", "READY_FOR_HUMAN_CLOSURE", "CLOSED"]),
  }),
  product: z.strictObject({
    lastClosed: z.enum(["T1.6.2.c.2c"]),
    status: z.enum(["CLOSED"]),
    nextAfterOrchestratorMvp: z.enum(["B"]),
    laterRoadmap: z.array(z.enum(["T1.6.2.d"])),
    evidence,
  }),
  productMilestoneB: z.strictObject({
    localOnlyCommits: z.array(commitEntry),
  }).optional(),
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
  next: z.strictObject({ actor: task.actor, task: text, taskId: task.taskId, taskType: task.taskType,
    humanApprovalRequired: z.boolean(), humanApprovalReason: text.nullable() })
    .refine((next) => next.humanApprovalRequired === (next.humanApprovalReason !== null)),
}).refine((s) => (s.schemaVersion === 3) === (s.productMilestoneB !== undefined), { message: "productMilestoneB is required if and only if schemaVersion is 3" });

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
    ...(state.productMilestoneB
      ? [`Milestone B local-only commits (implemented, not yet approved/pushed): ${
          state.productMilestoneB.localOnlyCommits.length === 0
            ? "none"
            : state.productMilestoneB.localOnlyCommits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`).join("; ")
        }`]
      : []),
    `Deferred: ${state.deferred.map((item) => `${item.project}: ${item.action}, blocking=${item.blocking}, deletionRequiresHumanApproval=${item.deletionRequiresHumanApproval}`).join("; ")}`,
    `Next actor: ${state.next.actor}`,
    `Next task: ${state.next.task}`,
    `Human approval required: ${state.next.humanApprovalRequired ? "YES" : "NO"}`,
  ].join("\n");
}
