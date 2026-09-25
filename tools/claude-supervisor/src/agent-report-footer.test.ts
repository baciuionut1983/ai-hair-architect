import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAgentReportFooter, validateAgentReportFooter, type AgentReportFooter } from "./agent-report-footer.js";

const sha = "a".repeat(40);
function report(overrides: Partial<AgentReportFooter> = {}): AgentReportFooter {
  return {
    schema_version: 1, task_id: "ORCH-B2-IMPL-001", attempt: 1,
    actor: "CODEX", task_type: "IMPLEMENTATION", baseline_sha: sha, result_sha: null,
    scope: ["tools/claude-supervisor/src/agent-report-footer.ts"], verdict: "READY_FOR_REVIEW",
    evidence: "CLAIMED", blockers: [], next_actor_suggested: "CLAUDE",
    human_approval_required: false, human_approval_reason: null, expected_state_revision: 0,
    ...overrides,
  };
}
function frame(value: unknown) { return `Prose may claim anything.\nBEGIN_PROJECT_REPORT\n${JSON.stringify(value)}\nEND_PROJECT_REPORT\n`; }

describe("pure structured report footer", () => {
  it.each([
    ["CLAUDE", "ARCHITECTURE_AUDIT", "READY_FOR_IMPLEMENTATION"],
    ["CLAUDE", "ARCHITECTURE_AUDIT", "HOLD"],
    ["CODEX", "IMPLEMENTATION", "READY_FOR_REVIEW"],
    ["CODEX", "IMPLEMENTATION", "BLOCKED"],
    ["CLAUDE", "INDEPENDENT_REVIEW", "GO"],
    ["CLAUDE", "INDEPENDENT_REVIEW", "HOLD"],
    ["HUMAN", "CONTROLLED_PUSH", "PASS"],
    ["CODEX", "CONTROLLED_PUSH", "FAIL"],
    ["CI", "CI_VERIFICATION", "PASS"],
    ["CI", "CI_VERIFICATION", "FAIL"],
    ["CI", "CI_VERIFICATION", "PENDING"],
    ["HUMAN", "PRODUCTION_VERIFICATION", "PASS"],
    ["RAILWAY", "PRODUCTION_VERIFICATION", "UNKNOWN"],
    ["RAILWAY", "PRODUCTION_VERIFICATION", "FAIL"],
    ["HUMAN", "STATE_MAINTENANCE", "CLOSED"],
    ["HUMAN", "STATE_MAINTENANCE", "UPDATED"],
  ] as const)("accepts %s / %s / %s", (actor, task_type, verdict) => {
    const value = report({ actor, task_type, verdict, scope: [],
      baseline_sha: ["IMPLEMENTATION", "INDEPENDENT_REVIEW", "CONTROLLED_PUSH"].includes(task_type) ? sha : null,
      result_sha: task_type === "CONTROLLED_PUSH" ? sha : null,
      evidence: actor === "HUMAN" ? "HUMAN_VERIFIED" : "CLAIMED" });
    expect(parseAgentReportFooter(frame(value))).toEqual({ ok: true, footer: value });
  });

  it.each([
    { verdict: "GO" }, { verdict: "CLOSED" },
    { actor: "CLAUDE" }, { actor: "ORCHESTRATOR", task_type: "STATE_MAINTENANCE", verdict: "CLOSED", baseline_sha: null, scope: [] },
    { actor: "ORCHESTRATOR", task_type: "STATE_MAINTENANCE", verdict: "UPDATED", baseline_sha: null, scope: [] },
    { actor: "CLAUDE", task_type: "INDEPENDENT_REVIEW", verdict: "READY_FOR_REVIEW", scope: [] },
    { baseline_sha: "bad" }, { baseline_sha: null }, { result_sha: "bad" },
    { actor: "CLAUDE", task_type: "INDEPENDENT_REVIEW", verdict: "GO", scope: [], result_sha: sha },
    { actor: "CLAUDE", task_type: "INDEPENDENT_REVIEW", verdict: "GO" },
    { task_type: "CONTROLLED_PUSH", verdict: "PASS", result_sha: null },
    { actor: "HUMAN", task_type: "STATE_MAINTENANCE", verdict: "UPDATED", scope: [] },
    { evidence: "TRUSTED" }, { evidence: "HUMAN_VERIFIED" }, { evidence: "MACHINE_VERIFIED" },
    { blockers: [{ description: "Blocked", blocking: true, requiresHuman: false }] },
    { blockers: [{ description: "Decision", blocking: false, requiresHuman: true }] },
    { human_approval_required: true }, { human_approval_reason: "Unexpected" },
    { human_approval_required: true, human_approval_reason: " " },
    { attempt: 0 }, { attempt: 1.5 }, { expected_state_revision: -1 },
    { unexpected: true }, { schema_version: 2 }, { next_actor_suggested: "ANYONE" },
    { blockers: [{ description: "x", blocking: false, requiresHuman: false, extra: 1 }] },
  ])("rejects incompatible or malformed values: %j", (overrides) => {
    expect(validateAgentReportFooter({ ...report(), ...overrides }).ok).toBe(false);
  });

  it.each(["", " ", "/absolute", "C:/absolute", "../escape", "a/../b", "a\\b", "a//b", "a/./b", "a\nfile", "%2e%2e/file"])("rejects unsafe scope %j", (path) => {
    expect(validateAgentReportFooter(report({ scope: [path] })).ok).toBe(false);
  });
  it.each(["", " ", "../IMPL-001", "ORCH/IMPL-001", "ORCH", "ORCH-IMPL-x"])("rejects task ID %j", (task_id) => {
    expect(validateAgentReportFooter(report({ task_id })).ok).toBe(false);
  });
  it("allows future milestone IDs, a commit result, and explicit human gates", () => {
    expect(validateAgentReportFooter(report({ task_id: "T1.6.2-B2A-IMPL-002", result_sha: sha,
      blockers: [{ description: "Review", blocking: true, requiresHuman: true }],
      human_approval_required: true, human_approval_reason: "Review required", next_actor_suggested: null })).ok).toBe(true);
  });
  it("requires every canonical field", () => {
    for (const key of Object.keys(report())) {
      const value: Record<string, unknown> = { ...report() }; delete value[key];
      expect(validateAgentReportFooter(value).ok, key).toBe(false);
    }
  });
  it.each([
    ["No footer", "missing_footer"],
    [frame(report()) + frame(report()), "multiple_or_ambiguous_footer"],
    ["BEGIN_PROJECT_REPORT\n{\nEND_PROJECT_REPORT", "malformed_json"],
    [frame(report()) + "{}", "invalid_footer_boundary"],
    ["x BEGIN_PROJECT_REPORT\n{}\nEND_PROJECT_REPORT", "invalid_footer_boundary"],
  ])("rejects malformed framing", (input, reason) => {
    expect(parseAgentReportFooter(input)).toEqual({ ok: false, reason });
  });
  it("ignores preceding prose and accepts CRLF without mutating input or project state", () => {
    const file = new URL("../../../docs/PROJECT_STATE.json", import.meta.url);
    const before = readFileSync(file);
    const value = report(); const original = JSON.stringify(value);
    expect(parseAgentReportFooter(frame(value).replace(/\n/g, "\r\n"))).toEqual({ ok: true, footer: value });
    expect(JSON.stringify(value)).toBe(original);
    expect(readFileSync(file)).toEqual(before);
  });
});
