// Structured [SUPERVISOR] logging with an explicit redaction pass -- see
// this round's own task spec: "Nu loga secrete." The redaction here is
// defense-in-depth ON TOP OF the persistence layer's own allow-list
// (persistence.ts never even HOLDS a secret field to begin with) --
// this module exists specifically because log lines often include
// free-text `action`/`result` strings assembled from command output
// (e.g. an environment variable dump, a stack trace) that could
// incidentally contain a real secret even though no supervisor-owned
// field was ever meant to hold one.
import type { SupervisorLogEntry } from "./types.js";

// Pattern-based, deliberately broad (over-redacting a false positive --
// e.g. a long hex string that happens to look like a token but isn't --
// is a categorically safer failure than under-redacting a real one).
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{12,}/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /(api[_-]?key|apikey|token|secret|password|authorization)\s*[:=]\s*['"]?[^\s'"]{6,}/gi,
];

const REDACTED = "[REDACTED]";

export function redact(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function formatLogEntry(entry: SupervisorLogEntry): string {
  const safe: SupervisorLogEntry = {
    ...entry,
    action: redact(entry.action),
    result: redact(entry.result),
  };
  return `[SUPERVISOR] taskId=${safe.taskId} state=${safe.state} executorSession=${safe.executorSession ?? "none"} action=${safe.action} result=${safe.result} timestamp=${safe.timestamp}`;
}

// Injectable sink (defaults to console.log) so tests never need to
// capture real stdout, matching this project's own established
// dependency-injection convention for anything that touches an external
// side effect.
export function logSupervisorEvent(entry: SupervisorLogEntry, sink: (line: string) => void = console.log): void {
  sink(formatLogEntry(entry));
}
