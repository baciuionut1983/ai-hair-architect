import { describe, expect, it, vi } from "vitest";

import { safePushOriginMaster, verifyPushPreconditions, type ExecImpl } from "./push-runner.js";

const EXPECTED = { owner: "baciuionut1983", repo: "ai-hair-architect" };

describe("verifyPushPreconditions", () => {
  it("passes when branch is master and origin matches the expected repository", async () => {
    const execImpl: ExecImpl = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "master\n", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "https://github.com/baciuionut1983/ai-hair-architect.git\n", stderr: "", timedOut: false });
    const result = await verifyPushPreconditions("/repo", EXPECTED, execImpl);
    expect(result.ok).toBe(true);
  });

  it("refuses when the current branch is not master", async () => {
    const execImpl: ExecImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, stdout: "feature-branch\n", stderr: "", timedOut: false });
    const result = await verifyPushPreconditions("/repo", EXPECTED, execImpl);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("feature-branch");
  });

  it("refuses when origin does not match the expected owner/repo", async () => {
    const execImpl: ExecImpl = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "master\n", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "https://github.com/someone-else/other-repo.git\n", stderr: "", timedOut: false });
    const result = await verifyPushPreconditions("/repo", EXPECTED, execImpl);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("someone-else/other-repo");
  });
});

describe("safePushOriginMaster", () => {
  // Test requirement 15: normal push succeeds.
  it("pushes via the fixed `git push origin master` argv and reports success", async () => {
    const execImpl: ExecImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
    const result = await safePushOriginMaster("/repo", execImpl);
    expect(result.ok).toBe(true);
    expect(execImpl).toHaveBeenCalledWith("git", ["push", "origin", "master"], { cwd: "/repo" });
  });

  // Test requirement 16: force push structurally impossible -- proven by
  // the function's own signature (no parameter can add a flag), not just
  // asserted by inspecting one call's argv.
  it("never includes --force/--force-with-lease/any other ref in the argv, by construction", async () => {
    const execImpl: ExecImpl = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
    await safePushOriginMaster("/repo", execImpl);
    const args = (execImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toEqual(["push", "origin", "master"]);
    expect(args).not.toContain("--force");
    expect(args).not.toContain("--force-with-lease");
    expect(args).not.toContain("-f");
  });

  it("reports failure with the real stderr when the push fails", async () => {
    const execImpl: ExecImpl = vi.fn().mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "! [rejected] master -> master (fetch first)", timedOut: false });
    const result = await safePushOriginMaster("/repo", execImpl);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("rejected");
  });
});
