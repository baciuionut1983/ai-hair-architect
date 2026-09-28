import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProjectState, parseProjectState, PROJECT_STATE_PATH, summarizeProjectState, validateProjectState } from "./project-state.js";

function bootstrap() {
  const result = loadProjectState();
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("read-only outer project state", () => {
  it("loads the explicit v2 migration without inventing repository provenance or task history", () => {
    const state = bootstrap();
    expect(state.schemaVersion).toBe(2);
    expect(state.stateRevision).toBe(2);
    expect(state.repository.evidence).toBe("UNKNOWN");
    expect(state.activeTask).toBeNull();
    expect(state.lastTask).toMatchObject({ actor: "HUMAN", verdict: "BOOTSTRAP_SYNC", task_id: "ORCH-B2-STATE-MAINTENANCE-BOOTSTRAP-001" });
    expect(state.operational).toMatchObject({ phase: "PHASE_B_3", status: "AWAITING_IMPLEMENTATION" });
    expect(state.next).toEqual({ actor: "CODEX", taskId: "ORCH-B3-IMPL-001", taskType: "IMPLEMENTATION",
      task: "Implement Project Operations Orchestrator Phase B.3 task generation and evidence verification.",
      humanApprovalRequired: false, humanApprovalReason: null });
  });

  it.each([1, 0, 3, "2", null])("rejects unsupported schema version %j", (schemaVersion) => {
    expect(validateProjectState({ ...bootstrap(), schemaVersion }).ok).toBe(false);
  });
  it.each(["AWAITING_ARCHITECTURE", "AWAITING_IMPLEMENTATION", "IMPLEMENTATION_IN_PROGRESS", "AWAITING_REVIEW", "REVIEW_HOLD", "AWAITING_PUSH_AUTHORIZATION", "AWAITING_CI", "CI_FAILED", "AWAITING_PRODUCTION_VERIFICATION", "READY_FOR_HUMAN_CLOSURE", "CLOSED"])("accepts operational status %s structurally", (status) => {
    const state = bootstrap();
    expect(validateProjectState({ ...state, operational: { ...state.operational, status } }).ok).toBe(true);
  });
  it("accepts descriptive future phases but rejects empty phases", () => {
    const state = bootstrap();
    for (const phase of ["PHASE_B_3", "Future reviewed phase"]) {
      expect(validateProjectState({ ...state, operational: { ...state.operational, phase } }).ok).toBe(true);
    }
    for (const phase of ["", "   "]) {
      expect(validateProjectState({ ...state, operational: { ...state.operational, phase } }).ok).toBe(false);
    }
  });
  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])("rejects invalid revision %j", (stateRevision) => {
    expect(validateProjectState({ ...bootstrap(), stateRevision }).ok).toBe(false);
  });
  it("requires new next fields and an unambiguous human approval reason", () => {
    const state = bootstrap();
    for (const key of ["taskId", "taskType", "humanApprovalReason"]) {
      const next: Record<string, unknown> = { ...state.next }; delete next[key];
      expect(validateProjectState({ ...state, next }).ok).toBe(false);
    }
    for (const change of [{ taskId: "../unsafe" }, { taskType: "INVALID" }, { humanApprovalRequired: true }, { humanApprovalReason: "unexpected" }]) {
      expect(validateProjectState({ ...state, next: { ...state.next, ...change } }).ok).toBe(false);
    }
  });
  it.each(["activeTask", "lastTask"] as const)("strictly validates %s without writing history", (field) => {
    const state = bootstrap();
    const common = { task_id: "ORCH-B2-IMPL-001", actor: "CODEX", task_type: "IMPLEMENTATION", attempt: 1 };
    const value = field === "activeTask" ? { ...common, startedAt: "2026-09-28T10:00:00.000Z" }
      : { ...common, verdict: "READY_FOR_REVIEW", footerDigest: "a".repeat(64), at: "2026-09-28T10:00:00.000Z" };
    expect(validateProjectState({ ...state, [field]: value }).ok).toBe(true);
    for (const change of [{ extra: 1 }, { actor: "INVALID" }, { task_type: "INVALID" }, { attempt: 0 }, { attempt: 1.5 }, { task_id: "../escape" }]) {
      expect(validateProjectState({ ...state, [field]: { ...value, ...change } }).ok).toBe(false);
    }
    for (const key of Object.keys(value)) {
      const incomplete: Record<string, unknown> = { ...value }; delete incomplete[key];
      expect(validateProjectState({ ...state, [field]: incomplete }).ok, key).toBe(false);
    }
    for (const timestamp of ["yesterday", "2026-02-30T10:00:00.000Z", "2026-09-28", "2026-09-28T10:00:00.000"]) {
      expect(validateProjectState({ ...state, [field]: { ...value, [field === "activeTask" ? "startedAt" : "at"]: timestamp } }).ok).toBe(false);
    }
    if (field === "lastTask") {
      for (const footerDigest of ["bad", "g".repeat(64), null]) {
        expect(validateProjectState({ ...state, lastTask: { ...value, footerDigest } }).ok).toBe(false);
      }
      expect(validateProjectState({ ...state, lastTask: { ...value, verdict: "INVALID" } }).ok).toBe(false);
    }
  });

  it("loads the actual bootstrap with the approved product ordering and evidence", () => {
    const state = bootstrap();
    expect(state.repository.approvedSha).toBe("441705a435fd0bf04d8738e214bfc50cc43dff0c");
    expect(state.production.sha).toBe(state.repository.approvedSha);
    expect(state.ci).toEqual({ status: "SUCCESS", runId: 36092504806, evidence: "MACHINE_VERIFIED" });
    expect(state.product).toEqual({ lastClosed: "T1.6.2.c.2c", status: "CLOSED", nextAfterOrchestratorMvp: "B", laterRoadmap: ["T1.6.2.d"], evidence: "HUMAN_VERIFIED" });
    expect(state.production.releaseGateEvidence).toBe("HUMAN_VERIFIED");
  });

  it("rejects every missing top-level field", () => {
    const state = bootstrap();
    for (const key of Object.keys(state)) {
      const input: Record<string, unknown> = { ...state };
      delete input[key];
      expect(validateProjectState(input).ok, key).toBe(false);
    }
  });

  it("rejects unknown fields at the root and in every nested object", () => {
    const state = bootstrap();
    expect(validateProjectState({ ...state, unexpected: true }).ok).toBe(false);
    for (const key of ["repository", "operational", "product", "ci", "production", "next"] as const) {
      expect(validateProjectState({ ...state, [key]: { ...state[key], unexpected: true } }).ok, key).toBe(false);
    }
    expect(validateProjectState({ ...state, production: { ...state.production, migrations: { applied: 57, pending: 0, extra: 1 } } }).ok).toBe(false);
    expect(validateProjectState({ ...state, deferred: [{ ...state.deferred[0], extra: 1 }] }).ok).toBe(false);
  });

  it("validates evidence at all four evidence locations", () => {
    for (const key of ["repository", "product", "ci", "production"] as const) {
      const state = bootstrap();
      expect(validateProjectState({ ...state, [key]: { ...state[key], evidence: "TRUST_ME" } }).ok).toBe(false);
      for (const evidence of ["CLAIMED", "MACHINE_VERIFIED", "HUMAN_VERIFIED", "UNKNOWN"]) {
        expect(validateProjectState({ ...state, [key]: { ...state[key], evidence } }).ok).toBe(true);
      }
    }
    const state = bootstrap();
    expect(validateProjectState({ ...state, production: { ...state.production, releaseGateEvidence: "TRUST_ME" } }).ok).toBe(false);
  });

  it("rejects invalid milestones, statuses, phases, and next-product ordering", () => {
    const state = bootstrap();
    for (const key of ["milestone", "status"] as const) {
      expect(validateProjectState({ ...state, operational: { ...state.operational, [key]: "INVALID" } }).ok).toBe(false);
    }
    for (const key of ["lastClosed", "status", "nextAfterOrchestratorMvp"] as const) {
      expect(validateProjectState({ ...state, product: { ...state.product, [key]: "T1.6.2.d" } }).ok).toBe(false);
    }
    expect(validateProjectState({ ...state, ci: { ...state.ci, status: "GREENISH" } }).ok).toBe(false);
  });

  it.each(["{", "null", "[]", "42", '"state"'])("rejects malformed or non-object JSON: %s", (raw) => {
    expect(parseProjectState(raw).ok).toBe(false);
  });

  it("rejects missing nested fields, bad identifiers, wrong types and negative counts", () => {
    const state = bootstrap();
    expect(validateProjectState({ ...state, next: { actor: "CLAUDE", task: "review" } }).ok).toBe(false);
    expect(validateProjectState({ ...state, repository: { ...state.repository, approvedSha: "short" } }).ok).toBe(false);
    expect(validateProjectState({ ...state, production: { ...state.production, deploymentId: "invalid" } }).ok).toBe(false);
    expect(validateProjectState({ ...state, production: { ...state.production, migrations: { applied: 57, pending: -1 } } }).ok).toBe(false);
    expect(validateProjectState({ ...state, next: { ...state.next, humanApprovalRequired: "false" } }).ok).toBe(false);
  });

  it("preserves both deferred projects and fails closed on relaxed deletion gates", () => {
    const state = bootstrap();
    expect(state.deferred).toEqual(["dynamic-purpose", "celebrated-solace"].map((project) => ({ project, action: "REVIEW_LATER", blocking: false, deletionRequiresHumanApproval: true })));
    for (const change of [{ blocking: true }, { deletionRequiresHumanApproval: false }]) {
      expect(validateProjectState({ ...state, deferred: [{ ...state.deferred[0], ...change }] }).ok).toBe(false);
    }
  });

  it("derives the summary from changed validated state without changing the source file", () => {
    const before = readFileSync(PROJECT_STATE_PATH, "utf8");
    const state = bootstrap();
    state.ci.status = "FAILURE";
    state.production.sha = "a".repeat(40);
    state.blockers = ["Review needed"];
    state.next = { ...state.next, actor: "HUMAN", task: "Decide scope", humanApprovalRequired: true, humanApprovalReason: "Scope decision" };
    const result = validateProjectState(state);
    if (!result.ok) throw new Error(result.reason);
    const summary = summarizeProjectState(result.state);
    for (const expected of ["CI: FAILURE", `Production: ${"a".repeat(40)}`, "Blockers: Review needed", "Next actor: HUMAN", "Next task: Decide scope", "Human approval required: YES", "Next after Orchestrator MVP: B"]) {
      expect(summary).toContain(expected);
    }
    expect(readFileSync(PROJECT_STATE_PATH, "utf8")).toBe(before);
    expect(bootstrap().ci.status).toBe("SUCCESS");
  });

  it("reports read failure without creating a file", () => {
    expect(loadProjectState(join(dirname(PROJECT_STATE_PATH), "nonexistent-project-state.json"))).toEqual({ ok: false, reason: "read_failed" });
  });
});
