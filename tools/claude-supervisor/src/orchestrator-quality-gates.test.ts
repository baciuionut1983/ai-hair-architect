import { describe, expect, it, vi } from "vitest";

import { runQualityGatesAndCommitPush, type ExecutorLauncher, type QualityGatesOptions } from "./orchestrator.js";
import { initialRunState } from "./persistence.js";
import { validateTaskContract } from "./task-contract.js";
import type { CheckExecutionResult } from "./check-runner.js";
import type { CommitResult } from "./commit-runner.js";
import type { PushPreconditionResult, PushResult } from "./push-runner.js";
import type { CiWatchResult } from "./ci-watch.js";
import type { ExecutorOutcome } from "./stream-events.js";
import type { RequiredCheckName, TaskContract } from "./types.js";

const SESSION_ID = "22222222-2222-2222-2222-222222222222";

function contract(overrides: Partial<TaskContract> = {}): TaskContract {
  const result = validateTaskContract({
    taskId: "qg-task-1",
    title: "Quality gates test task",
    approvedPrompt: "Do the approved thing.",
    scope: ["x"],
    protectedAreas: ["VAD", "billing"],
    requiredChecks: ["supervisor_typecheck"],
    allowedOperations: ["commit", "push"],
    ciPolicy: "none",
    productionValidation: "not_required",
    ...overrides,
  });
  if (!result.ok) throw new Error(`invalid fixture: ${result.reason}`);
  return result.contract;
}

function passOutcome(): ExecutorOutcome {
  return { status: "completed_success", detail: "result event with subtype success", sessionId: SESSION_ID, apiRetryCount: 0 };
}
function errorOutcome(): ExecutorOutcome {
  return { status: "completed_error", detail: "result event with subtype error_max_turns", sessionId: SESSION_ID, apiRetryCount: 0 };
}
function passCheck(name: RequiredCheckName): CheckExecutionResult {
  return { check: name, passed: true, exitCode: 0, durationMs: 10, timedOut: false, summary: "ok" };
}
function failCheck(name: RequiredCheckName, summary: string): CheckExecutionResult {
  return { check: name, passed: false, exitCode: 1, durationMs: 10, timedOut: false, summary };
}

function baseOptions(overrides: Partial<QualityGatesOptions> & { launcher?: ExecutorLauncher; runCheck?: QualityGatesOptions["runCheck"] } = {}): QualityGatesOptions {
  const c = overrides.contract ?? contract();
  const defaultLauncher: ExecutorLauncher = {
    launch: vi.fn(),
    resume: vi.fn(async () => passOutcome()),
  };
  return {
    contract: c,
    contractAtLaunch: c,
    runState: { ...initialRunState("qg-task-1", () => "2026-08-25T00:00:00.000Z"), state: "CHECKS_RUNNING" },
    cwd: "/repo",
    sessionId: SESSION_ID,
    launcher: defaultLauncher,
    expectedHeadSha: "headsha0",
    captureChangedFiles: async () => [] as readonly string[],
    captureStatusLines: async () => [] as readonly string[],
    captureHeadSha: async () => "headsha0",
    verifyPushed: async () => true,
    runCheck: async (name) => passCheck(name),
    commit: async (): Promise<CommitResult> => ({ ok: true, sha: "committedsha1" }),
    verifyPushPreconditions: async (): Promise<PushPreconditionResult> => ({ ok: true }),
    executePush: async (): Promise<PushResult> => ({ ok: true }),
    deriveOwnerRepo: async () => ({ owner: "baciuionut1983", repo: "ai-hair-architect" }),
    pollCi: async (): Promise<CiWatchResult> => ({ allCompleted: true, overallSuccess: true, checks: [], timedOut: false }),
    allowedUntrackedPrefixes: [".claude"],
    now: () => "2026-08-25T00:01:00.000Z",
    sleep: async () => {},
    ...overrides,
  };
}

describe("runQualityGatesAndCommitPush -- happy path", () => {
  // Test requirement 1: allowed check passes. + full pipeline to COMPLETED.
  it("runs checks, commits, pushes, and completes (ciPolicy=none) when everything is green and authorized", async () => {
    const result = await runQualityGatesAndCommitPush(baseOptions());
    expect(result.runState.state).toBe("COMPLETED");
  });

  it("stages exactly the independently-captured changed files when committing", async () => {
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: true, sha: "sha1" }));
    await runQualityGatesAndCommitPush(baseOptions({ captureChangedFiles: async () => ["tools/claude-supervisor/src/foo.ts"], commit }));
    expect(commit).toHaveBeenCalledWith("/repo", ["tools/claude-supervisor/src/foo.ts"], expect.any(String));
  });
});

