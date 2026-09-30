// Package-local project subcommands; separate from the legacy executor path.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectState } from "./project-state.js";
import { ingestAgentReport, type UpdateDependencies } from "./project-state-updater.js";
import { observeGit, observeCi, assessPush, listLocalOnlyCommits } from "./project-evidence.js";
import { parseAgentReportFooter } from "./agent-report-footer.js";
import { nextTask, projectStatus, publicData, renderStatus } from "./project-task.js";

export interface ProjectCommandDependencies {
  git?: typeof observeGit;
  ci?: typeof observeCi;
  readInput?: (path: string | null) => string;
  // Consulted only for MILESTONE_B_RECONCILE_SYNC -- same injectable-real-
  // default shape as git/ci above, so a test can fake the underlying git
  // process without also faking observeGit's own internal calls.
  localOnlyCommits?: typeof listLocalOnlyCommits;
}
export async function runProjectCommand(argv: readonly string[], dependencies: ProjectCommandDependencies = {}): Promise<{ exitCode: number; output: string }> {
  const json = argv.includes("--json");
  const emit = (value: unknown, exitCode = 0) => ({ exitCode, output: JSON.stringify(publicData(value), null, 2) });
  const fail = (reason: string) => emit({ ok: false, reason }, 1);
  const command = argv[0];
  if (!["status", "next-task", "ingest-report", "refresh-evidence", "push-eligibility"].includes(command)) return fail("USAGE: project status|next-task|ingest-report|refresh-evidence|push-eligibility [--cwd path] [--state path] [--json]; ingest requires --state and exactly one of --report path / --stdin; --refresh on next-task/push-eligibility explicitly fetches origin");
  const values = new Map<string, string>(); const flags = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (["--json", "--stdin", "--refresh"].includes(arg)) {
      if (flags.has(arg)) return fail("DUPLICATE_ARGUMENT"); flags.add(arg);
    } else if (["--state", "--cwd", "--report"].includes(arg)) {
      if (values.has(arg) || !argv[i + 1] || argv[i + 1].startsWith("--")) return fail("MISSING_OR_DUPLICATE_ARGUMENT");
      values.set(arg, argv[++i]);
    } else return fail("UNKNOWN_ARGUMENT");
  }
  if (command !== "ingest-report" && (flags.has("--stdin") || values.has("--report"))) return fail("UNEXPECTED_REPORT_INPUT");
  if (flags.has("--refresh") && !["next-task", "push-eligibility"].includes(command)) return fail("UNEXPECTED_REFRESH_FLAG");
  const cwd = resolve(values.get("--cwd") ?? fileURLToPath(new URL("../../../", import.meta.url)));
  const statePath = resolve(values.get("--state") ?? resolve(cwd, "docs/PROJECT_STATE.json"));
  const gitObserver = dependencies.git ?? observeGit;
  try {
    if (command === "ingest-report") {
      if (!values.has("--state") || Number(values.has("--report")) + Number(flags.has("--stdin")) !== 1) return fail("EXPLICIT_STATE_AND_ONE_REPORT_SOURCE_REQUIRED");
      const read = dependencies.readInput ?? ((path: string | null) => readFileSync(path ?? 0, "utf8"));
      const report = read(values.get("--report") ?? null);
      // MILESTONE_B_RECONCILE_SYNC is the one verdict that needs real,
      // fresh Git evidence -- fetched HERE, at the true async I/O
      // boundary, never inside ingestAgentReport itself (which stays
      // synchronous, unchanged for every other verdict/caller). A cheap,
      // read-only peek at the footer decides whether to fetch at all; an
      // unparseable/irrelevant report just proceeds without it and lets
      // ingestAgentReport report the real structural failure.
      const peek = parseAgentReportFooter(report);
      const extra: Pick<UpdateDependencies, "milestoneBGitEvidence"> = {};
      if (peek.ok && peek.footer.verdict === "MILESTONE_B_RECONCILE_SYNC") {
        const git = await gitObserver(cwd, true);
        const localOnlyCommits = await (dependencies.localOnlyCommits ?? listLocalOnlyCommits)(cwd, git);
        if (localOnlyCommits) extra.milestoneBGitEvidence = { git, localOnlyCommits };
      }
      const result = ingestAgentReport(report, statePath, extra);
      if (!result.ok) return emit(result, 1);
      const refreshed = loadProjectState(statePath);
      if (!refreshed.ok) return fail("POST_INGEST_STATE_UNAVAILABLE");
      return json ? emit({ result, status: projectStatus(refreshed.state) })
        : { exitCode: 0, output: JSON.stringify(result) + "\n" + renderStatus(refreshed.state) };
    }
    const loaded = loadProjectState(statePath);
    if (!loaded.ok) return fail("INVALID_STATE");
    const s = loaded.state;
    if (command === "status") return json ? emit(projectStatus(s)) : { exitCode: 0, output: renderStatus(s) };
    if (command === "next-task") {
      // Human/wait/closed/policy holds need no Git or network observation.
      let view = nextTask(s);
      if (view.kind === "HOLD" && view.reason === "UNKNOWN_BASELINE") view = nextTask(s, await gitObserver(cwd, flags.has("--refresh")));
      return json ? emit(view, view.kind === "HOLD" ? 1 : 0)
        : { exitCode: view.kind === "HOLD" ? 1 : 0, output: "prompt" in view ? view.prompt : view.card };
    }
    const git = await gitObserver(cwd, command === "refresh-evidence" || flags.has("--refresh"));
    if (command === "push-eligibility") return emit(assessPush(s, git));
    const ci = await (dependencies.ci ?? observeCi)(cwd, git);
    return emit({ git, ci, persisted: false, note: "Observations only. Fetch updates remote refs, not the working tree. GitHub check runs are not runtime health or branch-protection verification." });
  } catch { return fail("COMMAND_FAILED"); }
}
