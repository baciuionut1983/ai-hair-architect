// Ephemeral observations only. No state writer, report parsing, or dispatch.
import { captureGitSnapshot } from "./git-inspect.js";
import { deriveOwnerRepoFromGit, fetchCheckRuns } from "./ci-watch.js";
import { execSafe, gitLogRangeArgs } from "./safe-exec.js";
import type { ProjectState } from "./project-state.js";

const trusted = Symbol("local Git observation");
export type GitObservation = {
  readonly [trusted]: true;
  evidence: "MACHINE_VERIFIED" | "UNKNOWN";
  reason: string;
  head: string | null;
  origin: string | null;
  repository: string | null;
  remoteFresh: boolean;
  trackedClean: boolean | null;
  originAncestorOfHead: boolean | null;
  commitAt: string | null;
  untrackedCount: number;
};
export function isTrustedGit(value: GitObservation): boolean { return value[trusted] === true; }

export async function observeGit(cwd: string, refresh = false, execute: typeof execSafe = execSafe): Promise<GitObservation> {
  const unknown = (reason: string): GitObservation => ({ [trusted]: true, evidence: "UNKNOWN", reason, head: null, origin: null, repository: null,
    remoteFresh: false, trackedClean: null, originAncestorOfHead: null, commitAt: null, untrackedCount: 0 });
  const bounded: typeof execSafe = (program, args, options) => execute(program, args, { ...options, timeoutMs: 15_000 });
  try {
    if (refresh) {
      const fetched = await bounded("git", ["fetch", "origin"], { cwd });
      if (fetched.exitCode !== 0 || fetched.timedOut) return unknown("FETCH_FAILED");
    }
    const checked: typeof execSafe = async (program, args, options) => {
      const r = await bounded(program, args, options);
      if (r.exitCode !== 0 || r.timedOut) throw new Error("observation_failed");
      return r;
    };
    const snapshot = await captureGitSnapshot(cwd, checked);
    const remote = await deriveOwnerRepoFromGit(cwd, checked);
    if (!remote || !/^[A-Za-z0-9_.-]+$/.test(remote.owner) || !/^[A-Za-z0-9_.-]+$/.test(remote.repo)) return unknown("UNSUPPORTED_REMOTE");
    const sha = /^[a-f0-9]{40}$/;
    if (!sha.test(snapshot.headSha) || !sha.test(snapshot.originMasterSha ?? "")) return unknown("INVALID_GIT_IDENTITY");
    const ancestry = await bounded("git", ["merge-base", "--is-ancestor", snapshot.originMasterSha!, snapshot.headSha], { cwd });
    if (ancestry.timedOut || ![0, 1].includes(ancestry.exitCode ?? -1)) return unknown("ANCESTRY_UNAVAILABLE");
    const date = await checked("git", ["show", "-s", "--format=%cI", snapshot.headSha], { cwd });
    const time = Date.parse(date.stdout.trim());
    if (!Number.isFinite(time)) return unknown("COMMIT_TIME_UNAVAILABLE");
    // Reject a HEAD/ref movement during observation instead of binding mixed facts.
    const end = await checked("git", ["rev-parse", "HEAD", "origin/master"], { cwd });
    if (end.stdout.trim() !== `${snapshot.headSha}\n${snapshot.originMasterSha}`) return unknown("GIT_CHANGED_DURING_OBSERVATION");
    return { [trusted]: true, evidence: "MACHINE_VERIFIED", reason: refresh ? "FETCHED_REMOTE_REF" : "LOCAL_CACHED_REMOTE_REF",
      head: snapshot.headSha, origin: snapshot.originMasterSha, repository: `${remote.owner}/${remote.repo}`, remoteFresh: refresh,
      trackedClean: snapshot.statusLines.every((line) => line.startsWith("??")),
      untrackedCount: snapshot.statusLines.filter((line) => line.startsWith("??")).length,
      originAncestorOfHead: ancestry.exitCode === 0, commitAt: new Date(time).toISOString() };
  } catch { return unknown("GIT_UNAVAILABLE"); }
}

