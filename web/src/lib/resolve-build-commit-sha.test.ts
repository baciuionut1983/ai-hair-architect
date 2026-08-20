import { describe, expect, it, vi } from "vitest";

import { resolveBuildCommitSha } from "./resolve-build-commit-sha";

describe("resolveBuildCommitSha", () => {
  // Round 10 root cause: clientBuildSha read "unknown" in production even
  // though Railway built and deployed the correct commit -- Railway's own
  // docs confirm RAILWAY_GIT_COMMIT_SHA is available during the build step
  // for every GitHub-triggered deployment, no git binary or .git directory
  // required at all. This must be preferred over shelling out to git.
  it("prefers RAILWAY_GIT_COMMIT_SHA when Railway has set it, never calling execSync at all", () => {
    const execSync = vi.fn();
    const sha = resolveBuildCommitSha({
      env: { RAILWAY_GIT_COMMIT_SHA: "c9208e207bed8ef3eb6a481548a4a5f0180ec83b" },
      execSync,
    });
    expect(sha).toBe("c9208e207bed8ef3eb6a481548a4a5f0180ec83b");
    expect(execSync).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from RAILWAY_GIT_COMMIT_SHA", () => {
    const sha = resolveBuildCommitSha({
      env: { RAILWAY_GIT_COMMIT_SHA: "  c9208e207bed8ef3eb6a481548a4a5f0180ec83b\n" },
      execSync: vi.fn(),
    });
    expect(sha).toBe("c9208e207bed8ef3eb6a481548a4a5f0180ec83b");
  });

  // Local dev builds (next dev / next build on a laptop): Railway's own
  // variable is never set there, but a real .git directory and git binary
  // normally are -- this keeps local testing of the same mechanism working.
  it("falls back to `git rev-parse HEAD` when RAILWAY_GIT_COMMIT_SHA is not set", () => {
    const execSync = vi.fn().mockReturnValue("abc1234567890abc1234567890abc1234567890\n");
    const sha = resolveBuildCommitSha({ env: {}, execSync });
    expect(sha).toBe("abc1234567890abc1234567890abc1234567890");
    expect(execSync).toHaveBeenCalledWith("git rev-parse HEAD");
  });

  it("falls back to git rev-parse when RAILWAY_GIT_COMMIT_SHA is present but empty/whitespace-only", () => {
    const execSync = vi.fn().mockReturnValue("abc1234567890abc1234567890abc1234567890");
    const sha = resolveBuildCommitSha({ env: { RAILWAY_GIT_COMMIT_SHA: "   " }, execSync });
    expect(sha).toBe("abc1234567890abc1234567890abc1234567890");
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  // The exact root cause this round demonstrated: Railway's containerized
  // build environment doesn't guarantee git is usable at all -- this must
  // never throw or block the build, only degrade to the honest "unknown".
  it("returns 'unknown' (never throws, never blocks the build) when both RAILWAY_GIT_COMMIT_SHA and git itself are unavailable", () => {
    const execSync = vi.fn(() => {
      throw new Error("git: command not found");
    });
    const sha = resolveBuildCommitSha({ env: {}, execSync });
    expect(sha).toBe("unknown");
  });

  it("accepts a Buffer return from execSync (Node's real execSync return type) exactly like a string", () => {
    const execSync = vi.fn().mockReturnValue(Buffer.from("abc1234567890abc1234567890abc1234567890\n"));
    const sha = resolveBuildCommitSha({ env: {}, execSync });
    expect(sha).toBe("abc1234567890abc1234567890abc1234567890");
  });
});
