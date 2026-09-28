import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, type JsonValue } from "./canonical-json.js";
import { footerDigest, ingestAgentReport, serializeProjectState, type UpdateDependencies } from "./project-state-updater.js";
import { loadProjectState, parseProjectState, PROJECT_STATE_PATH, type ProjectState } from "./project-state.js";
import { validateAgentReportFooter, type AgentReportFooter } from "./agent-report-footer.js";
import { nextTask } from "./project-task.js";

const realBefore = fs.readFileSync(PROJECT_STATE_PATH);
const realHash = createHash("sha256").update(realBefore).digest("hex");
const timestamp = "2026-09-28T12:00:00.000Z";
const now = () => new Date(timestamp);
const sha = "b".repeat(40);
const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(join(tmpdir(), "orch-b2b2-")); dirs.push(dir);
  const path = join(dir, "PROJECT_STATE.json");
  // Writes only to the freshly created temporary fixture, never the real path.
  const initial = JSON.parse(realBefore.toString()) as ProjectState;
  // Explicit historical B.2 fixture; the real snapshot has advanced to B.3.
  initial.stateRevision = 1; initial.lastTask = null; initial.activeTask = null;
  initial.operational.phase = "PHASE_B_2B";
  initial.next = { actor: "CODEX", taskId: "ORCH-B2-IMPL-001", taskType: "IMPLEMENTATION",
    task: "Implement Project Operations Orchestrator Phase B.2b-2 controlled project-state updater.",
    humanApprovalRequired: false, humanApprovalReason: null };
  fs.writeFileSync(path, serializeProjectState(initial));
  return { path, dir };
}
function state(path: string): ProjectState {
  const loaded = loadProjectState(path); if (!loaded.ok) throw new Error(loaded.reason); return loaded.state;
}
function save(path: string, value: ProjectState) { fs.writeFileSync(path, serializeProjectState(value)); }
function report(changes: Partial<AgentReportFooter> = {}): AgentReportFooter {
  return { schema_version: 1, task_id: "ORCH-B2-IMPL-001", attempt: 1, actor: "CODEX", task_type: "IMPLEMENTATION",
    baseline_sha: sha, result_sha: sha, scope: ["tools/claude-supervisor/src/project-state-updater.ts"], verdict: "READY_FOR_REVIEW", evidence: "CLAIMED",
    blockers: [], next_actor_suggested: "CODEX", human_approval_required: false, human_approval_reason: null, expected_state_revision: 1, ...changes };
}
function frame(value: unknown) { return `Narrative is not authoritative.\nBEGIN_PROJECT_REPORT\n${JSON.stringify(value)}\nEND_PROJECT_REPORT\n`; }
function ingest(path: string, value: unknown = report(), dependencies: UpdateDependencies = {}) {
  return ingestAgentReport(frame(value), path, { now, ...dependencies });
}
function forTask(path: string, status: ProjectState["operational"]["status"], taskType: AgentReportFooter["task_type"], actor: AgentReportFooter["actor"], verdict: AgentReportFooter["verdict"]) {
  const s = state(path); s.operational.status = status;
  s.next = { ...s.next, actor, taskType, humanApprovalRequired: actor === "HUMAN", humanApprovalReason: actor === "HUMAN" ? "Human decision required" : null };
  save(path, s);
  return report({ task_type: taskType, actor, verdict, scope: [], result_sha: taskType === "CONTROLLED_PUSH" ? sha : null,
    baseline_sha: ["IMPLEMENTATION", "INDEPENDENT_REVIEW", "CONTROLLED_PUSH"].includes(taskType) ? sha : null,
    evidence: actor === "HUMAN" ? "HUMAN_VERIFIED" : "CLAIMED" });
}
function rejected(path: string, value: unknown, reason: string, dependencies: UpdateDependencies = {}) {
  const before = fs.readFileSync(path);
  expect(ingest(path, value, dependencies)).toMatchObject({ ok: false, reason });
  expect(fs.readFileSync(path)).toEqual(before);
  expect(loadProjectState(path).ok).toBe(true);
  expect(fs.existsSync(`${path}.lock`)).toBe(false);
}
function fault(code: string): NodeJS.ErrnoException { return Object.assign(new Error(code), { code }); }
function lock(path: string, acquiredAt = timestamp) { fs.writeFileSync(`${path}.lock`, JSON.stringify({ pid: 123, hostname: "fixture", acquiredAt })); }
function reverseKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  return value;
}
afterEach(() => {
  expect(fs.readFileSync(PROJECT_STATE_PATH)).toEqual(realBefore);
  expect(createHash("sha256").update(fs.readFileSync(PROJECT_STATE_PATH)).digest("hex")).toBe(realHash);
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("one-shot HUMAN MVP closure sync", () => {
  const closure = (changes: Partial<AgentReportFooter> = {}) => report({
    task_id: "ORCH-B3-STATE-MAINTENANCE-CLOSURE-001", actor: "HUMAN", task_type: "STATE_MAINTENANCE",
    verdict: "MVP_CLOSURE_SYNC", baseline_sha: null, result_sha: null, scope: [], evidence: "HUMAN_VERIFIED",
    next_actor_suggested: "HUMAN", expected_state_revision: 2, ...changes });
  function closureFixture() {
    const result = fixture(); save(result.path, JSON.parse(realBefore.toString()) as ProjectState); return result;
  }
  it("closes only the operational milestone, records the actual event and leaves no executable task", () => {
    const { path } = closureFixture(); const before = state(path); const f = closure();
    expect(ingest(path, f)).toEqual({ ok: true, kind: "UPDATED", revision: 3, operationalStatus: "CLOSED", nextActor: "HUMAN", anomalies: [] });
    const after = state(path);
    const lastTask = { task_id: f.task_id, attempt: 1, task_type: "STATE_MAINTENANCE", actor: "HUMAN",
      verdict: "MVP_CLOSURE_SYNC", footerDigest: footerDigest(f), at: timestamp };
    const next = { actor: "HUMAN", taskType: "STATE_MAINTENANCE", taskId: f.task_id,
      task: "Orchestrator MVP CLOSED. No next executable task; the architecture/scope decision for product work B is a separate, later human-initiated action.",
      humanApprovalRequired: false, humanApprovalReason: null };
    expect(after).toEqual({ ...before, stateRevision: 3, activeTask: null, lastTask, next,
      operational: { ...before.operational, phase: "ORCHESTRATOR_MVP_CLOSED", status: "CLOSED" } });
    expect(nextTask(after)).toEqual({ kind: "CLOSED", reason: "TERMINAL", card: "CLOSED. No next executable task." });
    expect(JSON.stringify(after)).not.toContain("ORCH-B3-IMPL-001");
  });
  const stateChanges: [string, (s: ProjectState) => void][] = [
    ["phase", s => { s.operational.phase = "PHASE_B_2B"; }],
    ["terminal phase", s => { s.operational.phase = "ORCHESTRATOR_MVP_CLOSED"; }],
    ["status", s => { s.operational.status = "AWAITING_REVIEW"; }],
    ["CLOSED", s => { s.operational.status = "CLOSED"; }],
    ["activeTask", s => { s.activeTask = { task_id: s.next.taskId, attempt: 1, actor: "CODEX", task_type: "IMPLEMENTATION", startedAt: timestamp }; }],
    ["null lastTask", s => { s.lastTask = null; }],
    ["last task ID", s => { s.lastTask!.task_id = "ORCH-B2-OTHER-001"; }],
    ["last attempt", s => { s.lastTask!.attempt = 2; }],
    ["last type", s => { s.lastTask!.task_type = "IMPLEMENTATION"; }],
    ["last actor", s => { s.lastTask!.actor = "CODEX"; }],
    ["last verdict", s => { s.lastTask!.verdict = "CLOSED"; }],
    ["last digest", s => { s.lastTask!.footerDigest = "a".repeat(64); }],
    ["last timestamp", s => { s.lastTask!.at = timestamp; }],
    ["next actor", s => { s.next.actor = "HUMAN"; }],
    ["next task ID", s => { s.next.taskId = "ORCH-B3-IMPL-002"; }],
    ["next type", s => { s.next.taskType = "STATE_MAINTENANCE"; }],
    ["approval gate", s => { s.next.humanApprovalRequired = true; s.next.humanApprovalReason = "Review"; }],
    ["blockers", s => { s.blockers = ["Unresolved"]; }],
    ["empty roadmap", s => { s.product.laterRoadmap = []; }],
    ["duplicate roadmap", s => { s.product.laterRoadmap = ["T1.6.2.d", "T1.6.2.d"]; }],
  ];
  it.each(stateChanges)("rejects changed %s without normal maintenance fallback", (_, change) => {
    const { path } = closureFixture(); const s = state(path); change(s); save(path, s); const before = fs.readFileSync(path);
    expect(ingest(path, closure())).toMatchObject({ ok: false, reason: "invalid_transition", step: "closure_sync_eligibility" });
    expect(fs.readFileSync(path)).toEqual(before); expect(fs.existsSync(`${path}.lock`)).toBe(false);
  });
  it.each([
    ["schemaVersion", 1], ["operational.milestone", "OTHER"], ["product.lastClosed", "Orchestrator"],
    ["product.status", "OPEN"], ["product.nextAfterOrchestratorMvp", "C"], ["product.laterRoadmap", ["B"]],
    ["lastTask", undefined], ["next.humanApprovalRequired", true], ["next.humanApprovalReason", "Unexpected"],
  ])("rejects invalid state %s before closure eligibility", (key, value) => {
    const { path } = closureFixture(); const s = JSON.parse(fs.readFileSync(path, "utf8"));
    const parts = String(key).split("."); const parent = parts.length === 1 ? s : s[parts[0]];
    parent[parts.at(-1)!] = value; const raw = JSON.stringify(s); fs.writeFileSync(path, raw);
    expect(ingest(path, closure())).toMatchObject({ ok: false, reason: "state_invalid" });
    expect(fs.readFileSync(path, "utf8")).toBe(raw);
  });
  it.each([1, 3, 4])("rejects revision %i even when footer and state agree", revision => {
    const { path } = closureFixture(); rejected(path, closure({ expected_state_revision: revision }), "stale_revision");
    const s = state(path); s.stateRevision = revision; save(path, s);
    rejected(path, closure(), "stale_revision");
    rejected(path, closure({ expected_state_revision: revision }), "stale_revision");
  });
  it.each([
    { task_id: "ORCH-B3-STATE-MAINTENANCE-CLOSURE-002" }, { attempt: 2 }, { evidence: "CLAIMED" }, { evidence: "UNKNOWN" },
    { blockers: [{ description: "Unresolved", blocking: false, requiresHuman: false }] },
    { human_approval_required: true, human_approval_reason: "Review" },
  ] satisfies Partial<AgentReportFooter>[])("rejects footer eligibility %j", change => {
    const { path } = closureFixture(); const f = closure(change); expect(validateAgentReportFooter(f).ok).toBe(true);
    const before = fs.readFileSync(path);
    expect(ingest(path, f)).toMatchObject({ ok: false, reason: "invalid_transition", step: "closure_sync_eligibility" });
    expect(fs.readFileSync(path)).toEqual(before);
  });
  it.each([
    { baseline_sha: sha }, { result_sha: sha }, { scope: ["tools/claude-supervisor/src/project-state-updater.ts"] },
    { evidence: "MACHINE_VERIFIED" }, { human_approval_required: true }, { human_approval_reason: "Review" },
    { task_type: "IMPLEMENTATION" }, { schema_version: 2 }, { verdict: "PASS" },
  ])("keeps structural rejection ahead of revision and eligibility: %j", change => {
    const { path } = closureFixture(); rejected(path, { ...closure({ expected_state_revision: 99 }), ...change }, "footer_invalid");
  });
  it.each(["CLAUDE", "CODEX", "CI", "RAILWAY", "ORCHESTRATOR"] as const)("never ingests %s closure", actor => {
    const { path } = closureFixture(); rejected(path, closure({ actor, evidence: "CLAIMED" }), "footer_invalid");
  });
  it.each([null, "CLAUDE", "CODEX", "HUMAN", "CI", "RAILWAY", "ORCHESTRATOR"] as const)("ignores advisory actor %s", next_actor_suggested => {
    const { path } = closureFixture(); expect(ingest(path, closure({ next_actor_suggested })).ok).toBe(true);
    expect(state(path).next.actor).toBe("HUMAN"); expect(nextTask(state(path)).kind).toBe("CLOSED");
  });
  it("does not pin prose, repository, CI, production or evidence and preserves them exactly", () => {
    const { path } = closureFixture(); const s = state(path);
    s.next.task = "Different historical prose"; s.repository.originSha = sha; s.repository.approvedSha = sha; s.repository.evidence = "CLAIMED";
    s.ci = { status: "UNKNOWN", runId: 1, evidence: "UNKNOWN" };
    s.production.sha = sha; s.production.migrations = { applied: 1, pending: 2 }; s.production.evidence = "UNKNOWN";
    s.product.evidence = "UNKNOWN"; save(path, s);
    expect(ingest(path, closure()).ok).toBe(true); const after = state(path);
    for (const key of ["project", "schemaVersion", "repository", "product", "ci", "production", "blockers", "deferred"] as const) expect(after[key]).toEqual(s[key]);
  });
  it("deduplicates without a state write and rejects conflicting/repeated closure before routing", () => {
    const { path } = closureFixture(); const f = closure(); expect(ingest(path, f).ok).toBe(true);
    const bytes = fs.readFileSync(path); const renameSync = vi.fn(fs.renameSync);
    const openSync = vi.fn(fs.openSync);
    expect(ingest(path, f, { fs: { ...fs, renameSync, openSync } })).toMatchObject({ kind: "DUPLICATE_NOOP", revision: 3 });
    expect(renameSync).not.toHaveBeenCalled(); expect(openSync.mock.calls.map(call => String(call[0]))).toEqual([`${path}.lock`]);
    expect(fs.readFileSync(path)).toEqual(bytes);
    rejected(path, closure({ next_actor_suggested: "CODEX" }), "duplicate_conflict");
    rejected(path, closure({ expected_state_revision: 3 }), "duplicate_conflict");
    rejected(path, closure({ evidence: "MACHINE_VERIFIED" }), "footer_invalid");
    rejected(path, closure({ attempt: 2 }), "stale_revision");
    rejected(path, closure({ attempt: 2, expected_state_revision: 3 }), "stale_revision");
    rejected(path, closure({ task_id: "ORCH-B3-OTHER-001", expected_state_revision: 3 }), "stale_revision");
    expect(fs.readFileSync(path)).toEqual(bytes);
  });
  it("reuses lock, atomic write and post-write recovery for closure", () => {
    const { path } = closureFixture(); const f = closure(); lock(path);
    const before = fs.readFileSync(path);
    expect(ingest(path, f)).toMatchObject({ ok: false, reason: "lock_busy" }); expect(fs.readFileSync(path)).toEqual(before);
    fs.unlinkSync(`${path}.lock`);
    rejected(path, f, "write_failed", { fs: { ...fs, renameSync: () => { throw fault("EIO"); } } });
    let renamed = false;
    const renameSync = (a: fs.PathLike, b: fs.PathLike) => { fs.renameSync(a, b); renamed = true; };
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => { if (renamed && args[0] === path) throw fault("EIO"); return fs.readFileSync(...args); }) as typeof fs.readFileSync;
    expect(ingest(path, f, { fs: { ...fs, renameSync, readFileSync } })).toMatchObject({ ok: false, reason: "post_write_validation_failed" });
    expect(state(path).stateRevision).toBe(3); const bytes = fs.readFileSync(path);
    expect(ingest(path, f)).toMatchObject({ kind: "DUPLICATE_NOOP", revision: 3 }); expect(fs.readFileSync(path)).toEqual(bytes);
  });
});

describe("canonical JSON and validated digest", () => {
  it("sorts nested keys including numeric-looking keys lexically and preserves arrays/primitives", () => {
    const a = { z: [{ y: null, x: true }, false, 1.25, "a\n\"b"], a: { "2": 2, "10": 10 } };
    expect(canonicalJson(a)).toBe(canonicalJson(reverseKeys(a)));
    expect(canonicalJson(a)).toBe('{"a":{"10":10,"2":2},"z":[{"x":true,"y":null},false,1.25,"a\\n\\\"b"]}');
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(() => canonicalJson(Infinity)).toThrow();
  });
  it("hashes only a validated footer and is stable across key order", () => {
    expect(footerDigest(report())).toMatch(/^[a-f0-9]{64}$/);
    expect(footerDigest(reverseKeys(report()))).toBe(footerDigest(report()));
    expect(footerDigest(report())).toBe(createHash("sha256").update(canonicalJson(report())).digest("hex"));
    expect(() => footerDigest({ ...report(), evidence: "MACHINE_VERIFIED" })).toThrow();
    expect(() => footerDigest("unvalidated text")).toThrow();
  });
});

describe("locked ingestion and lifecycle", () => {
  it("first happy path updates a real-state-shaped revision 1 fixture to independent review", () => {
    const { path } = fixture(); const before = state(path);
    expect(ingest(path)).toMatchObject({ ok: true, kind: "UPDATED", revision: 2, operationalStatus: "AWAITING_REVIEW", nextActor: "CLAUDE", anomalies: [] });
    const after = state(path);
    expect(after.next).toEqual({ actor: "CLAUDE", taskType: "INDEPENDENT_REVIEW", taskId: "ORCH-B2-INDEPENDENT-REVIEW-002", task: "Independently review the implementation.", humanApprovalRequired: false, humanApprovalReason: null });
    expect(after.activeTask).toBeNull();
    expect(after.lastTask).toEqual({ task_id: report().task_id, attempt: 1, task_type: "IMPLEMENTATION", actor: "CODEX", verdict: "READY_FOR_REVIEW", footerDigest: footerDigest(report()), at: timestamp });
    for (const field of ["schemaVersion", "project", "repository", "product", "ci", "production", "blockers", "deferred"] as const) expect(after[field]).toEqual(before[field]);
    expect(after.operational.phase).toBe(before.operational.phase);
    expect(fs.existsSync(`${path}.lock`)).toBe(false);
  });
  it("exact duplicate precedes stale revision, preserves bytes and does not write a temp", () => {
    const { path, dir } = fixture(); expect(ingest(path).ok).toBe(true);
    const bytes = fs.readFileSync(path); const entries = fs.readdirSync(dir);
    const reordered = JSON.stringify(reverseKeys(report()), null, 4);
    expect(ingestAgentReport(`BEGIN_PROJECT_REPORT\n${reordered}\nEND_PROJECT_REPORT`, path, { now })).toMatchObject({ ok: true, kind: "DUPLICATE_NOOP", revision: 2 });
    expect(fs.readFileSync(path)).toEqual(bytes); expect(fs.readdirSync(dir)).toEqual(entries);
  });
  it("conflicting duplicate precedes stale revision", () => {
    const { path } = fixture(); ingest(path);
    rejected(path, report({ next_actor_suggested: "HUMAN" }), "duplicate_conflict");
  });
  it("older reports outside lastTask resolve to stale_revision", () => {
    const { path } = fixture(); ingest(path);
    const s = state(path);
    const review = report({ task_id: s.next.taskId, expected_state_revision: 2,
      actor: "CLAUDE", task_type: "INDEPENDENT_REVIEW", verdict: "GO", scope: [], result_sha: null });
    expect(ingest(path, review)).toMatchObject({ ok: true, revision: 3 });
    rejected(path, report(), "stale_revision");
  });
  it("rejects normalizing protected fields during an unrelated update", () => {
    const { path } = fixture(); const s = state(path); s.project = " AI Hair Architect ";
    fs.writeFileSync(path, JSON.stringify(s));
    rejected(path, report(), "state_invalid");
  });
  it.each([
    [{ expected_state_revision: 0 }, "stale_revision"],
    [{ task_id: "OTHER-IMPL-001" }, "unexpected_task"],
    [{ actor: "CLAUDE", task_type: "INDEPENDENT_REVIEW", verdict: "GO", scope: [], result_sha: null }, "unexpected_actor"],
    [{ evidence: "MACHINE_VERIFIED" }, "footer_invalid"],
    [{ product: { laterRoadmap: [] } }, "footer_invalid"],
    [{ ci: { runId: 9 } }, "footer_invalid"],
    [{ production: { sha } }, "footer_invalid"],
  ])("rejects %j without changing valid canonical bytes", (change, reason) => {
    const { path } = fixture(); rejected(path, { ...report(), ...change }, reason as string);
  });
  it.each(["AWAITING_REVIEW", "CLOSED"] as const)("rejects implementation from %s", (status) => {
    const { path } = fixture(); const s = state(path); s.operational.status = status; save(path, s); rejected(path, report(), "invalid_transition");
  });
  it("checks expected task type even when actor and task ID match", () => {
    const { path } = fixture(); const s = state(path); s.next.taskType = "CONTROLLED_PUSH"; save(path, s); rejected(path, report(), "invalid_transition");
  });
  it("does not bypass a persisted human gate", () => {
    const { path } = fixture(); const s = state(path); s.next.humanApprovalRequired = true; s.next.humanApprovalReason = "Review needed"; save(path, s);
    rejected(path, report(), "human_approval_required");
  });
  it("finishes only the matching active task", () => {
    const { path } = fixture(); const s = state(path);
    s.activeTask = { task_id: report().task_id, attempt: 2, actor: "CODEX", task_type: "IMPLEMENTATION", startedAt: timestamp }; save(path, s);
    rejected(path, report(), "invalid_transition");
    expect(ingest(path, report({ attempt: 2 })).ok).toBe(true); expect(state(path).activeTask).toBeNull();
  });
  it("validates complete new state before opening a temp (revision overflow)", () => {
    const { path, dir } = fixture(); const s = state(path); s.stateRevision = Number.MAX_SAFE_INTEGER; save(path, s);
    rejected(path, report({ expected_state_revision: s.stateRevision }), "state_invalid"); expect(fs.readdirSync(dir)).toEqual(["PROJECT_STATE.json"]);
  });
  it("reports missing footer and invalid state without writing", () => {
    const { path } = fixture(); const bytes = fs.readFileSync(path);
    expect(ingestAgentReport("prose only", path, { now })).toMatchObject({ ok: false, reason: "footer_missing" });
    expect(fs.readFileSync(path)).toEqual(bytes);
    fs.writeFileSync(path, "{}"); expect(ingest(path)).toMatchObject({ ok: false, reason: "state_invalid" }); expect(fs.readFileSync(path, "utf8")).toBe("{}");
    expect(fs.existsSync(`${path}.lock`)).toBe(false);
    fs.unlinkSync(path); expect(ingest(path)).toMatchObject({ ok: false, reason: "state_read_failed" }); expect(fs.existsSync(path)).toBe(false);
  });
});

describe("authority, routing and explicit patches", () => {
  const routes = [
    ["AWAITING_ARCHITECTURE", "ARCHITECTURE_AUDIT", "CLAUDE", "READY_FOR_IMPLEMENTATION", "AWAITING_IMPLEMENTATION", "CODEX", "IMPLEMENTATION"],
    ["AWAITING_ARCHITECTURE", "ARCHITECTURE_AUDIT", "CLAUDE", "HOLD", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["IMPLEMENTATION_IN_PROGRESS", "IMPLEMENTATION", "CODEX", "READY_FOR_REVIEW", "AWAITING_REVIEW", "CLAUDE", "INDEPENDENT_REVIEW"],
    ["AWAITING_IMPLEMENTATION", "IMPLEMENTATION", "CODEX", "BLOCKED", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["AWAITING_REVIEW", "INDEPENDENT_REVIEW", "CLAUDE", "GO", "AWAITING_PUSH_AUTHORIZATION", "HUMAN", "CONTROLLED_PUSH"],
    ["AWAITING_REVIEW", "INDEPENDENT_REVIEW", "CLAUDE", "HOLD", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["AWAITING_PUSH_AUTHORIZATION", "CONTROLLED_PUSH", "HUMAN", "PASS", "AWAITING_CI", "CI", "CI_VERIFICATION"],
    ["AWAITING_PUSH_AUTHORIZATION", "CONTROLLED_PUSH", "HUMAN", "FAIL", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["AWAITING_CI", "CI_VERIFICATION", "CI", "PASS", "AWAITING_PRODUCTION_VERIFICATION", "HUMAN", "PRODUCTION_VERIFICATION"],
    ["AWAITING_CI", "CI_VERIFICATION", "CI", "FAIL", "CI_FAILED", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["AWAITING_CI", "CI_VERIFICATION", "CI", "PENDING", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["AWAITING_PRODUCTION_VERIFICATION", "PRODUCTION_VERIFICATION", "HUMAN", "PASS", "READY_FOR_HUMAN_CLOSURE", "HUMAN", "STATE_MAINTENANCE"],
    ["AWAITING_PRODUCTION_VERIFICATION", "PRODUCTION_VERIFICATION", "RAILWAY", "FAIL", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["AWAITING_PRODUCTION_VERIFICATION", "PRODUCTION_VERIFICATION", "RAILWAY", "UNKNOWN", "REVIEW_HOLD", "HUMAN", "ARCHITECTURE_AUDIT"],
    ["REVIEW_HOLD", "ARCHITECTURE_AUDIT", "CLAUDE", "READY_FOR_IMPLEMENTATION", "AWAITING_IMPLEMENTATION", "CODEX", "IMPLEMENTATION"],
    ["CI_FAILED", "IMPLEMENTATION", "CODEX", "READY_FOR_REVIEW", "AWAITING_REVIEW", "CLAUDE", "INDEPENDENT_REVIEW"],
  ] as const;
  it.each(routes)("%s / %s / %s / %s routes by policy", (status, type, actor, verdict, newStatus, newActor, newType) => {
    const { path } = fixture(); const f = forTask(path, status, type, actor, verdict);
    const before = state(path);
    f.next_actor_suggested = "ORCHESTRATOR";
    expect(ingest(path, f)).toMatchObject({ ok: true, operationalStatus: newStatus, nextActor: newActor });
    expect(state(path).next.taskType).toBe(newType);
    expect(state(path).next.humanApprovalRequired).toBe(newActor === "HUMAN");
    const after = state(path);
    for (const field of ["schemaVersion", "project", "product", "deferred"] as const) expect(after[field]).toEqual(before[field]);
    expect(after.operational.milestone).toBe(before.operational.milestone);
    expect(after.operational.phase).toBe(before.operational.phase);
    if (type !== "CONTROLLED_PUSH") expect(after.repository).toEqual(before.repository);
    if (type !== "CI_VERIFICATION") expect(after.ci).toEqual(before.ci);
    if (type !== "PRODUCTION_VERIFICATION") expect(after.production).toEqual(before.production);
  });
  it("rejects every incompatible status/task pair", () => {
    const allowed: Record<ProjectState["operational"]["status"], readonly AgentReportFooter["task_type"][]> = {
      AWAITING_ARCHITECTURE: ["ARCHITECTURE_AUDIT"], AWAITING_IMPLEMENTATION: ["IMPLEMENTATION"],
      IMPLEMENTATION_IN_PROGRESS: ["IMPLEMENTATION"], AWAITING_REVIEW: ["INDEPENDENT_REVIEW"],
      REVIEW_HOLD: ["ARCHITECTURE_AUDIT", "IMPLEMENTATION"], AWAITING_PUSH_AUTHORIZATION: ["CONTROLLED_PUSH"],
      AWAITING_CI: ["CI_VERIFICATION"], CI_FAILED: ["ARCHITECTURE_AUDIT", "IMPLEMENTATION"],
      AWAITING_PRODUCTION_VERIFICATION: ["PRODUCTION_VERIFICATION"], READY_FOR_HUMAN_CLOSURE: ["STATE_MAINTENANCE"], CLOSED: [],
    };
    const cases = [...routes, ["READY_FOR_HUMAN_CLOSURE", "STATE_MAINTENANCE", "HUMAN", "CLOSED"] as const];
    for (const status of Object.keys(allowed) as ProjectState["operational"]["status"][]) {
      for (const [, type, actor, verdict] of cases) {
        if (allowed[status].includes(type)) continue;
        const { path } = fixture(); const f = forTask(path, status, type, actor, verdict);
        rejected(path, f, "invalid_transition");
      }
    }
  });
  it("Codex push is structurally legal but cannot replace an expected HUMAN", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_PUSH_AUTHORIZATION", "CONTROLLED_PUSH", "HUMAN", "PASS");
    f.actor = "CODEX"; f.evidence = "CLAIMED"; expect(validateAgentReportFooter(f).ok).toBe(true);
    rejected(path, f, "unexpected_actor");
    const s = state(path); s.next.actor = "CODEX"; save(path, s); rejected(path, f, "human_approval_required");
  });
  it.each(["CLAUDE", "CODEX", "CI", "RAILWAY", "ORCHESTRATOR"] as const)("%s cannot close", (actor) => {
    const { path } = fixture(); const f = forTask(path, "READY_FOR_HUMAN_CLOSURE", "STATE_MAINTENANCE", "HUMAN", "CLOSED");
    rejected(path, { ...f, actor, evidence: "CLAIMED" }, "footer_invalid");
  });
  it("HUMAN CI remains structurally forbidden", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_CI", "CI_VERIFICATION", "CI", "PASS"); rejected(path, { ...f, actor: "HUMAN", evidence: "HUMAN_VERIFIED" }, "footer_invalid");
  });
  it("push PASS changes only allowed repository fields and always downgrades to CLAIMED", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_PUSH_AUTHORIZATION", "CONTROLLED_PUSH", "HUMAN", "PASS"); const before = state(path);
    f.result_sha = "A".repeat(40); expect(ingest(path, f).ok).toBe(true); const after = state(path);
    expect(after.repository).toEqual({ ...before.repository, originSha: "a".repeat(40), approvedSha: "a".repeat(40), evidence: "CLAIMED" });
    for (const field of ["product", "ci", "production", "deferred", "blockers"] as const) expect(after[field]).toEqual(before[field]);
  });
  it("push FAIL does not report a successful repository update", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_PUSH_AUTHORIZATION", "CONTROLLED_PUSH", "HUMAN", "FAIL"); const before = state(path);
    expect(ingest(path, f).ok).toBe(true); expect(state(path).repository).toEqual(before.repository);
  });
  it.each(["PASS", "FAIL", "PENDING"] as const)("CI %s retains runId and claims only", (verdict) => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_CI", "CI_VERIFICATION", "CI", verdict); const before = state(path);
    rejected(path, { ...f, evidence: "MACHINE_VERIFIED" }, "footer_invalid");
    expect(ingest(path, f).ok).toBe(true); expect(state(path).ci).toEqual({ runId: before.ci.runId, status: verdict === "PASS" ? "SUCCESS" : verdict === "FAIL" ? "FAILURE" : "PENDING", evidence: "CLAIMED" });
    expect(state(path).production).toEqual(before.production);
  });
  it.each(["HUMAN", "RAILWAY"] as const)("%s production preserves every deployment fact", (actor) => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_PRODUCTION_VERIFICATION", "PRODUCTION_VERIFICATION", actor, "PASS");
    const s = state(path); s.repository.originSha = "e".repeat(40); s.repository.approvedSha = "d".repeat(40); save(path, s); f.baseline_sha = "c".repeat(40);
    rejected(path, { ...f, result_sha: sha }, "footer_invalid");
    expect(ingest(path, f).ok).toBe(true);
    expect(state(path).production).toEqual({ ...s.production, evidence: actor === "HUMAN" ? "HUMAN_VERIFIED" : "CLAIMED" });
  });
  it("UPDATED is structurally valid but never executes arbitrary maintenance", () => {
    const { path } = fixture(); const f = forTask(path, "READY_FOR_HUMAN_CLOSURE", "STATE_MAINTENANCE", "HUMAN", "UPDATED");
    expect(validateAgentReportFooter(f).ok).toBe(true); rejected(path, f, "invalid_transition");
  });
  it("human closure is terminal, preserves roadmap and deferred, and is idempotent", () => {
    const { path } = fixture(); const f = forTask(path, "READY_FOR_HUMAN_CLOSURE", "STATE_MAINTENANCE", "HUMAN", "CLOSED"); const before = state(path);
    expect(ingest(path, f)).toMatchObject({ ok: true, operationalStatus: "CLOSED", revision: 2 });
    expect(state(path).product).toEqual(before.product); expect(state(path).deferred).toEqual(before.deferred);
    expect(state(path).next.humanApprovalRequired).toBe(false); expect(state(path).activeTask).toBeNull();
    expect(ingest(path, f)).toMatchObject({ kind: "DUPLICATE_NOOP", revision: 2 });
    rejected(path, { ...f, attempt: 2, expected_state_revision: 2 }, "invalid_transition");
  });
  it("closure cannot skip an unresolved report gate", () => {
    const { path } = fixture(); const f = forTask(path, "READY_FOR_HUMAN_CLOSURE", "STATE_MAINTENANCE", "HUMAN", "CLOSED");
    rejected(path, { ...f, human_approval_required: true, human_approval_reason: "Unresolved" }, "human_approval_required");
  });
  it("blockers replace wholesale; empty review clears old blockers", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_REVIEW", "INDEPENDENT_REVIEW", "CLAUDE", "HOLD");
    const s = state(path); s.blockers = ["old"]; save(path, s);
    expect(ingest(path, { ...f, blockers: [{ description: "new", blocking: true, requiresHuman: true }], human_approval_required: true, human_approval_reason: "Decision" }).ok).toBe(true);
    expect(state(path).blockers).toEqual(["new"]);
    const other = fixture(); const go = forTask(other.path, "AWAITING_REVIEW", "INDEPENDENT_REVIEW", "CLAUDE", "GO");
    const old = state(other.path); old.blockers = ["resolved"]; save(other.path, old);
    expect(ingest(other.path, go).ok).toBe(true); expect(state(other.path).blockers).toEqual([]); expect(state(other.path).next.taskType).toBe("CONTROLLED_PUSH");
  });
  it("blocking architecture report cannot create an executable Codex route", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_ARCHITECTURE", "ARCHITECTURE_AUDIT", "CLAUDE", "READY_FOR_IMPLEMENTATION");
    expect(ingest(path, { ...f, blockers: [{ description: "Decision", blocking: false, requiresHuman: true }], human_approval_required: true, human_approval_reason: "Decision" }).ok).toBe(true);
    expect(state(path).next).toMatchObject({ actor: "HUMAN", humanApprovalRequired: true, taskType: "ARCHITECTURE_AUDIT" });
  });
  it("nonblocking audit observations do not invent a human gate", () => {
    const { path } = fixture(); const f = forTask(path, "AWAITING_ARCHITECTURE", "ARCHITECTURE_AUDIT", "CLAUDE", "READY_FOR_IMPLEMENTATION");
    expect(ingest(path, { ...f, blockers: [{ description: "Observation", blocking: false, requiresHuman: false }] }).ok).toBe(true);
    expect(state(path).next.actor).toBe("CODEX");
    expect(state(path).blockers).toEqual(["Observation"]);
  });
  it("implementation cannot clear existing blockers", () => {
    const { path } = fixture(); const s = state(path); s.blockers = ["Unresolved"]; save(path, s);
    expect(ingest(path).ok).toBe(true); expect(state(path).blockers).toEqual(s.blockers); expect(state(path).next.actor).toBe("HUMAN");
  });
});