export interface CiObservation {
  evidence: "MACHINE_VERIFIED" | "UNKNOWN";
  sha: string | null;
  status: "SUCCESS" | "FAILURE" | "PENDING" | "UNKNOWN";
  reason: string;
  checks: { status: string; conclusion: string | null }[];
  railway: { deploymentChecks: { status: string; conclusion: string | null }[]; runtimeHealth: "UNKNOWN"; migrations: "UNKNOWN"; instanceRunning: "UNKNOWN" };
}
// Fixed endpoint via ci-watch; one bounded request, no polling, no credentials.
export async function observeCi(cwd: string, git: GitObservation, execute: typeof execSafe = execSafe,
  request: typeof fetch = fetch): Promise<CiObservation> {
  const unknown = (reason: string): CiObservation => ({ evidence: "UNKNOWN", sha: git.head, status: "UNKNOWN", reason, checks: [],
    railway: { deploymentChecks: [], runtimeHealth: "UNKNOWN", migrations: "UNKNOWN", instanceRunning: "UNKNOWN" } });
  if (!isTrustedGit(git) || git.evidence !== "MACHINE_VERIFIED" || !git.head) return unknown("GIT_UNAVAILABLE");
  try {
    const remote = await deriveOwnerRepoFromGit(cwd, (p, a, o) => execute(p, a, { ...o, timeoutMs: 15_000 }));
    if (!remote || !/^[A-Za-z0-9_.-]+$/.test(remote.owner) || !/^[A-Za-z0-9_.-]+$/.test(remote.repo)) return unknown("UNSUPPORTED_REMOTE");
    if (`${remote.owner}/${remote.repo}` !== git.repository) return unknown("REMOTE_CHANGED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await fetchCheckRuns(remote.owner, remote.repo, git.head, async (url, init) => {
        const response = await request(url, { ...init, signal: controller.signal, redirect: "error" });
        if (!response.ok) throw new Error("unavailable");
        return response;
      });
      if (!result.checks.length) return unknown("NO_CHECK_RUNS");
      const validStatuses = ["queued", "in_progress", "completed"];
      const validConclusions = ["success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale", null];
      if (result.checks.some((c) => !validStatuses.includes(c.status) || !validConclusions.includes(c.conclusion) || (c.status === "completed" && c.conclusion === null))) return unknown("INVALID_CHECK_RESPONSE");
      const checks = result.checks.map((c) => ({ status: c.status, conclusion: c.conclusion }));
      return { evidence: "MACHINE_VERIFIED", sha: git.head,
        status: result.overallSuccess ? "SUCCESS" : result.allCompleted ? "FAILURE" : "PENDING",
        reason: "OBSERVED_CHECK_RUNS_ONLY_NOT_BRANCH_PROTECTION", checks,
        railway: { deploymentChecks: result.checks.filter((c) => /railway/i.test(c.name ?? "")).map((c) => ({ status: c.status, conclusion: c.conclusion })),
          runtimeHealth: "UNKNOWN", migrations: "UNKNOWN", instanceRunning: "UNKNOWN" } };
    } finally { clearTimeout(timeout); }
  } catch { return unknown("GITHUB_UNAVAILABLE"); }
}

// "CORECȚIE B2.2 ÎNAINTE DE RELEASE" is unrelated; this is the milestone-B
// state-reconciliation task. Represents PUBLISHED evidence (git.origin,
// already captured by a real, trusted GitObservation) separately from
// LOCAL-ONLY commits -- exactly the commits sitting on top of origin/master
// that no human has yet reviewed or approved for push. Reuses the SAME
// trusted GitObservation's own head/origin/originAncestorOfHead facts
// (never re-derives or re-trusts a second, possibly-stale pair) so this
// can never disagree with what the rest of the system already verified.
export interface LocalOnlyCommit {
  readonly sha: string;
  readonly subject: string;
}
export async function listLocalOnlyCommits(cwd: string, git: GitObservation, execute: typeof execSafe = execSafe): Promise<readonly LocalOnlyCommit[] | null> {
  if (!isTrustedGit(git) || git.evidence !== "MACHINE_VERIFIED" || !git.head || !git.origin || git.originAncestorOfHead !== true) return null;
  if (git.head === git.origin) return [];
  const result = await execute("git", gitLogRangeArgs(git.origin, git.head), { cwd, timeoutMs: 15_000 });
  if (result.exitCode !== 0 || result.timedOut) return null;
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const sha = /^[a-f0-9]{40}$/;
  const commits: LocalOnlyCommit[] = [];
  for (const line of lines) {
    const separator = line.indexOf("\x1f");
    if (separator === -1) return null;
    const candidateSha = line.slice(0, separator);
    const subject = line.slice(separator + 1).trim();
    if (!sha.test(candidateSha) || subject.length === 0) return null;
    commits.push({ sha: candidateSha, subject });
  }
  // `git log <origin>..<head>` lists newest first; oldest-first reads as
  // the real chronological application order.
  return commits.reverse();
}

export function assessPush(s: ProjectState, git?: GitObservation): { verdict: "YES" | "NO" | "UNKNOWN"; reason: string } {
  if (s.operational.status !== "AWAITING_PUSH_AUTHORIZATION" || s.next.actor !== "HUMAN" || s.next.taskType !== "CONTROLLED_PUSH"
    || !s.next.humanApprovalRequired || s.blockers.length > 0 || s.activeTask !== null) return { verdict: "NO", reason: "NOT_AT_CLEAR_HUMAN_PUSH_GATE" };
  if (s.lastTask?.actor !== "CLAUDE" || s.lastTask.task_type !== "INDEPENDENT_REVIEW" || s.lastTask.verdict !== "GO") return { verdict: "NO", reason: "REVIEW_GO_NOT_RECORDED" };
  if (!git || !isTrustedGit(git) || git.evidence !== "MACHINE_VERIFIED" || !git.remoteFresh) return { verdict: "UNKNOWN", reason: "FRESH_GIT_REQUIRED" };
  if (git.repository !== s.repository.canonical || s.repository.branch !== "master") return { verdict: "NO", reason: "REPOSITORY_MISMATCH" };
  if (!git.trackedClean || !git.originAncestorOfHead) return { verdict: "NO", reason: "DIRTY_OR_NON_FAST_FORWARD" };
  if (git.head === git.origin) return { verdict: "NO", reason: "ALREADY_AT_ORIGIN" };
  // The latest review footer stores no reviewed SHA. Require an explicit approved
  // snapshot binding too; never infer it from lastTask's opaque digest or prose.
  if (!["MACHINE_VERIFIED", "HUMAN_VERIFIED"].includes(s.repository.evidence) || s.repository.approvedSha !== git.head)
    return { verdict: "UNKNOWN", reason: "APPROVED_HEAD_BINDING_UNAVAILABLE" };
  return { verdict: "YES", reason: "TECHNICALLY_ELIGIBLE_HUMAN_PUSH_STILL_REQUIRED" };
}
