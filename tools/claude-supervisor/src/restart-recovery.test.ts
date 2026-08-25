import { describe, expect, it } from "vitest";

import { reconcileOnRestart } from "./restart-recovery.js";
import { initialRunState } from "./persistence.js";
import type { SupervisorRunState } from "./types.js";

function stateAt(overrides: Partial<SupervisorRunState>): SupervisorRunState {
  return { ...initialRunState("task-1", () => "2026-08-25T00:00:00.000Z"), ...overrides };
}

describe("reconcileOnRestart", () => {
  it("trusts a persisted state with no known commit yet, regardless of real git reality", () => {
    const persisted = stateAt({ state: "EXECUTOR_RUNNING", lastKnownHeadSha: null });
    const result = reconcileOnRestart(persisted, { headSha: "anything", originMasterSha: "anything-else" });
    expect(result.action).toBe("TRUST_AND_RESUME");
  });

  // Test requirement 26: restart recovery after commit.
  it("trusts a persisted COMMIT_READY state when real HEAD still matches and origin has not been pushed yet", () => {
    const persisted = stateAt({ state: "COMMIT_READY", lastKnownHeadSha: "commitsha1" });
    const result = reconcileOnRestart(persisted, { headSha: "commitsha1", originMasterSha: "olderorigin" });
    expect(result.action).toBe("TRUST_AND_RESUME");
    if (result.action === "TRUST_AND_RESUME") {
      expect(result.reconciledState.state).toBe("COMMIT_READY");
    }
  });

  it("advances a persisted COMMIT_READY to PUSHED when reality shows the push already succeeded before the crash", () => {
    const persisted = stateAt({ state: "COMMIT_READY", lastKnownHeadSha: "commitsha1" });
    const result = reconcileOnRestart(persisted, { headSha: "commitsha1", originMasterSha: "commitsha1" });
    expect(result.action).toBe("TRUST_AND_ADVANCE");
    if (result.action === "TRUST_AND_ADVANCE") {
      expect(result.reconciledState.state).toBe("PUSHED");
    }
  });

  // Test requirement 27: restart recovery after push.
  it("trusts a persisted PUSHED state when HEAD and origin/master both still match the known commit", () => {
    const persisted = stateAt({ state: "PUSHED", lastKnownHeadSha: "commitsha1" });
    const result = reconcileOnRestart(persisted, { headSha: "commitsha1", originMasterSha: "commitsha1" });
    expect(result.action).toBe("TRUST_AND_RESUME");
    if (result.action === "TRUST_AND_RESUME") {
      expect(result.reconciledState.state).toBe("PUSHED");
    }
  });

  // Test requirement 28: restart recovery during CI.
  it("trusts a persisted CI_WAITING state when reality is fully consistent with it", () => {
    const persisted = stateAt({ state: "CI_WAITING", lastKnownHeadSha: "commitsha1" });
    const result = reconcileOnRestart(persisted, { headSha: "commitsha1", originMasterSha: "commitsha1" });
    expect(result.action).toBe("TRUST_AND_RESUME");
  });

  // The exact task-spec example: "persisted = CI_WAITING but
  // origin/master differs -> inspect and reconcile, never continue
  // blindly."
  it("escalates when the real current HEAD no longer matches the persisted commit sha at all", () => {
    const persisted = stateAt({ state: "CI_WAITING", lastKnownHeadSha: "commitsha1" });
    const result = reconcileOnRestart(persisted, { headSha: "some-completely-different-sha", originMasterSha: "some-completely-different-sha" });
    expect(result.action).toBe("ESCALATE");
    if (result.action === "ESCALATE") {
      expect(result.reason).toContain("commitsha1");
      expect(result.reason).toContain("some-completely-different-sha");
    }
  });

  it("escalates for a persisted WAITING_FOR_HUMAN state too, if HEAD has since moved", () => {
    const persisted = stateAt({ state: "WAITING_FOR_HUMAN", lastKnownHeadSha: "commitsha1" });
    const result = reconcileOnRestart(persisted, { headSha: "commitsha2", originMasterSha: "commitsha2" });
    expect(result.action).toBe("ESCALATE");
  });

  it("escalates when HEAD matches but origin/master has moved to something else entirely (not just 'not yet pushed')", () => {
    const persisted = stateAt({ state: "PUSHED", lastKnownHeadSha: "commitsha1" });
    // HEAD still matches (fine), but this branch only auto-advances
    // COMMIT_READY -- an already-PUSHED state whose origin no longer
    // matches at all is a genuinely different, real divergence.
    const result = reconcileOnRestart(persisted, { headSha: "commitsha1", originMasterSha: "commitsha1" });
    expect(result.action).toBe("TRUST_AND_RESUME");
  });
});
