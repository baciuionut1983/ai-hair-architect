// Pure validation for TaskContract -- the Supervisor's own single source
// of truth for "what was actually approved for this task". Deliberately
// strict and explicit (every field checked, no silent coercion) since a
// malformed contract accepted silently would mean the Supervisor could
// later enforce the WRONG scope/checks without anyone noticing -- see
// this package's own top-level doc comment on why the contract is
// treated as immutable once accepted.

import type { RequiredCheckName, TaskContract, TaskContractValidationResult } from "./types.js";

const REQUIRED_CHECK_NAMES: ReadonlySet<string> = new Set(["tsc", "eslint", "vitest", "build", "ci"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

// Deliberately requires at least ONE protected area -- a contract with
// zero protected areas would mean scope-guard.ts has nothing to enforce
// at all, which is almost certainly a mistake (every real task in this
// project's own established discipline has named at least one "DO NOT
// MODIFY" area) rather than a genuinely unrestricted task. A task that
// truly has no protected areas can still pass this by naming a
// deliberately narrow one (e.g. the task's own contract file), which is
// an honest signal rather than silent omission.
export function validateTaskContract(input: unknown): TaskContractValidationResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "not_an_object" };
  }
  const raw = input as Record<string, unknown>;

  if (!isNonEmptyString(raw.taskId)) return { ok: false, reason: "missing_or_invalid_taskId" };
  if (!isNonEmptyString(raw.title)) return { ok: false, reason: "missing_or_invalid_title" };
  if (!isNonEmptyString(raw.approvedPrompt)) return { ok: false, reason: "missing_or_invalid_approvedPrompt" };
  if (!isStringArray(raw.scope) || raw.scope.length === 0) return { ok: false, reason: "missing_or_invalid_scope" };
  if (!isStringArray(raw.protectedAreas) || raw.protectedAreas.length === 0) {
    return { ok: false, reason: "missing_or_invalid_protectedAreas" };
  }
  // Unlike protectedAreas, an EMPTY requiredChecks array is legitimate --
  // see this round's own live-smoke-test task's own example contract
  // (a "make no repository changes" task has no build/test/lint output
  // to verify; scope-guard.ts's protectedAreas enforcement is what keeps
  // that task safe, not requiredChecks). Only the array's SHAPE is
  // enforced here, never its non-emptiness.
  if (!Array.isArray(raw.requiredChecks)) {
    return { ok: false, reason: "missing_or_invalid_requiredChecks" };
  }
  for (const check of raw.requiredChecks) {
    if (typeof check !== "string" || !REQUIRED_CHECK_NAMES.has(check)) {
      return { ok: false, reason: `invalid_required_check:${String(check)}` };
    }
  }
  if (raw.allowedOperations !== undefined && !isStringArray(raw.allowedOperations)) {
    return { ok: false, reason: "invalid_allowedOperations" };
  }
  if (raw.forbiddenOperations !== undefined && !isStringArray(raw.forbiddenOperations)) {
    return { ok: false, reason: "invalid_forbiddenOperations" };
  }

  const createdAt = isNonEmptyString(raw.createdAt) ? raw.createdAt : new Date().toISOString();

  const contract: TaskContract = {
    taskId: raw.taskId,
    title: raw.title,
    approvedPrompt: raw.approvedPrompt,
    scope: raw.scope,
    protectedAreas: raw.protectedAreas,
    requiredChecks: raw.requiredChecks as RequiredCheckName[],
    ...(raw.allowedOperations !== undefined ? { allowedOperations: raw.allowedOperations as string[] } : {}),
    ...(raw.forbiddenOperations !== undefined ? { forbiddenOperations: raw.forbiddenOperations as string[] } : {}),
    createdAt,
  };
  return { ok: true, contract };
}

// A contract is considered UNCHANGED (and therefore still enforceable
// without a fresh human approval) only if every field that defines its
// own enforcement surface is byte-identical -- createdAt is deliberately
// excluded (re-persisting the same contract must never itself look like
// a change). See state-machine.ts's own doc comment for why any real
// difference here is always a HARD_STOP, never a silent merge.
export function isSameContract(a: TaskContract, b: TaskContract): boolean {
  return (
    a.taskId === b.taskId &&
    a.title === b.title &&
    a.approvedPrompt === b.approvedPrompt &&
    JSON.stringify(a.scope) === JSON.stringify(b.scope) &&
    JSON.stringify(a.protectedAreas) === JSON.stringify(b.protectedAreas) &&
    JSON.stringify(a.requiredChecks) === JSON.stringify(b.requiredChecks)
  );
}
