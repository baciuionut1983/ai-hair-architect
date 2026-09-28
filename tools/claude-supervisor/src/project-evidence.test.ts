import { describe, expect, it, vi } from "vitest";
import { observeGit, observeCi, assessPush, type GitObservation } from "./project-evidence.js";
import { loadProjectState } from "./project-state.js";
import type { execSafe, ExecResult } from "./safe-exec.js";

export const baseline = "c97639797ecd93b04d04d0fff553cf3945dd0b65";
const ok = (stdout = ""): ExecResult => ({ exitCode: 0, stdout, stderr: "", timedOut: false });
export function gitExecutor(head = baseline, origin = head, status = ""): typeof execSafe {
  return async (_, args) => {
    if (args[0] === "status") return ok(status);
    if (args[0] === "rev-parse") return ok(args.length === 3 ? `${head}\n${origin}` : args[1] === "HEAD" ? head : origin);
    if (args[0] === "show") return ok("2026-09-28T19:50:00+00:00");
    if (args[0] === "remote") return ok("https://github.com/baciuionut1983/ai-hair-architect.git");
    return ok();
  };
}
export const observed = (head = baseline, origin = head, status = "", fresh = false) => observeGit("fixture", fresh, gitExecutor(head, origin, status));

describe("read-only evidence adapters", () => {
  it("reuses Git inspection with bounded commands, labels cached refs honestly, tolerates untracked artifacts", async () => {
    const run = vi.fn(gitExecutor(baseline, baseline, "?? web/scratch.json"));
    const result = await observeGit("fixture", false, run);
    expect(result).toMatchObject({ evidence: "MACHINE_VERIFIED", head: baseline, origin: baseline, remoteFresh: false, trackedClean: true, untrackedCount: 1 });
    expect(run.mock.calls.some(([, a]) => a[0] === "fetch")).toBe(false);
    expect(run.mock.calls.every(([, , o]) => o?.timeoutMs === 15_000)).toBe(true);
  });
  it.each([" M tracked.ts", "M  staged.ts", "A  staged-new.ts"])("observes dirty tracked/index status %s", async (status) => {
    expect(await observed(baseline, baseline, status)).toMatchObject({ trackedClean: false });
  });
  it("fetch failure becomes UNKNOWN, never cached success", async () => {
    const run = vi.fn(async () => ({ ...ok(), exitCode: 1, stderr: "TOKEN=never-print-me" }));
    const result = await observeGit("fixture", true, run);
    expect(result).toMatchObject({ evidence: "UNKNOWN", reason: "FETCH_FAILED", head: null }); expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("never-print-me");
  });
  it("a failed status command cannot look like a clean tree", async () => {
    const run: typeof execSafe = async (p, a, o) => a[0] === "status" ? { ...ok(), exitCode: 1 } : gitExecutor()(p, a, o);
    expect(await observeGit("fixture", false, run)).toMatchObject({ evidence: "UNKNOWN", trackedClean: null });
  });
  it("detects refs changing during collection", async () => {
    const run: typeof execSafe = async (p, a, o) => a[0] === "rev-parse" && a.length === 3 ? ok("a".repeat(40)) : gitExecutor()(p, a, o);
    expect(await observeGit("fixture", false, run)).toMatchObject({ evidence: "UNKNOWN", reason: "GIT_CHANGED_DURING_OBSERVATION" });
  });
  it("records mismatch/non-ancestry, without guessing success", async () => {
    const run: typeof execSafe = async (p, a, o) => a[0] === "merge-base" ? { ...ok(), exitCode: 1 } : gitExecutor(baseline, "a".repeat(40))(p, a, o);
    expect(await observeGit("fixture", false, run)).toMatchObject({ head: baseline, origin: "a".repeat(40), originAncestorOfHead: false });
  });
  it.each(["success", "failure", null])("observes CI %s bound to the requested SHA", async (conclusion) => {
    const request = vi.fn(async () => new Response(JSON.stringify({ check_runs: [{ name: "tests", status: conclusion ? "completed" : "in_progress", conclusion }] }))) as unknown as typeof fetch;
    const result = await observeCi("fixture", await observed(), gitExecutor(), request);
    expect(result).toMatchObject({ evidence: "MACHINE_VERIFIED", sha: baseline, status: conclusion === "success" ? "SUCCESS" : conclusion === "failure" ? "FAILURE" : "PENDING" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(request).mock.calls[0][0]).toBe(`https://api.github.com/repos/baciuionut1983/ai-hair-architect/commits/${baseline}/check-runs`);
  });
  it.each([403, 429, 500])("GitHub HTTP %d is UNKNOWN", async (status) => {
    const request = vi.fn(async () => new Response("unavailable", { status })) as unknown as typeof fetch;
    expect(await observeCi("fixture", await observed(), gitExecutor(), request)).toMatchObject({ evidence: "UNKNOWN", status: "UNKNOWN" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("network exception, no checks and malformed checks never imply SUCCESS", async () => {
    for (const request of [async () => { throw new Error("TOKEN=secret"); }, async () => new Response('{"check_runs":[]}'),
      async () => new Response('{"check_runs":[{"status":"completed"}]}')]) {
      const result = await observeCi("fixture", await observed(), gitExecutor(), request as typeof fetch);
      expect(result.evidence).toBe("UNKNOWN"); expect(JSON.stringify(result)).not.toContain("secret");
    }
  });
  it("Railway check runs prove only partial deployment-check evidence", async () => {
    const request = async () => new Response(JSON.stringify({ check_runs: [{ name: "Railway deployment TOKEN=private", html_url: "https://secret", status: "completed", conclusion: "success" }] }));
    const result = await observeCi("fixture", await observed(), gitExecutor(), request as typeof fetch);
    expect(result.railway).toEqual({ deploymentChecks: [{ status: "completed", conclusion: "success" }], runtimeHealth: "UNKNOWN", migrations: "UNKNOWN", instanceRunning: "UNKNOWN" });
    expect(JSON.stringify(result)).not.toContain("private"); expect(JSON.stringify(result)).not.toContain("https://secret");
  });
  it("external JSON cannot recreate a trusted Git observation", async () => {
    const serialized = JSON.parse(JSON.stringify(await observed())) as GitObservation;
    const request = vi.fn(); expect(await observeCi("fixture", serialized, gitExecutor(), request)).toMatchObject({ evidence: "UNKNOWN" }); expect(request).not.toHaveBeenCalled();
  });
  it("push is read-only and requires a represented review plus bound, fresh Git facts", async () => {
    const loaded = loadProjectState(); if (!loaded.ok) throw new Error(loaded.reason); const s = loaded.state;
    expect(assessPush(s).verdict).toBe("NO");
    s.operational.status = "AWAITING_PUSH_AUTHORIZATION";
    s.next = { ...s.next, actor: "HUMAN", taskType: "CONTROLLED_PUSH", humanApprovalRequired: true, humanApprovalReason: "Approve" };
    s.lastTask = { ...s.lastTask!, task_type: "INDEPENDENT_REVIEW", actor: "CLAUDE", verdict: "GO" };
    expect(assessPush(s).verdict).toBe("UNKNOWN");
    const git = await observed(baseline, "b".repeat(40), "", true);
    expect(assessPush(s, git)).toMatchObject({ verdict: "UNKNOWN", reason: "APPROVED_HEAD_BINDING_UNAVAILABLE" });
    s.repository.approvedSha = baseline; s.repository.evidence = "HUMAN_VERIFIED";
    expect(assessPush(s, git).verdict).toBe("YES");
    expect(assessPush(s, await observed(baseline, "b".repeat(40), " M file", true)).verdict).toBe("NO");
    s.blockers = ["Stop"]; expect(assessPush(s, git).verdict).toBe("NO");
  });
});
