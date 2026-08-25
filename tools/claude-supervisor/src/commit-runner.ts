// Real-I/O commit execution -- the ONLY place that runs `git add`/`git
// commit`, always via safe-exec.ts's own fixed-argv execSafe (never a
// shell string). Stages EXPLICIT file paths only -- there is no
// parameter shape here that could express `git add -A` or a glob; the
// caller (orchestrator.ts) must always pass the exact, already-reviewed
// file list from commit-policy.ts's own filterStageableFiles.
import { execSafe, type ExecResult } from "./safe-exec.js";

export type ExecImpl = (program: string, args: readonly string[], options: { cwd?: string }) => Promise<ExecResult>;

export interface CommitResult {
  ok: boolean;
  sha: string | null;
  reason?: string;
}

export async function stageAndCommit(cwd: string, files: readonly string[], message: string, execImpl: ExecImpl = execSafe): Promise<CommitResult> {
  if (files.length === 0) {
    return { ok: false, sha: null, reason: "no reviewed files to stage -- refusing to commit nothing" };
  }
  const addResult = await execImpl("git", ["add", "--", ...files], { cwd });
  if (addResult.exitCode !== 0) {
    return { ok: false, sha: null, reason: `git add failed: ${addResult.stderr.trim()}` };
  }
  const commitResult = await execImpl("git", ["commit", "-m", message], { cwd });
  if (commitResult.exitCode !== 0) {
    return { ok: false, sha: null, reason: `git commit failed: ${commitResult.stderr.trim()}` };
  }
  const shaResult = await execImpl("git", ["rev-parse", "HEAD"], { cwd });
  if (shaResult.exitCode !== 0 || shaResult.stdout.trim().length === 0) {
    return { ok: false, sha: null, reason: "could not independently read HEAD after commit" };
  }
  return { ok: true, sha: shaResult.stdout.trim() };
}
