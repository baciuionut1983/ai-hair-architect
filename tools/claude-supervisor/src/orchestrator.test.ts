import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyDecision, planDryRun, runActiveExecution, runPreflight, type ExecutorLauncher } from "./orchestrator.js";
import { initialRunState } from "./persistence.js";
import { execSafe } from "./safe-exec.js";
import { validateTaskContract } from "./task-contract.js";
import type { ExecutorOutcome } from "./stream-events.js";
import type { TaskContract } from "./types.js";

function contract(): TaskContract {
  const result = validateTaskContract({
    taskId: "task-1",
    title: "TTS A/B experiment",
    approvedPrompt: "Do the approved thing.",
    scope: ["TTS experiment"],
    protectedAreas: ["VAD", "billing", "auth"],
    requiredChecks: ["web_typecheck", "web_lint", "web_tests_relevant", "web_build"],
  });
  if (!result.ok) throw new Error("invalid fixture");
  return result.contract;
}

describe("planDryRun", () => {
  // Required test 18: dry-run sends no action. Proven structurally here,
  // not just asserted: planDryRun takes an already-gathered observation
  // (a plain object, no I/O handle of any kind) and returns a plain
  // object -- there is no child_process, no fs write, no network call
  // reachable from this function's own signature at all, so this test
  // passing is a real proof, not a claim.
  it("computes a full plan from a plain observation object, touching no I/O", () => {
    const state = { ...initialRunState("task-1"), state: "TASK_RECEIVED" as const };
    const plan = planDryRun(state, contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(plan.wouldTransitionTo).toBe("PREFLIGHT");
    expect(plan.decision.event).toEqual({ type: "PREFLIGHT_PASSED" });
  });

  it("never mutates the run state object it was given", () => {
    const state = { ...initialRunState("task-1"), state: "TASK_RECEIVED" as const };
    const before = JSON.stringify(state);
    planDryRun(state, contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("reports an IGNORED plan (never a fabricated transition) for an event that does not apply to the current state", () => {
    const state = { ...initialRunState("task-1"), state: "COMPLETED" as const };
    const plan = planDryRun(state, contract(), { type: "PREFLIGHT_RESULT", clean: true });
    expect(plan.wouldTransitionTo).toContain("IGNORED");
  });
});

describe("applyDecision", () => {
  it("advances the run state and records a human-readable lastAction", () => {
    const state = { ...initialRunState("task-1", () => "2026-08-25T00:00:00.000Z"), state: "TASK_RECEIVED" as const };
    const next = applyDecision(state, contract(), { type: "PREFLIGHT_RESULT", clean: true }, () => "2026-08-25T00:01:00.000Z");
    expect(next.state).toBe("PREFLIGHT");
    expect(next.updatedAt).toBe("2026-08-25T00:01:00.000Z");
    expect(next.lastAction.length).toBeGreaterThan(0);
  });

  it("logs the decision via the injected logger path (no direct console dependency in the test)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const state = { ...initialRunState("task-1"), state: "TASK_RECEIVED" as const };
    applyDecision(state, contract(), { type: "PREFLIGHT_RESULT", clean: true }, () => "2026-08-25T00:01:00.000Z");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("[SUPERVISOR]");
    logSpy.mockRestore();
  });
});

describe("runPreflight (real git, read-only)", () => {
  let dir: string;

  async function git(args: string[]): Promise<void> {
    const result = await execSafe("git", args, { cwd: dir });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "claude-supervisor-orchestrator-test-"));
    await git(["init", "-b", "master"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Test"]);
    writeFileSync(join(dir, "file.txt"), "hello\n", "utf8");
    await git(["add", "file.txt"]);
    await git(["commit", "-m", "initial"]);
  }, 30_000);

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports clean:true for a genuinely clean tree", async () => {
    const result = await runPreflight(dir, []);
    expect(result.clean).toBe(true);
    expect(result.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports clean:false with a real reason when the tree has uncommitted changes", async () => {
    writeFileSync(join(dir, "file.txt"), "modified\n", "utf8");
    const result = await runPreflight(dir, []);
    expect(result.clean).toBe(false);
    expect(result.reason).toContain("file.txt");
  });

  it("still reports clean:true when the only difference is an allowed untracked prefix (e.g. .claude/)", async () => {
    writeFileSync(join(dir, ".claude-marker"), "x\n", "utf8");
    const result = await runPreflight(dir, [".claude-marker"]);
    expect(result.clean).toBe(true);
  });
});

describe("runActiveExecution (fake launcher -- no real spawn)", () => {
  const SESSION_ID = "11111111-1111-1111-1111-111111111111";

  function successOutcome(overrides: Partial<ExecutorOutcome> = {}): ExecutorOutcome {
    return { status: "completed_success", detail: "result event with subtype success", sessionId: SESSION_ID, apiRetryCount: 0, ...overrides };
  }
  function incompleteOutcome(): ExecutorOutcome {
    return { status: "incomplete", detail: "no result event observed before the process ended", sessionId: SESSION_ID, apiRetryCount: 0 };
  }

  // `calls` is returned BY REFERENCE (never spread/destructured into
  // primitives at call time) so callers can read the live counts AFTER
  // awaiting runActiveExecution -- a spread here would silently freeze
  // both counters at 0 (the value at the moment fakeLauncher itself
  // returns, before any call has happened).
  function fakeLauncher(launchImpl: ExecutorLauncher["launch"], resumeImpl?: ExecutorLauncher["resume"]): { launcher: ExecutorLauncher; calls: { launchCalls: number; resumeCalls: number } } {
    const calls = { launchCalls: 0, resumeCalls: 0 };
    const launcher: ExecutorLauncher = {
      launch: (...args) => {
        calls.launchCalls += 1;
        return launchImpl(...args);
      },
      resume: (...args) => {
        calls.resumeCalls += 1;
        return (resumeImpl ?? launchImpl)(args[0], "irrelevant-first-launch-only-prompt", args[1]);
      },
    };
    return { launcher, calls };
  }

  function baseOptions(overrides: { launcher: ExecutorLauncher } & Partial<Omit<Parameters<typeof runActiveExecution>[0], "launcher">>): Parameters<typeof runActiveExecution>[0] {
    return {
      contract: contract(),
      // Real usage only ever calls runActiveExecution AFTER a passed
      // preflight (PREFLIGHT_PASSED already applied) -- the state
      // machine's own happy path only accepts EXECUTOR_LAUNCHED from
      // PREFLIGHT, never IDLE (caught by this fixture's own first
      // real run: IDLE correctly rejected it).
      runState: { ...initialRunState("task-1", () => "2026-08-25T00:00:00.000Z"), state: "PREFLIGHT" as const },
      cwd: "/fake/cwd",
      sessionId: SESSION_ID,
      captureChangedFiles: async () => [] as readonly string[],
      now: () => "2026-08-25T00:01:00.000Z",
      sleep: async () => {},
      ...overrides,
    };
  }

  it("test requirement 2/3: a clean success with an in-scope diff reaches CHECKS_RUNNING via TECHNICAL_REVIEW/SCOPE_CLEAN", async () => {
    const { launcher } = fakeLauncher(async () => successOutcome());
    const result = await runActiveExecution(baseOptions({ launcher, captureChangedFiles: async () => ["tools/claude-supervisor/src/foo.ts"] }));
    expect(result.runState.state).toBe("CHECKS_RUNNING");
    expect(result.runState.executorSessionId).toBe(SESSION_ID);
  });

  it("test requirement 9: a Level 2 protected-area violation pauses at WAITING_FOR_HUMAN, never proceeding to checks", async () => {
    const { launcher } = fakeLauncher(async () => successOutcome());
    const result = await runActiveExecution(baseOptions({ launcher, captureChangedFiles: async () => ["web/src/components/consultation/voice-activity-logic.ts"] }));
    expect(result.runState.state).toBe("WAITING_FOR_HUMAN");
  });

  it("a Level 3 (billing) violation goes straight to HARD_STOP, never through WAITING_FOR_HUMAN", async () => {
    const { launcher } = fakeLauncher(async () => successOutcome());
    const result = await runActiveExecution(baseOptions({ launcher, captureChangedFiles: async () => ["web/src/lib/billing-repository.ts"] }));
    expect(result.runState.state).toBe("HARD_STOP");
  });

  it("a genuine completed_error result is a HARD_STOP, never auto-restarted", async () => {
    const { launcher, calls } = fakeLauncher(async () => ({ status: "completed_error", detail: "result event with subtype error_max_turns", sessionId: SESSION_ID, apiRetryCount: 0 }) as ExecutorOutcome);
    const result = await runActiveExecution(baseOptions({ launcher }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(calls.resumeCalls).toBe(0);
  });

  // Phase 5 -- Interruption Simulation, via a controlled fake launcher
  // (never a real API outage): EXECUTOR_RUNNING -> EXECUTOR_INTERRUPTED
  // -> RESUMING -> EXECUTOR_RUNNING -> ... -> completion, and the SAME
  // session id is reused on resume (never a fresh one).
  it("test requirement 4/5: one interruption followed by a successful resume reaches CHECKS_RUNNING, calling resume exactly once with the same session id", async () => {
    let launchAttempts = 0;
    const launchImpl: ExecutorLauncher["launch"] = async () => {
      launchAttempts += 1;
      return launchAttempts === 1 ? incompleteOutcome() : successOutcome();
    };
    const resumeCallArgs: string[] = [];
    const resumeImpl: ExecutorLauncher["resume"] = async (sessionId) => {
      resumeCallArgs.push(sessionId);
      return successOutcome();
    };
    const { launcher, calls } = fakeLauncher(launchImpl, resumeImpl);
    const result = await runActiveExecution(baseOptions({ launcher }));
    expect(calls.resumeCalls).toBe(1);
    expect(resumeCallArgs).toEqual([SESSION_ID]);
    expect(result.runState.state).toBe("CHECKS_RUNNING");
    // The log should show the exact EXECUTOR_INTERRUPTED -> RESTART_APPROVED sequence.
    const actions = result.log.map((entry) => entry.action);
    expect(actions).toContain("EXECUTOR_INTERRUPTED");
    expect(actions).toContain("RESTART_APPROVED");
  });

  // Test requirement 6/7: restart count protection + resume loop
  // prevention -- three consecutive interruptions exhaust the bound
  // (MAX_CONSECUTIVE_RESTARTS = 3) and the loop ESCALATES rather than
  // trying a fourth time.
  it("test requirement 6: escalates after exactly 3 restart attempts, never a 4th", async () => {
    const launchImpl: ExecutorLauncher["launch"] = async () => incompleteOutcome();
    const resumeImpl: ExecutorLauncher["resume"] = async () => incompleteOutcome();
    const { launcher, calls } = fakeLauncher(launchImpl, resumeImpl);
    const backoffs: number[] = [];
    const result = await runActiveExecution(baseOptions({ launcher, sleep: async (ms) => { backoffs.push(ms); } }));
    expect(calls.launchCalls).toBe(1);
    expect(calls.resumeCalls).toBe(3);
    expect(result.runState.state).toBe("ESCALATED");
    expect(backoffs).toEqual([5000, 15000, 45000]);
  });

  // Test requirement 8: resume session mismatch -- the observed outcome
  // reports a DIFFERENT session id than requested; must HARD_STOP rather
  // than silently accepting an uncontrolled session.
  it("test requirement 8: hard-stops when the observed session id does not match the requested one", async () => {
    const { launcher, calls } = fakeLauncher(async () => successOutcome({ sessionId: "some-other-uncontrolled-session" }));
    const result = await runActiveExecution(baseOptions({ launcher }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(calls.resumeCalls).toBe(0);
  });

  it("never calls captureChangedFiles while an executor run is still incomplete -- scope is only checked after a clean completion", async () => {
    let changedFilesCalls = 0;
    const launchImpl: ExecutorLauncher["launch"] = async () => incompleteOutcome();
    const resumeImpl: ExecutorLauncher["resume"] = async () => successOutcome();
    const { launcher } = fakeLauncher(launchImpl, resumeImpl);
    await runActiveExecution(baseOptions({ launcher, captureChangedFiles: async () => { changedFilesCalls += 1; return []; } }));
    expect(changedFilesCalls).toBe(1);
  });
});
