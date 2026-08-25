import { describe, expect, it, vi } from "vitest";

import { fetchCheckRuns, pollUntilComplete } from "./ci-watch.js";

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
    expect(result).toEqual({ allCompleted: false, overallSuccess: false, checks: [] });
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
});
