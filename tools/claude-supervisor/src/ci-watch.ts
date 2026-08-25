// CI verification via the GitHub REST API -- see this round's own task
// spec: "Nu considera task final doar pentru că git push a reușit."
// Deliberately does NOT shell out to the `gh` CLI (confirmed absent from
// PATH in this exact environment during Phase 0's own audit) -- uses
// Node's own built-in `fetch` (Node 24, no extra dependency) against the
// public check-runs endpoint, the same approach already proven reliable
// across every Voice/VAD phase in this project's own history.
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
    return { allCompleted: false, overallSuccess: false, checks: [] };
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

  return { allCompleted, overallSuccess, checks };
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

  let last: CiWatchResult = { allCompleted: false, overallSuccess: false, checks: [] };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    last = await fetchCheckRuns(owner, repo, sha, fetchImpl);
    if (last.allCompleted) return last;
    await sleep(intervalMs);
  }
  return last;
}
