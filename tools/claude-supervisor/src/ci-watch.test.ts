import { describe, expect, it, vi } from "vitest";

import { classifyCiOutcome, deriveOwnerRepoFromGit, fetchCheckRuns, pollUntilComplete, type CiWatchResult } from "./ci-watch.js";

function fakeFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body });
}

describe("fetchCheckRuns", () => {
  it("reports overallSuccess=true when every check-run completed with conclusion success", async () => {
    const fetchImpl = fakeFetch({
      check_runs: [{ status: "completed", conclusion: "success", name: "web-quality", html_url: "https://example.com" }],
    });
    const result = await fetchCheckRuns("owner", "repo", "abc123", fetchImpl);
    expect(result.allCompleted).toBe(true);
    expect(result.overallSuccess).toBe(true);
  });

  it("reports overallSuccess=false when a check-run failed", async () => {
    const fetchImpl = fakeFetch({
      check_runs: [{ status: "completed", conclusion: "failure", name: "web-quality" }],
    });
    const result = await fetchCheckRuns("owner", "repo", "abc123", fetchImpl);
    expect(result.allCompleted).toBe(true);
    expect(result.overallSuccess).toBe(false);
  });

  it("reports allCompleted=false while a check is still in_progress -- never declared done early", async () => {
    const fetchImpl = fakeFetch({
      check_runs: [{ status: "in_progress", conclusion: null, name: "web-quality" }],
    });
    const result = await fetchCheckRuns("owner", "repo", "abc123", fetchImpl);
    expect(result.allCompleted).toBe(false);
    expect(result.overallSuccess).toBe(false);
  });

  it("treats a mix of success and skipped as overall success -- skipped is not a failure", async () => {
    const fetchImpl = fakeFetch({
      check_runs: [
        { status: "completed", conclusion: "success", name: "a" },
        { status: "completed", conclusion: "skipped", name: "b" },
      ],
    });
    const result = await fetchCheckRuns("owner", "repo", "abc123", fetchImpl);
    expect(result.overallSuccess).toBe(true);
  });

  it("returns an honest empty/false result when the API response is not ok, never throwing", async () => {
    const fetchImpl = fakeFetch({}, false);
    const result = await fetchCheckRuns("owner", "repo", "abc123", fetchImpl);
    expect(result).toEqual({ allCompleted: false, overallSuccess: false, checks: [], timedOut: false });
  });

  it("returns allCompleted=false (never true) when there are zero check-runs at all -- CI has not started reporting yet", async () => {
    const fetchImpl = fakeFetch({ check_runs: [] });
    const result = await fetchCheckRuns("owner", "repo", "abc123", fetchImpl);
    expect(result.allCompleted).toBe(false);
  });
});

describe("pollUntilComplete", () => {
  it("stops polling as soon as a completed result is observed, never sleeping past it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ check_runs: [{ status: "in_progress", conclusion: null }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ check_runs: [{ status: "completed", conclusion: "success" }] }) });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await pollUntilComplete("owner", "repo", "abc123", fetchImpl, { maxAttempts: 10, sleep });

    expect(result.overallSuccess).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts and returns the last observed (incomplete) result, never hanging forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ check_runs: [{ status: "in_progress", conclusion: null }] }) });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await pollUntilComplete("owner", "repo", "abc123", fetchImpl, { maxAttempts: 3, sleep });

    expect(result.allCompleted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("marks timedOut:true only when the budget was exhausted, never on a genuine early completion", async () => {
    const completedFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ check_runs: [{ status: "completed", conclusion: "success" }] }) });
    const completedResult = await pollUntilComplete("owner", "repo", "abc123", completedFetch, { maxAttempts: 10, sleep: vi.fn() });
    expect(completedResult.timedOut).toBe(false);

    const stuckFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ check_runs: [{ status: "in_progress", conclusion: null }] }) });
    const stuckResult = await pollUntilComplete("owner", "repo", "abc123", stuckFetch, { maxAttempts: 2, sleep: vi.fn() });
    expect(stuckResult.timedOut).toBe(true);
  });
});

describe("deriveOwnerRepoFromGit", () => {
  it("derives owner/repo from a real git remote get-url origin call (injected exec)", async () => {
    const execImpl = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "https://github.com/baciuionut1983/ai-hair-architect.git\n" });
    const result = await deriveOwnerRepoFromGit("/repo", execImpl);
    expect(result).toEqual({ owner: "baciuionut1983", repo: "ai-hair-architect" });
    expect(execImpl).toHaveBeenCalledWith("git", ["remote", "get-url", "origin"], { cwd: "/repo" });
  });

  it("returns null when the git command itself fails, never throwing", async () => {
    const execImpl = vi.fn().mockResolvedValue({ exitCode: 1, stdout: "" });
    expect(await deriveOwnerRepoFromGit("/repo", execImpl)).toBeNull();
  });

  it("returns null when the remote is not a GitHub URL", async () => {
    const execImpl = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "https://gitlab.com/owner/repo.git\n" });
    expect(await deriveOwnerRepoFromGit("/repo", execImpl)).toBeNull();
  });
});

describe("classifyCiOutcome", () => {
  function result(overrides: Partial<CiWatchResult> = {}): CiWatchResult {
    return { allCompleted: true, overallSuccess: true, checks: [], timedOut: false, ...overrides };
  }

  // Test requirement 22: no-checks-expected.
  it("classifies ciPolicy 'none' as no_checks_expected regardless of the (never even needed) result", () => {
    expect(classifyCiOutcome("none", result({ allCompleted: false, overallSuccess: false }))).toBe("no_checks_expected");
  });

  it("classifies zero real checks as no_checks_expected under 'optional' -- never a false failure", () => {
    expect(classifyCiOutcome("optional", result({ checks: [] }))).toBe("no_checks_expected");
  });

  it("classifies zero real checks under 'required' as timed_out (a real anomaly needing review), never a silent success", () => {
    expect(classifyCiOutcome("required", result({ allCompleted: false, overallSuccess: false, checks: [] }))).toBe("timed_out");
  });

  // Test requirement 19: CI success.
  it("classifies a completed, all-successful result as success", () => {
    const r = result({ checks: [{ status: "completed", conclusion: "success", name: "a", htmlUrl: null }] });
    expect(classifyCiOutcome("required", r)).toBe("success");
  });

  // Test requirement 20: CI failure.
  it("classifies a completed, failed result as failure", () => {
    const r = result({ overallSuccess: false, checks: [{ status: "completed", conclusion: "failure", name: "a", htmlUrl: null }] });
    expect(classifyCiOutcome("required", r)).toBe("failure");
  });

  // Test requirement 21: CI cancelled.
  it("classifies a cancelled check-run as cancelled, distinct from a plain failure", () => {
    const r = result({ overallSuccess: false, checks: [{ status: "completed", conclusion: "cancelled", name: "a", htmlUrl: null }] });
    expect(classifyCiOutcome("required", r)).toBe("cancelled");
  });

  it("classifies an exhausted poll budget (never completed) as timed_out when real checks exist", () => {
    const r = result({ allCompleted: false, overallSuccess: false, timedOut: true, checks: [{ status: "in_progress", conclusion: null, name: "a", htmlUrl: null }] });
    expect(classifyCiOutcome("required", r)).toBe("timed_out");
  });
});
