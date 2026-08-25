// Deliberately uses a REAL, disposable git repository (created fresh in
// a temp directory for every test) rather than mocking child_process --
// git-inspect.ts's entire reason to exist is "verify the real state, not
// a claim about it", so its own tests hold it to the same standard:
// prove the parsing is correct against real `git` output, not a
// hand-written fixture that might not match what git actually prints.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureGitSnapshot, isWorkingTreeCleanExcept, verifyHeadMatchesOrigin } from "./git-inspect.js";
import { execSafe } from "./safe-exec.js";

let repoDir: string;
let originDir: string;

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await execSafe("git", args, { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), "claude-supervisor-git-test-"));
  originDir = mkdtempSync(join(tmpdir(), "claude-supervisor-git-origin-"));

  await git(originDir, ["init", "--bare", "-b", "master"]);

  await git(repoDir, ["init", "-b", "master"]);
  await git(repoDir, ["config", "user.email", "test@example.com"]);
  await git(repoDir, ["config", "user.name", "Test"]);
  await git(repoDir, ["remote", "add", "origin", originDir]);

  writeFileSync(join(repoDir, "file.txt"), "hello\n", "utf8");
  await git(repoDir, ["add", "file.txt"]);
  await git(repoDir, ["commit", "-m", "initial commit"]);
  await git(repoDir, ["push", "origin", "master"]);
}, 30_000);

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
  rmSync(originDir, { recursive: true, force: true });
});

describe("captureGitSnapshot", () => {
  it("reports the real HEAD sha, matching git rev-parse HEAD directly", async () => {
    const snapshot = await captureGitSnapshot(repoDir);
    const real = await execSafe("git", ["rev-parse", "HEAD"], { cwd: repoDir });
    expect(snapshot.headSha).toBe(real.stdout.trim());
    expect(snapshot.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reports origin/master as matching HEAD right after a clean push", async () => {
    const snapshot = await captureGitSnapshot(repoDir);
    expect(snapshot.originMasterSha).toBe(snapshot.headSha);
  });

  it("detects a real, uncommitted change via git diff --stat / --name-only", async () => {
    writeFileSync(join(repoDir, "file.txt"), "hello\nmore content\n", "utf8");
    const snapshot = await captureGitSnapshot(repoDir);
    expect(snapshot.changedFiles).toEqual(["file.txt"]);
    expect(snapshot.diffStatSummary).toMatch(/1 file changed/);
  });

  it("shows an empty changedFiles/diffStatSummary when the working tree is genuinely clean", async () => {
    const snapshot = await captureGitSnapshot(repoDir);
    expect(snapshot.changedFiles).toEqual([]);
    expect(snapshot.diffStatSummary).toBeNull();
  });

  it("lists a new untracked file in statusLines", async () => {
    writeFileSync(join(repoDir, "untracked.txt"), "new\n", "utf8");
    const snapshot = await captureGitSnapshot(repoDir);
    expect(snapshot.statusLines.some((line: string) => line.includes("untracked.txt"))).toBe(true);
  });
});

describe("isWorkingTreeCleanExcept", () => {
  it("returns true when the tree is fully clean", async () => {
    expect(await isWorkingTreeCleanExcept(repoDir, [])).toBe(true);
  });

  // The exact real-world case this project's own VAD saga hit every
  // single task: an untracked .claude/ directory that must remain
  // untouched (task spec, required test 22).
  it("returns true when the only untracked entry matches an allowed prefix (e.g. .claude/)", async () => {
    writeFileSync(join(repoDir, ".claude-marker"), "x\n", "utf8");
    expect(await isWorkingTreeCleanExcept(repoDir, [".claude-marker"])).toBe(true);
  });

  it("returns false when an untracked entry does NOT match any allowed prefix", async () => {
    writeFileSync(join(repoDir, "unexpected.txt"), "x\n", "utf8");
    expect(await isWorkingTreeCleanExcept(repoDir, [".claude-marker"])).toBe(false);
  });

  it("returns false when a TRACKED file has been modified, even with a matching allowed prefix elsewhere", async () => {
    writeFileSync(join(repoDir, "file.txt"), "modified\n", "utf8");
    expect(await isWorkingTreeCleanExcept(repoDir, [".claude-marker"])).toBe(false);
  });
});

describe("verifyHeadMatchesOrigin", () => {
  it("returns true immediately after a clean push", async () => {
    expect(await verifyHeadMatchesOrigin(repoDir)).toBe(true);
  });

  it("returns false when local HEAD has advanced beyond origin/master (an unpushed local commit)", async () => {
    writeFileSync(join(repoDir, "file2.txt"), "second\n", "utf8");
    await git(repoDir, ["add", "file2.txt"]);
    await git(repoDir, ["commit", "-m", "second commit, not pushed"]);
    expect(await verifyHeadMatchesOrigin(repoDir)).toBe(false);
  });
});