describe("one-shot HUMAN bootstrap", () => {
  const bootstrap = (changes: Partial<AgentReportFooter> = {}) => report({
    task_id: "ORCH-B2-STATE-MAINTENANCE-BOOTSTRAP-001", actor: "HUMAN", task_type: "STATE_MAINTENANCE",
    verdict: "BOOTSTRAP_SYNC", baseline_sha: null, result_sha: null, scope: [], evidence: "HUMAN_VERIFIED", ...changes,
  });
  it("synchronizes only the allowed orchestration fields and records the actual event", () => {
    const { path } = fixture(); const before = state(path); const f = bootstrap();
    expect(ingest(path, f)).toMatchObject({ ok: true, kind: "UPDATED", revision: 2, operationalStatus: "AWAITING_IMPLEMENTATION", nextActor: "CODEX" });
    const after = state(path);
    const expected = structuredClone(before);
    expected.stateRevision = 2; expected.operational.phase = "PHASE_B_3";
    expected.next = { actor: "CODEX", taskType: "IMPLEMENTATION", taskId: "ORCH-B3-IMPL-001",
      task: "Implement Project Operations Orchestrator Phase B.3 task generation and evidence verification.", humanApprovalRequired: false, humanApprovalReason: null };
    expected.lastTask = { task_id: f.task_id, attempt: 1, actor: "HUMAN", task_type: "STATE_MAINTENANCE", verdict: "BOOTSTRAP_SYNC", footerDigest: footerDigest(f), at: timestamp };
    expect(after).toEqual(expected);
    for (const field of ["project", "schemaVersion", "repository", "product", "ci", "production", "blockers", "deferred", "activeTask"] as const) {
      expect(canonicalJson(after[field])).toBe(canonicalJson(before[field]));
    }
    expect(after.operational.milestone).toBe(before.operational.milestone);
    expect(fs.readFileSync(path, "utf8")).toBe(serializeProjectState(expected));
    expect(parseProjectState(serializeProjectState(expected))).toEqual({ ok: true, state: expected });
  });
  const stateChanges: [string, (s: ProjectState) => void][] = [
    ["lastTask", (s) => { s.lastTask = { task_id: "OTHER-TASK-001", attempt: 1, task_type: "IMPLEMENTATION", actor: "CODEX", verdict: "READY_FOR_REVIEW", footerDigest: "a".repeat(64), at: timestamp }; }],
    ["activeTask", (s) => { s.activeTask = { task_id: "ORCH-B2-IMPL-001", attempt: 1, actor: "CODEX", task_type: "IMPLEMENTATION", startedAt: timestamp }; }],
    ["phase", (s) => { s.operational.phase = "PHASE_B_3"; }],
    ["status", (s) => { s.operational.status = "READY_FOR_HUMAN_CLOSURE"; }],
    ["next actor", (s) => { s.next.actor = "HUMAN"; }],
    ["next task ID", (s) => { s.next.taskId = "OTHER-TASK-001"; }],
    ["next task type", (s) => { s.next.taskType = "STATE_MAINTENANCE"; }],
    ["human gate", (s) => { s.next.humanApprovalRequired = true; s.next.humanApprovalReason = "Unresolved"; }],
    ["blockers", (s) => { s.blockers = ["Nonempty"]; }],
    ["empty roadmap", (s) => { s.product.laterRoadmap = []; }],
    ["duplicated roadmap", (s) => { s.product.laterRoadmap = ["T1.6.2.d", "T1.6.2.d"]; }],
  ];
  it.each(stateChanges)("rejects changed %s with bootstrap_eligibility", (_, change) => {
    const { path } = fixture(); const s = state(path); change(s); save(path, s);
    const before = fs.readFileSync(path);
    expect(ingest(path, bootstrap())).toMatchObject({ ok: false, reason: "invalid_transition", step: "bootstrap_eligibility" });
    expect(fs.readFileSync(path)).toEqual(before); expect(loadProjectState(path).ok).toBe(true); expect(fs.existsSync(`${path}.lock`)).toBe(false);
  });
  it.each([
    ["lastClosed", "T1.6.2.d"], ["status", "OPEN"], ["nextAfterOrchestratorMvp", "T1.6.2.d"],
  ])("invalid product %s fails full state validation first", (key, value) => {
    const { path } = fixture(); const s = state(path); const bad = { ...s, product: { ...s.product, [key]: value } };
    const raw = JSON.stringify(bad); fs.writeFileSync(path, raw);
    expect(ingest(path, bootstrap())).toMatchObject({ ok: false, reason: "state_invalid" }); expect(fs.readFileSync(path, "utf8")).toBe(raw);
    expect(fs.existsSync(`${path}.lock`)).toBe(false);
  });
  it.each([{ humanApprovalRequired: true }, { humanApprovalReason: "Unresolved" }])("inconsistent stored approval fields fail state validation: %j", (change) => {
    const { path } = fixture(); const s = state(path); const raw = JSON.stringify({ ...s, next: { ...s.next, ...change } }); fs.writeFileSync(path, raw);
    expect(ingest(path, bootstrap())).toMatchObject({ ok: false, reason: "state_invalid" }); expect(fs.readFileSync(path, "utf8")).toBe(raw);
  });
  it.each([0, 2, 3])("rejects footer revision %d", (revision) => {
    const { path } = fixture(); rejected(path, bootstrap({ expected_state_revision: revision }), "stale_revision");
  });
  it.each([2, 3])("rejects matching state/footer revision %d", (revision) => {
    const { path } = fixture(); const s = state(path); s.stateRevision = revision; save(path, s);
    rejected(path, bootstrap({ expected_state_revision: revision }), "stale_revision");
  });
  it.each([
    { task_id: "OTHER-BOOTSTRAP-001" }, { attempt: 2 }, { evidence: "CLAIMED" }, { evidence: "UNKNOWN" },
    { blockers: [{ description: "Even nonblocking", blocking: false, requiresHuman: false }] },
    { human_approval_required: true, human_approval_reason: "Gate" },
    { blockers: [{ description: "Blocking", blocking: true, requiresHuman: true }], human_approval_required: true, human_approval_reason: "Gate" },
  ] satisfies Partial<AgentReportFooter>[])("rejects bootstrap footer policy mismatch %j", (change) => {
    const { path } = fixture(); const f = bootstrap(change); expect(validateAgentReportFooter(f).ok).toBe(true);
    rejected(path, f, "invalid_transition");
  });
  it.each([
    { baseline_sha: sha }, { result_sha: sha }, { scope: ["tools/file.ts"] }, { evidence: "MACHINE_VERIFIED" },
    { human_approval_required: true }, { human_approval_reason: "Unexpected" },
  ] satisfies Partial<AgentReportFooter>[])("keeps structural errors ahead of bootstrap eligibility: %j", (change) => {
    const { path } = fixture(); rejected(path, bootstrap(change), "footer_invalid");
  });
  it.each(["CLAUDE", "CODEX", "CI", "RAILWAY", "ORCHESTRATOR"] as const)("never ingests %s bootstrap", (actor) => {
    const { path } = fixture(); rejected(path, bootstrap({ actor, evidence: "CLAIMED" }), "footer_invalid");
  });
  it.each(["HUMAN", "CLAUDE", "CI", "RAILWAY", "ORCHESTRATOR", null] as const)("ignores advisory actor %s", (next_actor_suggested) => {
    const { path } = fixture(); expect(ingest(path, bootstrap({ next_actor_suggested })).ok).toBe(true);
    expect(state(path).next).toMatchObject({ actor: "CODEX", taskType: "IMPLEMENTATION", taskId: "ORCH-B3-IMPL-001" });
  });
  it("does not pin prose, historical SHAs, or existing evidence", () => {
    const { path } = fixture(); const s = state(path); s.next.task = "Different human wording";
    s.repository.originSha = "c".repeat(40); s.repository.approvedSha = "d".repeat(40); s.repository.evidence = "CLAIMED";
    s.production.sha = "e".repeat(40); s.product.evidence = "UNKNOWN"; save(path, s);
    expect(ingest(path, bootstrap()).ok).toBe(true);
    expect(state(path).repository).toEqual(s.repository); expect(state(path).production).toEqual(s.production); expect(state(path).product).toEqual(s.product);
  });
  it("replays exactly once, conflicts before stale revision, and rejects altered attempts", () => {
    const { path, dir } = fixture(); const f = bootstrap(); expect(ingest(path, f).ok).toBe(true);
    const bytes = fs.readFileSync(path); const entries = fs.readdirSync(dir);
    expect(ingest(path, reverseKeys(f))).toMatchObject({ ok: true, kind: "DUPLICATE_NOOP", revision: 2 });
    expect(fs.readFileSync(path)).toEqual(bytes); expect(fs.readdirSync(dir)).toEqual(entries);
    rejected(path, bootstrap({ next_actor_suggested: "HUMAN" }), "duplicate_conflict");
    rejected(path, bootstrap({ expected_state_revision: 2 }), "duplicate_conflict");
    rejected(path, bootstrap({ attempt: 2 }), "stale_revision");
    rejected(path, bootstrap({ attempt: 2, expected_state_revision: 2 }), "stale_revision");
    rejected(path, bootstrap({ evidence: "MACHINE_VERIFIED" }), "footer_invalid");
  });
  it("resumes normal rules with B.3 IDs and rejects bootstrap after later progress", () => {
    const { path } = fixture(); expect(ingest(path, bootstrap()).ok).toBe(true);
    const implementation = report({ task_id: "ORCH-B3-IMPL-001", expected_state_revision: 2 });
    rejected(path, { ...implementation, task_id: "ORCH-B2-IMPL-001" }, "unexpected_task");
    expect(ingest(path, implementation)).toMatchObject({ ok: true, revision: 3, operationalStatus: "AWAITING_REVIEW" });
    expect(state(path).next.taskId).toBe("ORCH-B3-INDEPENDENT-REVIEW-003"); rejected(path, bootstrap(), "stale_revision");
  });
  it("unsupported phases reject generated IDs without guessing; duplicates precede this check", () => {
    const { path } = fixture(); const s = state(path); s.operational.phase = "PHASE_B_4"; save(path, s);
    const bytes = fs.readFileSync(path);
    expect(ingest(path)).toMatchObject({ ok: false, reason: "invalid_transition", step: "task_id_policy" }); expect(fs.readFileSync(path)).toEqual(bytes);
    s.operational.phase = "PHASE_B_2B"; save(path, s); expect(ingest(path).ok).toBe(true);
    const updated = state(path); updated.operational.phase = "PHASE_B_4"; save(path, updated);
    expect(ingest(path)).toMatchObject({ kind: "DUPLICATE_NOOP", revision: 2 });
  });
  it("terminal closure does not require a generated prefix", () => {
    const { path } = fixture(); const f = forTask(path, "READY_FOR_HUMAN_CLOSURE", "STATE_MAINTENANCE", "HUMAN", "CLOSED");
    const s = state(path); s.operational.phase = "Future reviewed phase"; save(path, s);
    expect(ingest(path, f)).toMatchObject({ ok: true, operationalStatus: "CLOSED" }); expect(state(path).next.taskId).toBe(f.task_id);
  });
  it("bootstrap failures retain the same lock and atomic-write protections", () => {
    const { path } = fixture(); const before = fs.readFileSync(path); lock(path);
    expect(ingest(path, bootstrap())).toMatchObject({ ok: false, reason: "lock_busy" }); expect(fs.readFileSync(path)).toEqual(before);
    fs.unlinkSync(`${path}.lock`);
    rejected(path, bootstrap(), "write_failed", { fs: { ...fs, renameSync: () => { throw fault("EIO"); } } });
    let renamed = false;
    const renameSync = (a: fs.PathLike, b: fs.PathLike) => { fs.renameSync(a, b); renamed = true; };
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => { if (renamed && args[0] === path) throw fault("EIO"); return fs.readFileSync(...args); }) as typeof fs.readFileSync;
    expect(ingest(path, bootstrap(), { fs: { ...fs, renameSync, readFileSync } })).toMatchObject({ ok: false, reason: "post_write_validation_failed" });
    expect(state(path).stateRevision).toBe(2); const bytes = fs.readFileSync(path);
    expect(ingest(path, bootstrap())).toMatchObject({ kind: "DUPLICATE_NOOP", revision: 2 }); expect(fs.readFileSync(path)).toEqual(bytes);
  });
});

