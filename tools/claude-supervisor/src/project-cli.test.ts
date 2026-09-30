import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runProjectCommand } from "./project-cli.js";
import { nextTask, renderTask, redact } from "./project-task.js";
import { observeGit, type GitObservation } from "./project-evidence.js";
import { loadProjectState, PROJECT_STATE_PATH, type ProjectState } from "./project-state.js";
import { serializeProjectState, MILESTONE_B_ORIGIN_SHA, MILESTONE_B_LOCAL_ONLY_COMMITS } from "./project-state-updater.js";
import { validateTaskContract } from "./task-contract.js";
import { isCommitAllowed, isPushAllowed } from "./commit-policy.js";
import { execSafe } from "./safe-exec.js";

const baseline = "c97639797ecd93b04d04d0fff553cf3945dd0b65";
const before = readFileSync(PROJECT_STATE_PATH);
const hash = createHash("sha256").update(before).digest("hex");
const dirs: string[] = [];
// Reconstructs the exact real "right after bootstrap, PHASE_B_3, about to
// implement B.3" state this whole file's own tests assume -- NOT a live
// read of the real file, which has since moved past this point (closed,
// then reconciled to milestone B) and would otherwise make every test
// here spuriously fail once the real file advances again (a real,
// pre-existing staleness bug, caught and fixed here as part of the
// milestone-B state-reconciliation task, not a product-work change). See
// project-state-updater.test.ts's own closureFixture/milestoneBFixture
// for the identical, established pattern. Only the structurally-
// irrelevant parts (repository/product/ci/production/project/deferred)
// come from the real file, since these tests only need them to be
// validly-shaped, never their exact historical values.
function current(): ProjectState {
  const loaded = loadProjectState(); if (!loaded.ok) throw new Error(loaded.reason);
  const state: ProjectState = JSON.parse(JSON.stringify(loaded.state));
  state.stateRevision = 2; state.activeTask = null; state.blockers = [];
  state.operational = { milestone: "PROJECT_OPERATIONS_ORCHESTRATOR", phase: "PHASE_B_3", status: "AWAITING_IMPLEMENTATION" };
  state.lastTask = { task_id: "ORCH-B2-STATE-MAINTENANCE-BOOTSTRAP-001", attempt: 1, task_type: "STATE_MAINTENANCE", actor: "HUMAN",
    verdict: "BOOTSTRAP_SYNC", footerDigest: "deaa10e76d1194031df3a00fc8a9002ae634d285f9ce2ba42ee60b7c7b6b778b", at: "2026-09-28T19:45:03.794Z" };
  state.next = { actor: "CODEX", taskType: "IMPLEMENTATION", taskId: "ORCH-B3-IMPL-001",
    task: "Implement Project Operations Orchestrator Phase B.3 task generation and evidence verification.",
    humanApprovalRequired: false, humanApprovalReason: null };
  return state;
}
// The exact shape a successful MILESTONE_B_RECONCILE_SYNC produces --
// mirrors project-state-updater.test.ts's own milestoneBReconcileState
// assertions, reused here to prove next-task generates a real,
// restricted, read-only CLAUDE review task afterward (requirement 5).
function afterMilestoneBReconciliation(): ProjectState {
  const state = current();
  state.schemaVersion = 3; state.stateRevision = 4;
  state.operational = { milestone: "PRODUCT_MILESTONE_B", phase: "MILESTONE_B_CONTINUATION", status: "AWAITING_REVIEW" };
  state.repository = { ...state.repository, originSha: MILESTONE_B_ORIGIN_SHA, approvedSha: MILESTONE_B_ORIGIN_SHA, evidence: "MACHINE_VERIFIED" };
  state.productMilestoneB = { localOnlyCommits: [...MILESTONE_B_LOCAL_ONLY_COMMITS] };
  state.lastTask = { task_id: "ORCH-B4-STATE-MAINTENANCE-RECONCILE-001", attempt: 1, task_type: "STATE_MAINTENANCE", actor: "HUMAN",
    verdict: "MILESTONE_B_RECONCILE_SYNC", footerDigest: "a".repeat(64), at: "2026-09-29T22:30:00.000Z" };
  state.next = { actor: "CLAUDE", taskType: "INDEPENDENT_REVIEW", taskId: "ORCH-B4-INDEPENDENT-REVIEW-004",
    task: "Independently review the 2 implemented-and-tested, unpushed commit(s) (085547b, fbb1ebc) before recommending push authorization to continue milestone B.",
    humanApprovalRequired: false, humanApprovalReason: null };
  return state;
}
function fixture(s = current()) { const dir = mkdtempSync(join(tmpdir(), "orch-b3-")); dirs.push(dir); const path = join(dir, "state.json"); writeFileSync(path, serializeProjectState(s)); return path; }
async function git(head = baseline, origin = head, status = ""): Promise<GitObservation> {
  return observeGit("fixture", false, async (_, args) => ({ exitCode: 0, timedOut: false, stderr: "",
    stdout: args[0] === "remote" ? "https://github.com/baciuionut1983/ai-hair-architect.git" : args[0] === "status" ? status : args[0] === "show" ? "2026-09-28T19:50:00Z" : args[0] === "rev-parse"
      ? args.length === 3 ? `${head}\n${origin}` : args[1] === "HEAD" ? head : origin : "" }));
}
afterEach(() => {
  expect(readFileSync(PROJECT_STATE_PATH)).toEqual(before);
  expect(createHash("sha256").update(readFileSync(PROJECT_STATE_PATH)).digest("hex")).toBe(hash);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("deterministic generation from state + Git + code-owned policy", () => {
  it("dogfoods the actual B.3 snapshot using the independently verified pre-implementation Git baseline fixture", async () => {
    const s = current(); expect(s.stateRevision).toBe(2); expect(s.repository.evidence).toBe("UNKNOWN");
    expect(s.repository.approvedSha).not.toBe(baseline);
    const observation = await git(); const a = nextTask(s, observation); const b = nextTask(s, observation);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(a.kind).toBe("CODEX_TASK");
    if (!("contract" in a)) throw new Error("Expected generated task");
    expect(a.contract).toMatchObject({ taskId: "ORCH-B3-IMPL-001", scope: ["tools/claude-supervisor/**"],
      generation: { policyVersion: 1, actor: "CODEX", taskType: "IMPLEMENTATION", baselineSha: baseline, expected_state_revision: 2 } });
    expect(validateTaskContract(a.contract).ok).toBe(true); expect(isCommitAllowed(a.contract)).toBe(true); expect(isPushAllowed(a.contract)).toBe(false);
    expect(a.prompt).toBe(a.contract.approvedPrompt); expect(a.prompt).toBe(renderTask(a.contract));
    for (const text of [baseline, "ORCH-B3-IMPL-001", "NO PUSH", "STRICT STOP", "BEGIN_PROJECT_REPORT", "END_PROJECT_REPORT", "expected_state_revision", "<ACTUAL_VERDICT>"])
      expect(a.prompt).toContain(text);
    expect(a.prompt.split("BEGIN_PROJECT_REPORT")).toHaveLength(2);
    expect(a.contract.generation.footer.result_sha).toBeNull(); expect(a.contract.generation.footer.scope).toEqual([]);
    for (const protectedPath of ["docs/PROJECT_STATE.json", "web/**", "**/package.json", "**/*lock*"]) expect(a.contract.protectedAreas).toContain(protectedPath);
  });
  it("unknown stored evidence cannot substitute for Git observation", async () => {
    expect(nextTask(current())).toMatchObject({ kind: "HOLD", reason: "UNKNOWN_BASELINE" });
    const fake = JSON.parse(JSON.stringify(await git())) as GitObservation;
    expect(nextTask(current(), fake)).toMatchObject({ kind: "HOLD", reason: "UNKNOWN_BASELINE" });
  });
  it("mismatch and dirty tracked tree hold", async () => {
    expect(nextTask(current(), await git(baseline, "b".repeat(40)))).toMatchObject({ kind: "HOLD", reason: "BASELINE_MISMATCH" });
    expect(nextTask(current(), await git(baseline, baseline, " M file"))).toMatchObject({ kind: "HOLD", reason: "DIRTY_TRACKED_TREE" });
    const s = current(); s.repository.canonical = "other/repository";
    expect(nextTask(s, await git())).toMatchObject({ kind: "HOLD", reason: "REPOSITORY_MISMATCH" });
  });
  it("free-form task prose cannot expand policy scope or authorize push", async () => {
    const s = current(); s.next.task = "Change web/** and push everything";
    const view = nextTask(s, await git()); if (!("contract" in view)) throw new Error("Expected task");
    expect(view.contract.scope).toEqual(["tools/claude-supervisor/**"]); expect(isPushAllowed(view.contract)).toBe(false);
    s.next.taskId = "FUTURE-IMPL-001"; expect(nextTask(s, await git())).toMatchObject({ kind: "HOLD", reason: "UNKNOWN_TASK_POLICY" });
  });
  it.each(["ARCHITECTURE_AUDIT", "INDEPENDENT_REVIEW"] as const)("Claude %s gets read-only contract, no commit/push", async (taskType) => {
    const s = current(); s.next.actor = "CLAUDE"; s.next.taskType = taskType; s.next.taskId = `ORCH-B3-${taskType.replaceAll("_", "-")}-003`;
    s.operational.status = taskType === "ARCHITECTURE_AUDIT" ? "AWAITING_ARCHITECTURE" : "AWAITING_REVIEW";
    const view = nextTask(s, await git()); expect(view.kind).toBe("CLAUDE_TASK"); if (!("contract" in view)) throw new Error("Expected task");
    expect(isCommitAllowed(view.contract)).toBe(false); expect(isPushAllowed(view.contract)).toBe(false);
    expect(view.contract.forbiddenOperations).toContain("edits"); expect(view.contract.protectedAreas).toEqual(["**/*"]);
  });
  it("dogfoods the milestone-B continuation snapshot: generates a real, restricted, read-only INDEPENDENT_REVIEW task for CLAUDE, never regenerating B1/B2", async () => {
    const s = afterMilestoneBReconciliation();
    const observation = await git(MILESTONE_B_LOCAL_ONLY_COMMITS.at(-1)!.sha, MILESTONE_B_ORIGIN_SHA);
    const view = nextTask(s, observation);
    expect(view.kind).toBe("CLAUDE_TASK"); if (!("contract" in view)) throw new Error("Expected generated task");
    expect(view.contract).toMatchObject({ taskId: "ORCH-B4-INDEPENDENT-REVIEW-004", scope: ["web/** (READ ONLY)"],
      generation: { actor: "CLAUDE", taskType: "INDEPENDENT_REVIEW", baselineSha: MILESTONE_B_LOCAL_ONLY_COMMITS.at(-1)!.sha, expected_state_revision: 4 } });
    expect(isCommitAllowed(view.contract)).toBe(false); expect(isPushAllowed(view.contract)).toBe(false);
    for (const forbiddenAction of ["push", "deploy", "PROJECT_STATE mutation", "video generation", "paid AI/provider calls", "commit", "edits"]) {
      expect(view.contract.forbiddenOperations).toContain(forbiddenAction);
    }
    expect(view.contract.protectedAreas).toEqual(["**/*"]);
    for (const text of ["ORCH-B4-INDEPENDENT-REVIEW-004", "NO PUSH", "STRICT STOP", "BEGIN_PROJECT_REPORT", "END_PROJECT_REPORT", "expected_state_revision", "<ACTUAL_VERDICT>"])
      expect(view.prompt).toContain(text);
    // Never re-proposes B1/B2's own already-closed work.
    expect(view.prompt).not.toMatch(/ORCH-B[23]-IMPL/);
    expect(validateTaskContract(view.contract).ok).toBe(true);
  });

  it("uses an established attempt only if the active task matches", async () => {
    const s = current(); s.activeTask = { task_id: s.next.taskId, actor: "CODEX", task_type: "IMPLEMENTATION", attempt: 3, startedAt: "2026-09-28T19:00:00.000Z" };
    const view = nextTask(s, await git()); if (!("contract" in view)) throw new Error("Expected task"); expect(view.contract.generation.attempt).toBe(3);
    s.activeTask.task_id = "OTHER-IMPL-001"; expect(nextTask(s, await git())).toMatchObject({ kind: "HOLD", reason: "ACTIVE_TASK_MISMATCH" });
  });
});

describe("project CLI commands", () => {
  it("status truthfully reports revision 2 and historical UNKNOWN evidence without Git/network calls", async () => {
    const observer = vi.fn(); const s = current(); const path = fixture();
    const result = await runProjectCommand(["status", "--state", path], { git: observer });
    expect(result.exitCode).toBe(0); expect(observer).not.toHaveBeenCalled();
    for (const text of ["PHASE_B_3", "Revision: 2", "CODEX", "ORCH-B3-IMPL-001", "IMPLEMENTATION", "Next after Orchestrator MVP: B", "T1.6.2.d", "Stored repository evidence: UNKNOWN", s.repository.approvedSha]) expect(result.output).toContain(text);
    const json = await runProjectCommand(["status", "--state", path, "--json"]);
    expect(JSON.parse(json.output).storedState).toEqual(s);
  });
  it("next-task emits deterministic text and JSON without default fetch", async () => {
    const path = fixture(); const observation = await git(); const observer = vi.fn<typeof observeGit>(async () => observation);
    const a = await runProjectCommand(["next-task", "--state", path], { git: observer });
    const b = await runProjectCommand(["next-task", "--state", path], { git: observer }); expect(a).toEqual(b);
    expect(observer.mock.calls.every((call) => call[1] === false)).toBe(true);
    const json = await runProjectCommand(["next-task", "--state", path, "--json", "--refresh"], { git: observer });
    expect(JSON.parse(json.output).contract.generation.baselineSha).toBe(baseline); expect(observer).toHaveBeenLastCalledWith(expect.any(String), true);
  });
  it.each([[], ["bad"], ["status", "--state"], ["status", "--unknown"], ["ingest-report"], ["status", "--refresh"],
    ["ingest-report", "--state", "x", "--stdin", "--report", "x"], ["status", "--json", "--json"]].map((args) => ({ args })))("rejects missing/ambiguous args $args", async ({ args }) => {
    expect((await runProjectCommand(args)).exitCode).toBe(1);
  });
  it("invalid state fails without observer calls", async () => {
    const path = fixture(); writeFileSync(path, "{}"); const observer = vi.fn();
    expect((await runProjectCommand(["next-task", "--state", path], { git: observer })).exitCode).toBe(1); expect(observer).not.toHaveBeenCalled();
  });
  it.each(["HUMAN_DECISION", "HOLD", "WAIT_CI", "WAIT_PRODUCTION", "CLOSED"])("presents %s without generating an executable task", async (kind) => {
    const s = current();
    if (kind === "HUMAN_DECISION") { s.next.actor = "HUMAN"; s.next.humanApprovalRequired = true; s.next.humanApprovalReason = "Decision required"; }
    if (kind === "HOLD") s.blockers = ["Unresolved"];
    if (kind === "WAIT_CI") { s.next.actor = "CI"; s.next.taskType = "CI_VERIFICATION"; s.operational.status = "AWAITING_CI"; }
    if (kind === "WAIT_PRODUCTION") { s.next.actor = "RAILWAY"; s.next.taskType = "PRODUCTION_VERIFICATION"; s.operational.status = "AWAITING_PRODUCTION_VERIFICATION"; }
    if (kind === "CLOSED") s.operational.status = "CLOSED";
    const observer = vi.fn(); const result = await runProjectCommand(["next-task", "--state", fixture(s), "--json"], { git: observer });
    expect(JSON.parse(result.output).kind).toBe(kind); expect(result.output).not.toContain('"contract"'); expect(observer).not.toHaveBeenCalled();
  });
  it("refresh explicitly fetches once, returns observations only, never persists them", async () => {
    const path = fixture(); const bytes = readFileSync(path); const observer = vi.fn(async () => git()); const ci = vi.fn(async () => ({ evidence: "UNKNOWN" } as never));
    const result = await runProjectCommand(["refresh-evidence", "--state", path], { git: observer, ci });
    expect(observer).toHaveBeenCalledTimes(1); expect(observer).toHaveBeenCalledWith(expect.any(String), true);
    expect(JSON.parse(result.output).persisted).toBe(false); expect(readFileSync(path)).toEqual(bytes);
    const push = await runProjectCommand(["push-eligibility", "--state", path], { git: observer }); expect(JSON.parse(push.output).verdict).toBe("NO");
  });
  const report = () => ({ schema_version: 1, task_id: "ORCH-B3-IMPL-001", attempt: 1, actor: "CODEX", task_type: "IMPLEMENTATION", baseline_sha: baseline,
    result_sha: null, scope: [], verdict: "READY_FOR_REVIEW", evidence: "CLAIMED", blockers: [], next_actor_suggested: "CLAUDE", human_approval_required: false, human_approval_reason: null, expected_state_revision: 2 });
  const frame = (value: unknown) => `BEGIN_PROJECT_REPORT\n${JSON.stringify(value)}\nEND_PROJECT_REPORT`;
  it("ingests stdin into a TEMP fixture, shows refreshed status, and duplicate is byte-identical", async () => {
    const path = fixture(); const input = vi.fn(() => frame(report()));
    const args = ["ingest-report", "--state", path, "--stdin", "--json"];
    const a = await runProjectCommand(args, { readInput: input }); expect(a.exitCode).toBe(0);
    expect(JSON.parse(a.output)).toMatchObject({ result: { kind: "UPDATED", revision: 3 }, status: { storedState: { next: { actor: "CLAUDE", taskId: "ORCH-B3-INDEPENDENT-REVIEW-003" } } } });
    const bytes = readFileSync(path); const b = await runProjectCommand(args, { readInput: input });
    expect(JSON.parse(b.output).result.kind).toBe("DUPLICATE_NOOP"); expect(readFileSync(path)).toEqual(bytes); expect(input).toHaveBeenCalledWith(null);
  });
  it("ingests an explicit report file", async () => {
    const path = fixture(); const reportPath = path + ".report"; writeFileSync(reportPath, frame(report()));
    expect((await runProjectCommand(["ingest-report", "--state", path, "--report", reportPath])).exitCode).toBe(0);
  });
  it.each([
    [{ evidence: "MACHINE_VERIFIED" }, "footer_invalid"], [{ expected_state_revision: 1 }, "stale_revision"],
    [{ task_id: "OTHER-IMPL-001" }, "unexpected_task"],
    [{ actor: "CLAUDE", task_type: "INDEPENDENT_REVIEW", verdict: "GO" }, "unexpected_actor"],
  ])("ingest failure %s is nonzero without mutation or retry", async (change, reason) => {
    const path = fixture(); const bytes = readFileSync(path); const input = vi.fn(() => frame({ ...report(), ...change }));
    const result = await runProjectCommand(["ingest-report", "--state", path, "--stdin"], { readInput: input });
    expect(result.exitCode).toBe(1); expect(JSON.parse(result.output).reason).toBe(reason); expect(input).toHaveBeenCalledTimes(1); expect(readFileSync(path)).toEqual(bytes);
  });
  it("redacts sensitive text and never echoes raw filesystem errors", async () => {
    const secret = "DATABASE_URL=postgres://user:pass@host/db API_KEY=top-secret ghp_abcdef123456 sk-abcdefghijk";
    const s = current(); s.next.task = secret; s.blockers = [secret];
    const result = await runProjectCommand(["status", "--state", fixture(s), "--json"]);
    for (const token of ["user:pass", "top-secret", "ghp_abcdef123456", "sk-abcdefghijk"]) expect(result.output).not.toContain(token);
    expect(redact("Bearer token-value")).not.toContain("token-value");
    expect((await runProjectCommand(["ingest-report", "--state", fixture(), "--stdin"], { readInput: () => { throw new Error(secret); } })).output).not.toContain(secret);
  });
  // Milestone-B state-reconciliation task. Same exact-value-pinning
  // reconstruction as project-state-updater.test.ts's own
  // milestoneBFixture -- deliberately NOT a live read of the real file.
  function closedForMilestoneB(): ProjectState {
    const state = current(); // reuses current()'s own real project/repository/product/ci/production/deferred passthrough.
    state.stateRevision = 3;
    state.operational = { milestone: "PROJECT_OPERATIONS_ORCHESTRATOR", phase: "ORCHESTRATOR_MVP_CLOSED", status: "CLOSED" };
    state.lastTask = { task_id: "ORCH-B3-STATE-MAINTENANCE-CLOSURE-001", attempt: 1, task_type: "STATE_MAINTENANCE", actor: "HUMAN",
      verdict: "MVP_CLOSURE_SYNC", footerDigest: "bb90415e0b5eafd4d94473f0b8488a20164a43e478f08e236448772de0d893df", at: "2026-09-28T22:17:06.047Z" };
    state.next = { actor: "HUMAN", taskType: "STATE_MAINTENANCE", taskId: "ORCH-B3-STATE-MAINTENANCE-CLOSURE-001",
      task: "Orchestrator MVP CLOSED. No next executable task; the architecture/scope decision for product work B is a separate, later human-initiated action.",
      humanApprovalRequired: false, humanApprovalReason: null };
    return state;
  }
  const milestoneBHeadSha = "f".repeat(40);
  function milestoneGitObserver(origin = MILESTONE_B_ORIGIN_SHA, head = milestoneBHeadSha) {
    return vi.fn(async (cwd: string, refresh: boolean) =>
      observeGit(cwd, refresh, async (_p, args) => ({ exitCode: 0, timedOut: false, stderr: "",
        stdout: args[0] === "remote" ? "https://github.com/baciuionut1983/ai-hair-architect.git"
          : args[0] === "status" ? "" : args[0] === "show" ? "2026-09-29T22:00:00Z"
          : args[0] === "rev-parse" ? (args.length === 3 ? `${head}\n${origin}` : args[1] === "HEAD" ? head : origin) : "" })));
  }
  const milestoneReport = () => ({ schema_version: 1, task_id: "ORCH-B4-STATE-MAINTENANCE-RECONCILE-001", attempt: 1, actor: "HUMAN",
    task_type: "STATE_MAINTENANCE", baseline_sha: null, result_sha: null, scope: [], verdict: "MILESTONE_B_RECONCILE_SYNC", evidence: "HUMAN_VERIFIED",
    blockers: [], next_actor_suggested: "CLAUDE", human_approval_required: false, human_approval_reason: null, expected_state_revision: 3 });

  it("ingest-report never fetches Git for an ordinary report -- only MILESTONE_B_RECONCILE_SYNC triggers fresh evidence", async () => {
    const path = fixture(); const observer = vi.fn();
    const input = vi.fn(() => frame(report()));
    const result = await runProjectCommand(["ingest-report", "--state", path, "--stdin"], { readInput: input, git: observer as never });
    expect(result.exitCode).toBe(0); expect(observer).not.toHaveBeenCalled();
  });

  it("ingest-report fetches fresh, refreshed Git evidence, derives local-only commits, and completes the real milestone-B reconciliation end to end", async () => {
    const path = fixture(closedForMilestoneB());
    const gitObserver = milestoneGitObserver();
    const localOnlyCommits = vi.fn(async () => MILESTONE_B_LOCAL_ONLY_COMMITS);
    const input = vi.fn(() => frame(milestoneReport()));
    const result = await runProjectCommand(["ingest-report", "--state", path, "--stdin", "--json"],
      { readInput: input, git: gitObserver as never, localOnlyCommits: localOnlyCommits as never });
    expect(gitObserver).toHaveBeenCalledTimes(1); expect(gitObserver).toHaveBeenCalledWith(expect.any(String), true);
    expect(localOnlyCommits).toHaveBeenCalledTimes(1);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.result).toMatchObject({ ok: true, kind: "UPDATED", revision: 4, operationalStatus: "AWAITING_REVIEW", nextActor: "CLAUDE" });
    expect(parsed.status.storedState.productMilestoneB).toEqual({ localOnlyCommits: MILESTONE_B_LOCAL_ONLY_COMMITS });
    expect(parsed.status.storedState.repository.originSha).toBe(MILESTONE_B_ORIGIN_SHA);
  });

  it("ingest-report refuses milestone-B reconciliation when fresh Git evidence cannot be derived -- never silently skips verification", async () => {
    const path = fixture(closedForMilestoneB());
    // origin mismatched from the expected published SHA -- Git evidence
    // resolves, but is not the exact expected fact, so the transition
    // itself (not the CLI wiring) must refuse.
    const gitObserver = milestoneGitObserver("b".repeat(40), milestoneBHeadSha);
    const localOnlyCommits = vi.fn(async () => MILESTONE_B_LOCAL_ONLY_COMMITS);
    const input = vi.fn(() => frame(milestoneReport()));
    const result = await runProjectCommand(["ingest-report", "--state", path, "--stdin"],
      { readInput: input, git: gitObserver as never, localOnlyCommits: localOnlyCommits as never });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({ ok: false, reason: "invalid_transition", step: "milestone_b_git_verification" });
  });

  it("ingest-report refuses milestone-B reconciliation when local-only commits cannot be derived -- never falls back to an empty/assumed list", async () => {
    const path = fixture(closedForMilestoneB());
    const gitObserver = milestoneGitObserver();
    const localOnlyCommits = vi.fn(async () => null);
    const input = vi.fn(() => frame(milestoneReport()));
    const result = await runProjectCommand(["ingest-report", "--state", path, "--stdin"],
      { readInput: input, git: gitObserver as never, localOnlyCommits: localOnlyCommits as never });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({ ok: false, reason: "invalid_transition", step: "milestone_b_git_verification" });
  });

  it("existing CLI entry point routes project status without entering the executor", async () => {
    const result = await execSafe(process.execPath, ["--import", "tsx", "src/cli.ts", "project", "status", "--state", fixture(), "--json"], { cwd: process.cwd(), timeoutMs: 15_000 });
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout).storedState.stateRevision).toBe(2);
  });
});
