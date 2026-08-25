// CI verification via the GitHub REST API -- see this round's own task
// spec: "Nu considera task final doar pentru că git push a reușit."
// Deliberately does NOT shell out to the `gh` CLI (confirmed absent from
// PATH in this exact environment during Phase 0's own audit) -- uses
// Node's own built-in `fetch` (Node 24, no extra dependency) against the
// public check-runs endpoint, the same approach already proven reliable
// across every Voice/VAD phase in this project's own history.
import { parseGitHubRemoteUrl, type GitHubRemote } from "./remote-parser.js";

export type CiConclusion = "success" | "failure" | "cancelled" | "timed_out" | "action_required" | "neutral" | "skipped" | "stale" | null;

export interface CiCheckStatus {
  status: "queued" | "in_progress" | "completed" | "unknown";
  conclusion: CiConclusion;
  name: string | null;
  htmlUrl: string | null;
}

export interface CiWatchResult {
  allCompleted: boolean;
  overallSuccess: boolean;
  checks: CiCheckStatus[];
  // Set ONLY by pollUntilComplete, ONLY when its own attempt budget was
  // exhausted without ever observing allCompleted -- fetchCheckRuns
  // itself (a single snapshot) never sets this, since one fetch has no
  // notion of "giving up".
  timedOut: boolean;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

interface RawCheckRun {
  status?: string;
  conclusion?: string | null;
  name?: string;
  html_url?: string;
}

interface RawCheckRunsResponse {
  check_runs?: RawCheckRun[];
}

export async function fetchCheckRuns(
  owner: string,
  repo: string,
  sha: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<CiWatchResult> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`;
  const response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) {
    return { allCompleted: false, overallSuccess: false, checks: [], timedOut: false };
  }
  const body = (await response.json()) as RawCheckRunsResponse;
  const runs = body.check_runs ?? [];

  const checks: CiCheckStatus[] = runs.map((run) => ({
    status: (run.status as CiCheckStatus["status"]) ?? "unknown",
    conclusion: (run.conclusion as CiConclusion) ?? null,
    name: run.name ?? null,
    htmlUrl: run.html_url ?? null,
  }));

  const allCompleted = checks.length > 0 && checks.every((check) => check.status === "completed");
  const overallSuccess = allCompleted && checks.every((check) => check.conclusion === "success" || check.conclusion === "skipped");

  return { allCompleted, overallSuccess, checks, timedOut: false };
}

export interface PollCiOptions {
  intervalMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

// Polls until every check-run for the given SHA has completed, or the
// attempt budget is exhausted -- returns whatever the LAST observed
// result was either way, so the caller can distinguish "genuinely
// finished" from "gave up waiting" and choose CI_WAITING vs a timeout
// path accordingly, rather than this function silently deciding that for
// the caller.
export async function pollUntilComplete(
  owner: string,
  repo: string,
  sha: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  options: PollCiOptions = {},
): Promise<CiWatchResult> {
  const intervalMs = options.intervalMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 40;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  let last: CiWatchResult = { allCompleted: false, overallSuccess: false, checks: [], timedOut: false };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    last = await fetchCheckRuns(owner, repo, sha, fetchImpl);
    if (last.allCompleted) return last;
    await sleep(intervalMs);
  }
  return { ...last, timedOut: true };
}

// Real-I/O: derives owner/repo from the actual `origin` remote of a real
// git working tree, so ci-watch.ts never needs owner/repo passed in
// manually -- see this round's own task spec Phase 6. `execImpl` is
// injectable (same convention as everywhere else in this package) so
// tests never need a real git repo just to prove the parsing wiring.
export type GitRemoteExecImpl = (program: string, args: readonly string[], options: { cwd?: string }) => Promise<{ exitCode: number | null; stdout: string }>;

export async function deriveOwnerRepoFromGit(cwd: string, execImpl: GitRemoteExecImpl): Promise<GitHubRemote | null> {
  const result = await execImpl("git", ["remote", "get-url", "origin"], { cwd });
  if (result.exitCode !== 0) return null;
  return parseGitHubRemoteUrl(result.stdout.trim());
}

export type CiOutcome = "success" | "failure" | "cancelled" | "timed_out" | "no_checks_expected";
export type CiPolicy = "required" | "optional" | "none";

// Interprets a FINAL polling result (i.e. after pollUntilComplete has
// either observed allCompleted or exhausted its own attempt budget) in
// light of the task contract's own declared ciPolicy -- see this round's
// own task spec Phase 6: "Supervisor repo-only commits under tools/ may
// legitimately produce 0 web checks because of path filtering... Do not
// falsely fail because no CI is expected." A ciPolicy of "none" never
// even needs the real result inspected; "optional"/"required" only
// differ in how a genuine 0-checks-ever-appeared result is intepreted --
// still never a hard failure either way, since a webhook delay or a
// path-filtered commit are both legitimate, non-task-local causes.
export function classifyCiOutcome(policy: CiPolicy, result: CiWatchResult): CiOutcome {
  if (policy === "none") return "no_checks_expected";
  if (result.checks.length === 0) {
    // "optional": a Supervisor-only-style commit with genuinely no
    // relevant CI is fine, never blocking. "required": zero checks EVER
    // appearing for a task that declared CI as required is a real
    // anomaly (a broken trigger, not a code defect) -- routed to
    // "timed_out" so decide-next-action.ts escalates it for human
    // review instead of silently declaring success.
    return policy === "optional" ? "no_checks_expected" : "timed_out";
  }
  if (!result.allCompleted) return "timed_out";
  if (result.overallSuccess) return "success";
  const anyCancelled = result.checks.some((check) => check.conclusion === "cancelled");
  return anyCancelled ? "cancelled" : "failure";
}