describe("runQualityGatesAndCommitPush -- check failure + correction (test requirements 2, 5)", () => {
  it("test requirement 2: an allowed check failing routes to a correction resume", async () => {
    let call = 0;
    const runCheck = vi.fn(async (name: RequiredCheckName) => {
      call += 1;
      return call === 1 ? failCheck(name, "TS2304: cannot find name") : passCheck(name);
    });
    const resume = vi.fn(async () => passOutcome());
    const result = await runQualityGatesAndCommitPush(baseOptions({ runCheck, launcher: { launch: vi.fn(), resume } }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(result.runState.state).toBe("COMPLETED");
  });

  // Test requirement 5: correction loop success.
  it("succeeds after a correction attempt fixes the check, re-running ALL checks from scratch", async () => {
    let checkCalls = 0;
    const runCheck = vi.fn(async (name: RequiredCheckName) => {
      checkCalls += 1;
      return checkCalls === 1 ? failCheck(name, "first failure") : passCheck(name);
    });
    const resume = vi.fn(async () => passOutcome());
    const result = await runQualityGatesAndCommitPush(baseOptions({ runCheck, launcher: { launch: vi.fn(), resume } }));
    expect(checkCalls).toBe(2); // 1 failing attempt + 1 full re-run that passes
    expect(result.runState.state).toBe("COMPLETED");
  });

  // Test requirement 6: correction loop exhaustion (distinct failures so
  // the fingerprint-repetition path is never the one that fires).
  it("escalates after the correction budget (3) is exhausted with genuinely different failures each time", async () => {
    let call = 0;
    const runCheck = vi.fn(async (name: RequiredCheckName) => {
      call += 1;
      return failCheck(name, `failure attempt ${call}`);
    });
    const resume = vi.fn(async () => passOutcome());
    const result = await runQualityGatesAndCommitPush(baseOptions({ runCheck, launcher: { launch: vi.fn(), resume } }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(resume).toHaveBeenCalledTimes(3);
    expect(call).toBe(4); // 3 corrections attempted + the 4th failure that exhausts the budget
  });

  // Test requirement 7: repeated failure fingerprint escalates (fires
  // BEFORE the plain correction-count bound would, on the 3rd identical
  // failure).
  it("escalates immediately once the identical failure repeats 3 times, even though the count bound alone would allow a 3rd attempt", async () => {
    const runCheck = vi.fn(async (name: RequiredCheckName) => failCheck(name, "always the exact same error"));
    const resume = vi.fn(async () => passOutcome());
    const result = await runQualityGatesAndCommitPush(baseOptions({ runCheck, launcher: { launch: vi.fn(), resume } }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(resume).toHaveBeenCalledTimes(2); // fingerprint repetition detected on the 3rd failure, before a 3rd correction is attempted
  });

  // Test requirement 8: scope changes after correction -> stop.
  it("stops at WAITING_FOR_HUMAN when a correction resume touches a Level 2 protected area", async () => {
    let call = 0;
    const runCheck = vi.fn(async (name: RequiredCheckName) => {
      call += 1;
      return call === 1 ? failCheck(name, "failure") : passCheck(name);
    });
    const resume = vi.fn(async () => passOutcome());
    let changedFilesCall = 0;
    const captureChangedFiles = async () => {
      changedFilesCall += 1;
      return changedFilesCall === 1 ? ["web/src/components/consultation/voice-activity-logic.ts"] : [];
    };
    const result = await runQualityGatesAndCommitPush(baseOptions({ runCheck, launcher: { launch: vi.fn(), resume }, captureChangedFiles }));
    expect(result.runState.state).toBe("WAITING_FOR_HUMAN");
  });

  it("hard-stops immediately on a completed_error correction resume, never retrying", async () => {
    const runCheck = vi.fn(async (name: RequiredCheckName) => failCheck(name, "failure"));
    const resume = vi.fn(async () => errorOutcome());
    const result = await runQualityGatesAndCommitPush(baseOptions({ runCheck, launcher: { launch: vi.fn(), resume } }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe("runQualityGatesAndCommitPush -- staging and protected paths (test requirements 9, 10, 11)", () => {
  // Test requirement 9: explicit staging only -- verified at commit-runner
  // level already; here we verify the ORCHESTRATOR passes exactly the
  // reviewed file list through, never a broader set.
  it("test requirement 9/10/11: never stages a blocked path (.claude/, state/, .env) even if it appeared in the diff", async () => {
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: true, sha: "sha1" }));
    const result = await runQualityGatesAndCommitPush(
      baseOptions({ captureChangedFiles: async () => [".claude/settings.json", "tools/claude-supervisor/src/foo.ts"], commit }),
    );
    // .claude/ being in the diff is ALSO caught earlier by pre-commit-review's own claude_dir_untouched condition -- confirm the run refuses rather than silently filtering and committing anyway.
    expect(result.runState.state).toBe("HARD_STOP");
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("runQualityGatesAndCommitPush -- pre-commit review gate", () => {
  it("hard-stops with NO commit when HEAD does not match the expected sha", async () => {
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: true, sha: "sha1" }));
    const result = await runQualityGatesAndCommitPush(baseOptions({ expectedHeadSha: "headsha0", captureHeadSha: async () => "somethingelse", commit }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(commit).not.toHaveBeenCalled();
  });

  it("hard-stops with NO commit when the contract changed mid-run", async () => {
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: true, sha: "sha1" }));
    const launchedContract = contract();
    const driftedContract = contract({ approvedPrompt: "A completely different, unapproved instruction." });
    const result = await runQualityGatesAndCommitPush(baseOptions({ contractAtLaunch: launchedContract, contract: driftedContract, commit }));
    expect(result.runState.state).toBe("HARD_STOP");
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("runQualityGatesAndCommitPush -- commit/push authorization (test requirements 13, 14, 15, 16)", () => {
  // Test requirement 13: commit denied without contract permission.
  it("stops at WAITING_FOR_HUMAN, never committing, when allowedOperations lacks 'commit'", async () => {
    const commit = vi.fn(async (): Promise<CommitResult> => ({ ok: true, sha: "sha1" }));
    const result = await runQualityGatesAndCommitPush(baseOptions({ contract: contract({ allowedOperations: [] }), commit }));
    expect(result.runState.state).toBe("WAITING_FOR_HUMAN");
    expect(commit).not.toHaveBeenCalled();
  });

  // Test requirement 14: push denied without permission.
  it("stops at WAITING_FOR_HUMAN after a successful LOCAL commit, never pushing, when allowedOperations lacks 'push'", async () => {
    const executePush = vi.fn(async (): Promise<PushResult> => ({ ok: true }));
    const result = await runQualityGatesAndCommitPush(baseOptions({ contract: contract({ allowedOperations: ["commit"] }), executePush }));
    expect(result.runState.state).toBe("WAITING_FOR_HUMAN");
    expect(executePush).not.toHaveBeenCalled();
  });

  // Test requirement 15: normal push succeeds (full pipeline, already
  // covered by the happy-path test above) -- verifies the real argv
  // wiring reaches executePush exactly once.
  it("test requirement 15: calls executePush exactly once on the happy path", async () => {
    const executePush = vi.fn(async (): Promise<PushResult> => ({ ok: true }));
    await runQualityGatesAndCommitPush(baseOptions({ executePush }));
    expect(executePush).toHaveBeenCalledTimes(1);
  });

  // Test requirement 16: force push structurally impossible -- the
  // orchestrator's own PushRunner interface has no parameter that could
  // ever request a force push (proven at push-runner.test.ts's own
  // level); here we confirm the orchestrator never bypasses
  // verifyPushPreconditions.
  it("never calls executePush when verifyPushPreconditions fails", async () => {
    const executePush = vi.fn(async (): Promise<PushResult> => ({ ok: true }));
    const result = await runQualityGatesAndCommitPush(baseOptions({ verifyPushPreconditions: async () => ({ ok: false, reason: "not master" }), executePush }));
    expect(executePush).not.toHaveBeenCalled();
    expect(result.runState.state).toBe("HARD_STOP");
  });

  it("hard-stops if push succeeds but origin/master does not actually match HEAD", async () => {
    const result = await runQualityGatesAndCommitPush(baseOptions({ verifyPushed: async () => false }));
    expect(result.runState.state).toBe("HARD_STOP");
  });
});

describe("runQualityGatesAndCommitPush -- CI (test requirements 19, 20, 21, 22, 23)", () => {
  // Test requirement 19: CI success.
  it("completes when ciPolicy=optional and CI genuinely succeeds", async () => {
    const result = await runQualityGatesAndCommitPush(
      baseOptions({ contract: contract({ ciPolicy: "optional" }), pollCi: async () => ({ allCompleted: true, overallSuccess: true, checks: [{ status: "completed", conclusion: "success", name: "a", htmlUrl: null }], timedOut: false }) }),
    );
    expect(result.runState.state).toBe("COMPLETED");
  });

  // Test requirement 20: CI failure -> correction loop -> exhaustion (kept short: fails every time).
  //
  // FIXTURE NOTE: a CI-correction resume that succeeds sends the whole
  // pipeline back to the top (checks -> commit -> push -> CI again, see
  // orchestrator.ts's own `continue pipeline`), so the SECOND iteration's
  // pre-commit review independently re-checks head_matches_expected
  // against whatever HEAD REALLY is after the first commit. The
  // orchestrator's own local `expectedHeadSha` variable is correctly
  // advanced to the real commit sha after each commit -- but this
  // fixture's OWN `captureHeadSha` fake must track that same reality
  // (what a real `git rev-parse HEAD` would report), or the second
  // iteration falsely fails pre-commit review with a HEAD mismatch
  // instead of ever reaching the CI-correction path this test exists to
  // exercise. Fixed here by making `commit` and `captureHeadSha` share
  // one mutable `currentHead`, exactly like a real repo's HEAD would
  // move after each real commit.
  it("test requirement 20/23: a persistent CI failure enters the correction loop and eventually escalates", async () => {
    let currentHead = "headsha0";
    const commit = vi.fn(async (): Promise<CommitResult> => {
      currentHead = "committedsha1";
      return { ok: true, sha: currentHead };
    });
    const captureHeadSha = async (): Promise<string> => currentHead;
    const pollCi = vi.fn(async (): Promise<CiWatchResult> => ({ allCompleted: true, overallSuccess: false, checks: [{ status: "completed", conclusion: "failure", name: "web-quality", htmlUrl: null }], timedOut: false }));
    const resume = vi.fn(async () => passOutcome());
    const result = await runQualityGatesAndCommitPush(
      baseOptions({ contract: contract({ ciPolicy: "required" }), pollCi, commit, captureHeadSha, launcher: { launch: vi.fn(), resume } }),
    );
    // identical CI failure fingerprint every attempt -> escalates on the 3rd observed failure (fingerprint path), never looping forever.
    expect(result.runState.state).toBe("HARD_STOP");
    expect(pollCi.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // Test requirement 21: CI cancelled.
  it("routes a cancelled CI run to WAITING_FOR_HUMAN, never an automatic correction", async () => {
    const resume = vi.fn(async () => passOutcome());
    const result = await runQualityGatesAndCommitPush(
      baseOptions({
        contract: contract({ ciPolicy: "required" }),
        pollCi: async () => ({ allCompleted: true, overallSuccess: false, checks: [{ status: "completed", conclusion: "cancelled", name: "a", htmlUrl: null }], timedOut: false }),
        launcher: { launch: vi.fn(), resume },
      }),
    );
    expect(result.runState.state).toBe("WAITING_FOR_HUMAN");
    expect(resume).not.toHaveBeenCalled();
  });

  // Test requirement 22: no-checks-expected.
  it("never even calls pollCi when ciPolicy=none -- Supervisor-only commits never falsely fail on missing web CI", async () => {
    const pollCi = vi.fn(async (): Promise<CiWatchResult> => ({ allCompleted: true, overallSuccess: true, checks: [], timedOut: false }));
    const result = await runQualityGatesAndCommitPush(baseOptions({ contract: contract({ ciPolicy: "none" }), pollCi }));
    expect(pollCi).not.toHaveBeenCalled();
    expect(result.runState.state).toBe("COMPLETED");
  });
});

describe("runQualityGatesAndCommitPush -- human production validation (test requirements 24, 25 setup)", () => {
  // Test requirement 24: required human production validation -> WAITING_FOR_HUMAN.
  it("reaches WAITING_FOR_HUMAN with a real production validation request when the contract requires it", async () => {
    const result = await runQualityGatesAndCommitPush(baseOptions({ contract: contract({ productionValidation: "required" }) }));
    expect(result.runState.state).toBe("WAITING_FOR_HUMAN");
    expect(result.productionValidationRequest).toBeDefined();
    expect(result.productionValidationRequest?.commitSha).toBe("committedsha1");
  });

  it("does NOT request production validation when the contract does not require it", async () => {
    const result = await runQualityGatesAndCommitPush(baseOptions({ contract: contract({ productionValidation: "not_required" }) }));
    expect(result.runState.state).toBe("COMPLETED");
    expect(result.productionValidationRequest).toBeUndefined();
  });
});
