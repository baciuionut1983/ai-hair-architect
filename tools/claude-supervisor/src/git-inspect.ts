// Independent git verification -- see this round's own task spec's
// TECHNICAL REVIEWER section: "Supervisorul NU trebuie să creadă automat
// raportul Claude... Dacă Claude spune 'X tests passed'... Supervisor
// trebuie... să verifice rezultatul real, nu să copieze afirmația."
// Every function here runs a REAL git command (via safe-exec.ts's own
// fixed-argv execSafe, never a shell string) against the real working
// tree and parses ITS OWN output -- nothing here ever trusts a value the
// executor claimed in its own conversational report.
import { execSafe, GIT_DIFF_NAME_ONLY_ARGS, GIT_DIFF_STAT_ARGS, GIT_STATUS_ARGS, gitRevParseArgs } from "./safe-exec.js";

export interface GitSnapshot {
  headSha: string;
  originMasterSha: string | null;
  statusLines: string[];
  changedFiles: string[];
  diffStatSummary: string | null;
}

// A single, independently-derived snapshot of everything the technical
// review needs -- deliberately gathered together so orchestrator.ts
// never has to remember to call each piece separately, and so a test
// can assert on one coherent object.
export async function captureGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const [headResult, originResult, statusResult, diffNameResult, diffStatResult] = await Promise.all([
    execSafe("git", gitRevParseArgs("HEAD"), { cwd }),
    execSafe("git", gitRevParseArgs("origin/master"), { cwd }),
    execSafe("git", [...GIT_STATUS_ARGS], { cwd }),
    execSafe("git", [...GIT_DIFF_NAME_ONLY_ARGS], { cwd }),
    execSafe("git", [...GIT_DIFF_STAT_ARGS], { cwd }),
  ]);

  const headSha = headResult.stdout.trim();
  const originMasterSha = originResult.exitCode === 0 ? originResult.stdout.trim() : null;
  const statusLines = statusResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const changedFiles = diffNameResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const diffStatSummary = diffStatResult.stdout.trim().length > 0 ? summarizeLastLine(diffStatResult.stdout) : null;

  return { headSha, originMasterSha, statusLines, changedFiles, diffStatSummary };
}

// `git diff --stat`'s own last line is already the canonical "N files
// changed, N insertions(+), N deletions(-)" summary -- reused verbatim
// (never reformatted) so it stays byte-comparable across repeated calls,
// which restart-policy.ts's own detectNoProgressLoop relies on.
function summarizeLastLine(diffStatOutput: string): string {
  const lines = diffStatOutput.trim().split("\n");
  return lines[lines.length - 1]?.trim() ?? "";
}

export async function isWorkingTreeCleanExcept(cwd: string, allowedUntrackedPrefixes: readonly string[]): Promise<boolean> {
  const status = await execSafe("git", [...GIT_STATUS_ARGS], { cwd });
  const lines = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.every((line) => {
    // `git status --short` untracked-entry format is "?? <path>".
    const isUntracked = line.startsWith("??");
    if (!isUntracked) return false;
    const path = line.slice(2).trim();
    return allowedUntrackedPrefixes.some((prefix) => path.startsWith(prefix));
  });
}

export async function verifyHeadMatchesOrigin(cwd: string): Promise<boolean> {
  const snapshot = await captureGitSnapshot(cwd);
  return snapshot.originMasterSha !== null && snapshot.headSha === snapshot.originMasterSha;
}
