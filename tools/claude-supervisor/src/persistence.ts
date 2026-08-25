// Local, file-based persistence for one task's SupervisorRunState -- see
// this package's own top-level doc comment for the "never store secrets"
// contract. Deliberately plain JSON on disk (task spec: "Prefer storage
// local simplu și auditable: JSON/SQLite numai dacă justificat... Nu
// introduce un server complex inutil.") -- a single small file per task
// is trivially human-readable, diffable, and requires no database
// engine, which a single local supervisor watching one task at a time
// has no real need for.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SupervisorRunState } from "./types.js";

// Deliberately exhaustive rather than a generic "any key containing
// 'key' or 'token'" heuristic -- an explicit allow-list of the ONLY
// fields ever written is safer than a deny-list of forbidden ones, since
// a NEW field added later to SupervisorRunState is safe-by-default here
// (it simply won't be persisted until deliberately added below) rather
// than unsafe-by-default (a deny-list would need updating for every new
// field, and a forgotten update silently leaks whatever the new field
// held).
const PERSISTED_FIELDS: readonly (keyof SupervisorRunState)[] = [
  "taskId",
  "state",
  "executorSessionId",
  "restartCount",
  "correctionCount",
  "recentCorrectionFingerprints",
  "lastKnownHeadSha",
  "lastDiffSummary",
  "createdAt",
  "updatedAt",
  "lastAction",
];

export function serializeRunState(state: SupervisorRunState): string {
  const redacted: Partial<SupervisorRunState> = {};
  for (const field of PERSISTED_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (redacted as any)[field] = state[field];
  }
  return JSON.stringify(redacted, null, 2);
}

export interface LoadRunStateResult {
  ok: boolean;
  state?: SupervisorRunState;
  reason?: string;
}

export function loadRunStateFromDisk(filePath: string): LoadRunStateResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    return { ok: false, reason: `read_failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `parse_failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "not_an_object" };
  }
  const record = parsed as Record<string, unknown>;
  for (const field of PERSISTED_FIELDS) {
    if (!(field in record)) {
      return { ok: false, reason: `missing_field:${field}` };
    }
  }
  return { ok: true, state: record as unknown as SupervisorRunState };
}

export function saveRunStateToDisk(filePath: string, state: SupervisorRunState): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeRunState(state), "utf8");
}

export function runStateFilePath(stateDir: string, taskId: string): string {
  const safeTaskId = taskId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${stateDir}/${safeTaskId}.json`;
}

export function initialRunState(taskId: string, now: () => string = () => new Date().toISOString()): SupervisorRunState {
  const timestamp = now();
  return {
    taskId,
    state: "IDLE",
    executorSessionId: null,
    restartCount: 0,
    correctionCount: 0,
    recentCorrectionFingerprints: [],
    lastKnownHeadSha: null,
    lastDiffSummary: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastAction: "task_created",
  };
}
