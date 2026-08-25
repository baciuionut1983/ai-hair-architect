import { describe, expect, it, vi } from "vitest";

import { stageAndCommit, type ExecImpl } from "./commit-runner.js";

describe("stageAndCommit (fake execImpl -- no real git)", () => {
  it("refuses to commit when the reviewed file list is empty", async () => {
    const execImpl: ExecImpl = vi.fn();
    const result = await stageAndCommit("/repo", [], "msg", execImpl);
    expect(result.ok).toBe(false);
    expect(execImpl).not.toHaveBeenCalled();
  });

  // Test requirement 9: explicit staging only.
  it("stages EXACTLY the given file paths via `git add --`, never -A or a glob", async () => {
    const execImpl: ExecImpl = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123def456\n", stderr: "", timedOut: false });
    await stageAndCommit("/repo", ["a.ts", "b.ts"], "msg", execImpl);
    expect(execImpl).toHaveBeenNthCalledWith(1, "git", ["add", "--", "a.ts", "b.ts"], { cwd: "/repo" });
    const addArgs = (execImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(addArgs).not.toContain("-A");
    expect(addArgs).not.toContain(".");
  });

  it("returns the real, independently re-read HEAD sha after a successful commit", async () => {
    const execImpl: ExecImpl = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123def456\n", stderr: "", timedOut: false });
    const result = await stageAndCommit("/repo", ["a.ts"], "msg", execImpl);
    expect(result).toEqual({ ok: true, sha: "abc123def456" });
  });

  it("fails cleanly when git add fails, never attempting a commit", async () => {
    const execImpl: ExecImpl = vi.fn().mockResolvedValueOnce({ exitCode: 128, stdout: "", stderr: "fatal: pathspec did not match", timedOut: false });
    const result = await stageAndCommit("/repo", ["missing.ts"], "msg", execImpl);
    expect(result.ok).toBe(false);
    expect(execImpl).toHaveBeenCalledTimes(1);
  });

  it("fails cleanly when git commit fails (e.g. nothing to commit)", async () => {
    const execImpl: ExecImpl = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "nothing to commit", timedOut: false });
    const result = await stageAndCommit("/repo", ["a.ts"], "msg", execImpl);
    expect(result.ok).toBe(false);
    expect(result.sha).toBeNull();
  });
});