describe("deterministic state serialization", () => {
  it("orders all fields explicitly, prettifies with two spaces and terminates with newline", () => {
    const { path } = fixture(); ingest(path); const s = state(path);
    const reversed = reverseKeys(s) as ProjectState;
    expect(serializeProjectState(reversed)).toBe(serializeProjectState(s));
    expect(fs.readFileSync(path, "utf8")).toBe(serializeProjectState(s));
    expect(serializeProjectState(s)).toMatch(/^\{\n  "schemaVersion": 2,/); expect(serializeProjectState(s).endsWith("\n")).toBe(true);
    expect(parseProjectState(serializeProjectState(s))).toEqual({ ok: true, state: s });
  });
});

describe("exclusive locks and failure-safe persistence", () => {
  it.each([0, 59_999, 60_000, -10_000])("does not break a fresh/future lock (age %d)", (age) => {
    const { path } = fixture(); lock(path, new Date(now().getTime() - age).toISOString()); const bytes = fs.readFileSync(path); const lockBytes = fs.readFileSync(`${path}.lock`);
    expect(ingest(path)).toMatchObject({ ok: false, reason: "lock_busy" }); expect(fs.readFileSync(path)).toEqual(bytes); expect(fs.readFileSync(`${path}.lock`)).toEqual(lockBytes);
  });
  it.each(["{", "{}", "null", JSON.stringify({ pid: 1, hostname: "x", acquiredAt: "yesterday" })])("malformed lock %s fails closed", (raw) => {
    const { path } = fixture(); fs.writeFileSync(`${path}.lock`, raw); const bytes = fs.readFileSync(path);
    expect(ingest(path)).toMatchObject({ ok: false, reason: "lock_busy" }); expect(fs.readFileSync(`${path}.lock`, "utf8")).toBe(raw); expect(fs.readFileSync(path)).toEqual(bytes);
  });
  it("removes a stale lock once and reports the anomaly", () => {
    const { path } = fixture(); lock(path, new Date(now().getTime() - 60_001).toISOString());
    const unlinkSync = vi.fn(fs.unlinkSync);
    expect(ingest(path, report(), { fs: { ...fs, unlinkSync } })).toMatchObject({ ok: true, anomalies: ["stale_lock_removed"] });
    expect(unlinkSync).toHaveBeenCalledTimes(2); expect(unlinkSync.mock.calls.every(([p]) => p === `${path}.lock`)).toBe(true);
  });
  it("does not repeatedly break a lock won by a contender during stale recovery", () => {
    const { path } = fixture(); lock(path, "2026-09-28T11:00:00.000Z"); const bytes = fs.readFileSync(path);
    const openSync = vi.fn(fs.openSync).mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      if (String(args[0]).endsWith(".lock") && !fs.existsSync(`${path}.lock`)) { lock(path); throw fault("EEXIST"); }
      return fs.openSync(...args);
    });
    const unlinkSync = vi.fn(fs.unlinkSync);
    expect(ingest(path, report(), { fs: { ...fs, openSync, unlinkSync } })).toMatchObject({ ok: false, reason: "lock_busy", anomalies: ["stale_lock_removed"] });
    expect(openSync).toHaveBeenCalledTimes(2); expect(unlinkSync).toHaveBeenCalledTimes(1); expect(fs.readFileSync(path)).toEqual(bytes); expect(fs.existsSync(`${path}.lock`)).toBe(true);
  });
  it("lock contents identify the holder while state is read, then release on validation failure", () => {
    const { path } = fixture(); const readFileSync = vi.fn(fs.readFileSync).mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === path) expect(JSON.parse(fs.readFileSync(`${path}.lock`, "utf8"))).toEqual({ pid: process.pid, hostname: expect.any(String), acquiredAt: timestamp });
      return fs.readFileSync(...args);
    }) as typeof fs.readFileSync);
    rejected(path, { ...report(), evidence: "MACHINE_VERIFIED" }, "footer_invalid", { fs: { ...fs, readFileSync: readFileSync as typeof fs.readFileSync } });
  });
  it("temp write failure preserves original and leaves temp inspectable", () => {
    const { path, dir } = fixture(); let calls = 0;
    const writeSync = ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number) => {
      if (++calls > 1) throw fault("ENOSPC"); return fs.writeSync(fd, buffer, offset, length);
    }) as typeof fs.writeSync;
    rejected(path, report(), "write_failed", { fs: { ...fs, writeSync } }); expect(fs.readdirSync(dir).filter((p) => p.includes(".tmp-"))).toHaveLength(1);
  });
  it("temp validation rejects corruption before rename, keeping canonical byte identity", () => {
    const { path } = fixture(); const renameSync = vi.fn(fs.renameSync);
    const readFileSync = vi.fn(fs.readFileSync).mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => String(args[0]).includes(".tmp-") ? "{}" : fs.readFileSync(...args)) as typeof fs.readFileSync);
    rejected(path, report(), "write_failed", { fs: { ...fs, readFileSync: readFileSync as typeof fs.readFileSync, renameSync } }); expect(renameSync).not.toHaveBeenCalled();
  });
  it.each(["lock", "temp"])("fsync failure on %s releases lock and preserves canonical", (target) => {
    const { path } = fixture(); let calls = 0;
    const fsyncSync = (fd: number) => { if (++calls === (target === "lock" ? 1 : 2)) throw fault("EIO"); fs.fsyncSync(fd); };
    rejected(path, report(), target === "lock" ? "lock_busy" : "write_failed", { fs: { ...fs, fsyncSync } });
  });
  it("handles partial writes until the complete bytes have been flushed", () => {
    const { path } = fixture();
    const writeSync = ((fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number) =>
      fs.writeSync(fd, buffer, offset, Math.min(length, 13))) as typeof fs.writeSync;
    expect(ingest(path, report(), { fs: { ...fs, writeSync } }).ok).toBe(true);
    expect(state(path).stateRevision).toBe(2);
  });
  it("does not delete or overwrite another writer's replacement lock", () => {
    const { path } = fixture(); const before = fs.readFileSync(path); let replaced = false;
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).includes(".tmp-") && !replaced) {
        replaced = true; fs.unlinkSync(`${path}.lock`); lock(path, "2026-09-28T12:00:01.000Z");
      }
      return fs.readFileSync(...args);
    }) as typeof fs.readFileSync;
    const result = ingest(path, report(), { fs: { ...fs, readFileSync } });
    expect(result).toMatchObject({ ok: false, reason: "lock_busy", step: "lock_ownership_lost" });
    expect(fs.readFileSync(path)).toEqual(before);
    expect(fs.existsSync(`${path}.lock`)).toBe(true);
  });
  it("does not remove a lock whose contents changed in place", () => {
    const { path } = fixture(); const before = fs.readFileSync(path); let changed = false;
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).includes(".tmp-") && !changed) { changed = true; lock(path, "2026-09-28T12:00:01.000Z"); }
      return fs.readFileSync(...args);
    }) as typeof fs.readFileSync;
    expect(ingest(path, report(), { fs: { ...fs, readFileSync } })).toMatchObject({ ok: false, reason: "lock_busy", anomalies: ["lock_ownership_lost"] });
    expect(fs.readFileSync(path)).toEqual(before); expect(fs.existsSync(`${path}.lock`)).toBe(true);
  });
  it.each(["EPERM", "EBUSY"])("%s retries exactly three attempts, preserving original on exhaustion", (code) => {
    const { path } = fixture(); const renameSync = vi.fn(() => { throw fault(code); }); const sleep = vi.fn(); const unlinkSync = vi.fn(fs.unlinkSync);
    rejected(path, report(), "write_failed", { fs: { ...fs, renameSync, unlinkSync }, sleep });
    expect(renameSync).toHaveBeenCalledTimes(3); expect(sleep.mock.calls).toEqual([[50], [150]]); expect(unlinkSync.mock.calls).toEqual([[`${path}.lock`]]);
  });
  it.each(["EACCES", "ENOENT", "EXDEV"])("%s rename fails immediately", (code) => {
    const { path } = fixture(); const renameSync = vi.fn(() => { throw fault(code); }); const sleep = vi.fn();
    rejected(path, report(), "write_failed", { fs: { ...fs, renameSync }, sleep }); expect(renameSync).toHaveBeenCalledTimes(1); expect(sleep).not.toHaveBeenCalled();
  });
  it("transient rename failure succeeds with no delete-first window", () => {
    const { path } = fixture(); const bytes = fs.readFileSync(path); let calls = 0;
    const renameSync = vi.fn((a: fs.PathLike, b: fs.PathLike) => { expect(fs.readFileSync(path)).toEqual(bytes); if (++calls < 3) throw fault("EPERM"); fs.renameSync(a, b); });
    const unlinkSync = vi.fn(fs.unlinkSync);
    expect(ingest(path, report(), { fs: { ...fs, renameSync, unlinkSync }, sleep: vi.fn() }).ok).toBe(true);
    expect(unlinkSync.mock.calls).toEqual([[`${path}.lock`]]); expect(state(path).stateRevision).toBe(2);
  });
  it("orphan temp is ignored; resubmit succeeds if rename never happened", () => {
    const { path } = fixture(); fs.writeFileSync(`${path}.tmp-orphan`, "broken");
    rejected(path, report(), "write_failed", { fs: { ...fs, renameSync: () => { throw fault("EIO"); } } });
    expect(state(path).stateRevision).toBe(1); expect(ingest(path)).toMatchObject({ kind: "UPDATED", revision: 2 });
  });
  it("post-rename read failure reports failure without rollback; resubmit is a no-op", () => {
    const { path } = fixture(); let renamed = false;
    const renameSync = (a: fs.PathLike, b: fs.PathLike) => { fs.renameSync(a, b); renamed = true; };
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => { if (renamed && args[0] === path) throw fault("EIO"); return fs.readFileSync(...args); }) as typeof fs.readFileSync;
    expect(ingest(path, report(), { fs: { ...fs, renameSync, readFileSync } })).toMatchObject({ ok: false, reason: "post_write_validation_failed" });
    expect(state(path).stateRevision).toBe(2); expect(fs.existsSync(`${path}.lock`)).toBe(false); const bytes = fs.readFileSync(path);
    expect(ingest(path)).toMatchObject({ kind: "DUPLICATE_NOOP", revision: 2 }); expect(fs.readFileSync(path)).toEqual(bytes);
  });
  it("a second writer cannot enter while first writer holds the lock", () => {
    const { path } = fixture(); let checked = false;
    const readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === path && !checked) { checked = true; expect(ingest(path)).toMatchObject({ ok: false, reason: "lock_busy" }); }
      return fs.readFileSync(...args);
    }) as typeof fs.readFileSync;
    expect(ingest(path, report(), { fs: { ...fs, readFileSync: readFileSync as typeof fs.readFileSync } }).ok).toBe(true); expect(checked).toBe(true);
  });
  it("real state remains a byte-identical read-only reference", () => {
    expect(parseProjectState(realBefore.toString()).ok).toBe(true); expect(fs.readFileSync(PROJECT_STATE_PATH)).toEqual(realBefore);
    expect(loadProjectState().ok).toBe(true);
  });
});
