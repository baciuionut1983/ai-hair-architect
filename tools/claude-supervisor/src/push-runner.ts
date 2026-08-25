// Real-I/O push execution -- see this round's own task spec Phase 5.
// safePushOriginMaster's own argv is HARD-CODED to exactly `git push
// origin master`: there is no parameter here that could ever add
// `--force`/`--force-with-lease`/a different branch/ref -- a force push
// is STRUCTURALLY impossible from this function's own signature, not
// merely forbidden by policy (test requirement 16).
import { execSafe, type ExecResult } from "./safe-exec.js";
import { deriveOwnerRepoFromGit, type GitRemoteExecImpl } from "./ci-watch.js";

export type ExecImpl = (program: string, args: readonly string[], options: { cwd?: string }) => Promise<ExecResult>;

export interface PushPreconditionResult {
  ok: boolean;
  reason?: string;
}

export interface ExpectedRemote {
  owner: string;
  repo: string;
}

// Verified BEFORE any push attempt: current branch really is master, and
// the real `origin` remote really resolves to the expected repository --
// see this round's own task spec Phase 5's explicit pre-push checklist.
export async function verifyPushPreconditions(cwd: string, expected: ExpectedRemote, execImpl: ExecImpl & GitRemoteExecImpl = execSafe): Promise<PushPreconditionResult> {
  const branchResult = await execImpl("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  const branch = branchResult.stdout.trim();
  if (branchResult.exitCode !== 0 || branch !== "master") {
    return { ok: false, reason: `current branch is not master (got "${branch || "unknown"}")` };
  }
  const remote = await deriveOwnerRepoFromGit(cwd, execImpl);
  if (!remote || remote.owner !== expected.owner || remote.repo !== expected.repo) {
    return {
      ok: false,
      reason: `origin remote does not match expected repository (expected ${expected.owner}/${expected.repo}, got ${remote ? `${remote.owner}/${remote.repo}` : "unparseable"})`,
    };
  }
  return { ok: true };
}

export interface PushResult {
  ok: boolean;
  reason?: string;
}

export async function safePushOriginMaster(cwd: string, execImpl: ExecImpl = execSafe): Promise<PushResult> {
  const result = await execImpl("git", ["push", "origin", "master"], { cwd });
  if (result.exitCode !== 0) {
    return { ok: false, reason: result.stderr.trim() };
  }
  return { ok: true };
}
