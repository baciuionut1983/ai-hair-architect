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
    for (const key of ["product", "ci", "production"] as const) {
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
    for (const key of ["milestone", "phase", "status"] as const) {
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
    state.next = { actor: "IONUT", task: "Decide scope", humanApprovalRequired: true };
    const result = validateProjectState(state);
    if (!result.ok) throw new Error(result.reason);
    const summary = summarizeProjectState(result.state);
    for (const expected of ["CI: FAILURE", `Production: ${"a".repeat(40)}`, "Blockers: Review needed", "Next actor: IONUT", "Next task: Decide scope", "Human approval required: YES", "Next after Orchestrator MVP: B"]) {
      expect(summary).toContain(expected);
    }
    expect(readFileSync(PROJECT_STATE_PATH, "utf8")).toBe(before);
    expect(bootstrap().ci.status).toBe("SUCCESS");
  });

  it("reports read failure without creating a file", () => {
    expect(loadProjectState(join(dirname(PROJECT_STATE_PATH), "nonexistent-project-state.json"))).toEqual({ ok: false, reason: "read_failed" });
  });
});
