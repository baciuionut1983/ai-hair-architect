// Explicit, local-only outer snapshot writer. No callers/CLI/dispatch are wired.
// Like persistence.ts, every persisted field and mutation is allow-listed.
// Raw actor/evidence labels are attestations, NOT authenticated provenance.
// A trusted local caller must supply authorized reports; this API does no polling.
import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { canonicalJson } from "./canonical-json.js";
import { parseAgentReportFooter, validateAgentReportFooter, type AgentReportFooter } from "./agent-report-footer.js";
import { parseProjectState, validateProjectState, type ProjectState } from "./project-state.js";

type Status = ProjectState["operational"]["status"];
type Actor = AgentReportFooter["actor"];
type TaskType = AgentReportFooter["task_type"];
type Reason = "state_read_failed" | "state_invalid" | "footer_missing" | "footer_invalid"
  | "duplicate_conflict" | "stale_revision" | "unexpected_task" | "unexpected_actor"
  | "invalid_transition" | "human_approval_required" | "lock_busy" | "write_failed"
  | "post_write_validation_failed";
export type UpdateResult = (
  | { ok: true; kind: "UPDATED"; revision: number; operationalStatus: Status; nextActor: Actor }
  | { ok: true; kind: "DUPLICATE_NOOP"; revision: number }
  | { ok: false; reason: Reason; step: string }
) & { anomalies: string[] };
type FileSystem = Pick<typeof fs, "openSync" | "readFileSync" | "writeSync" | "fsyncSync" | "closeSync" | "renameSync" | "unlinkSync" | "lstatSync" | "fstatSync">;
export interface UpdateDependencies {
  fs?: FileSystem;
  now?: () => Date;
  sleep?: (ms: number) => void;
}

// Public digest helper also validates: even direct callers cannot hash raw JSON.
export function footerDigest(value: unknown): string {
  const validated = validateAgentReportFooter(value);
  if (!validated.ok) throw new Error(`footer_invalid:${validated.reason}`);
  return createHash("sha256").update(canonicalJson(validated.footer)).digest("hex");
}

// Explicit schema order, including every nested record. Never enumerate caller keys.
export function serializeProjectState(input: ProjectState): string {
  const validated = validateProjectState(input);
  if (!validated.ok) throw new Error(validated.reason);
  const s = validated.state;
  const task = (t: NonNullable<ProjectState["activeTask"]> | NonNullable<ProjectState["lastTask"]>) => ({
    task_id: t.task_id, attempt: t.attempt, task_type: t.task_type, actor: t.actor,
  });
  return JSON.stringify({
    schemaVersion: s.schemaVersion, stateRevision: s.stateRevision,
    activeTask: s.activeTask && { ...task(s.activeTask), startedAt: s.activeTask.startedAt },
    lastTask: s.lastTask && { ...task(s.lastTask), verdict: s.lastTask.verdict, footerDigest: s.lastTask.footerDigest, at: s.lastTask.at },
    project: s.project,
    repository: { canonical: s.repository.canonical, branch: s.repository.branch, originSha: s.repository.originSha, approvedSha: s.repository.approvedSha, evidence: s.repository.evidence },
    operational: { milestone: s.operational.milestone, phase: s.operational.phase, status: s.operational.status },
    product: { lastClosed: s.product.lastClosed, status: s.product.status, nextAfterOrchestratorMvp: s.product.nextAfterOrchestratorMvp, laterRoadmap: s.product.laterRoadmap, evidence: s.product.evidence },
    ci: { status: s.ci.status, runId: s.ci.runId, evidence: s.ci.evidence },
    production: { sha: s.production.sha, project: s.production.project, environment: s.production.environment, service: s.production.service, deploymentId: s.production.deploymentId,
      evidence: s.production.evidence, releaseGate: s.production.releaseGate, releaseGateEvidence: s.production.releaseGateEvidence,
      migrations: { applied: s.production.migrations.applied, pending: s.production.migrations.pending } },
    blockers: s.blockers,
    deferred: s.deferred.map((d) => ({ project: d.project, action: d.action, blocking: d.blocking, deletionRequiresHumanApproval: d.deletionRequiresHumanApproval })),
    next: { actor: s.next.actor, task: s.next.task, taskId: s.next.taskId, taskType: s.next.taskType, humanApprovalRequired: s.next.humanApprovalRequired, humanApprovalReason: s.next.humanApprovalReason },
  }, null, 2) + "\n";
}

const compatible: Record<Status, readonly TaskType[]> = {
  AWAITING_ARCHITECTURE: ["ARCHITECTURE_AUDIT"],
  AWAITING_IMPLEMENTATION: ["IMPLEMENTATION"], IMPLEMENTATION_IN_PROGRESS: ["IMPLEMENTATION"],
  AWAITING_REVIEW: ["INDEPENDENT_REVIEW"], REVIEW_HOLD: ["ARCHITECTURE_AUDIT", "IMPLEMENTATION"],
  AWAITING_PUSH_AUTHORIZATION: ["CONTROLLED_PUSH"], AWAITING_CI: ["CI_VERIFICATION"],
  CI_FAILED: ["ARCHITECTURE_AUDIT", "IMPLEMENTATION"],
  AWAITING_PRODUCTION_VERIFICATION: ["PRODUCTION_VERIFICATION"],
  READY_FOR_HUMAN_CLOSURE: ["STATE_MAINTENANCE"], CLOSED: [],
};
const actors: Record<TaskType, readonly Actor[]> = {
  ARCHITECTURE_AUDIT: ["CLAUDE"], IMPLEMENTATION: ["CODEX"], INDEPENDENT_REVIEW: ["CLAUDE"],
  CONTROLLED_PUSH: ["HUMAN"], CI_VERIFICATION: ["CI"], PRODUCTION_VERIFICATION: ["HUMAN", "RAILWAY"], STATE_MAINTENANCE: ["HUMAN"],
};
type Route = { status: Status; actor: Actor; taskType: TaskType };
const correction: Route = { status: "REVIEW_HOLD", actor: "HUMAN", taskType: "ARCHITECTURE_AUDIT" };
// HUMAN architecture records are a deliberate stop for a human decision, not
// executable raw audit reports. This module neither dispatches nor clears gates.
function route(f: AgentReportFooter): Route {
  switch (f.task_type) {
    case "ARCHITECTURE_AUDIT": return f.verdict === "READY_FOR_IMPLEMENTATION"
      ? { status: "AWAITING_IMPLEMENTATION", actor: "CODEX", taskType: "IMPLEMENTATION" } : correction;
    case "IMPLEMENTATION": return f.verdict === "READY_FOR_REVIEW"
      ? { status: "AWAITING_REVIEW", actor: "CLAUDE", taskType: "INDEPENDENT_REVIEW" } : correction;
    case "INDEPENDENT_REVIEW": return f.verdict === "GO"
      ? { status: "AWAITING_PUSH_AUTHORIZATION", actor: "HUMAN", taskType: "CONTROLLED_PUSH" } : correction;
    case "CONTROLLED_PUSH": return f.verdict === "PASS"
      ? { status: "AWAITING_CI", actor: "CI", taskType: "CI_VERIFICATION" } : correction;
    case "CI_VERIFICATION": return f.verdict === "PASS"
      ? { status: "AWAITING_PRODUCTION_VERIFICATION", actor: "HUMAN", taskType: "PRODUCTION_VERIFICATION" }
      : { ...correction, status: f.verdict === "FAIL" ? "CI_FAILED" : "REVIEW_HOLD" };
    case "PRODUCTION_VERIFICATION": return f.verdict === "PASS"
      ? { status: "READY_FOR_HUMAN_CLOSURE", actor: "HUMAN", taskType: "STATE_MAINTENANCE" } : correction;
    case "STATE_MAINTENANCE": return { status: "CLOSED", actor: "HUMAN", taskType: "STATE_MAINTENANCE" };
  }
}
const descriptions: Record<TaskType, string> = {
  ARCHITECTURE_AUDIT: "Human decision required before correction.",
  IMPLEMENTATION: "Implement the reviewed task.", INDEPENDENT_REVIEW: "Independently review the implementation.",
  CONTROLLED_PUSH: "Human authorization and controlled push report required.", CI_VERIFICATION: "Report CI verification.",
  PRODUCTION_VERIFICATION: "Human production verification required.", STATE_MAINTENANCE: "Human closure decision required.",
};

const bootstrapTaskId = "ORCH-B2-STATE-MAINTENANCE-BOOTSTRAP-001";
function bootstrapEligible(s: ProjectState, f: AgentReportFooter): boolean {
  return s.schemaVersion === 2 && s.stateRevision === 1 && s.lastTask === null && s.activeTask === null
    && s.operational.phase === "PHASE_B_2B" && s.operational.status === "AWAITING_IMPLEMENTATION"
    && s.next.actor === "CODEX" && s.next.taskId === "ORCH-B2-IMPL-001" && s.next.taskType === "IMPLEMENTATION"
    && !s.next.humanApprovalRequired && s.next.humanApprovalReason === null && s.blockers.length === 0
    && s.product.lastClosed === "T1.6.2.c.2c" && s.product.status === "CLOSED" && s.product.nextAfterOrchestratorMvp === "B"
    && s.product.laterRoadmap.length === 1 && s.product.laterRoadmap[0] === "T1.6.2.d"
    && f.actor === "HUMAN" && f.task_type === "STATE_MAINTENANCE" && f.verdict === "BOOTSTRAP_SYNC"
    && f.task_id === bootstrapTaskId && f.attempt === 1 && f.expected_state_revision === 1
    && f.baseline_sha === null && f.result_sha === null && f.scope.length === 0 && f.evidence === "HUMAN_VERIFIED"
    && f.blockers.length === 0 && !f.human_approval_required && f.human_approval_reason === null;
}

// No generic maintenance patch: synchronize only the initial orchestration record.
function bootstrapState(current: ProjectState, f: AgentReportFooter, digest: string, at: string): ProjectState {
  const next = structuredClone(current);
  next.stateRevision++;
  next.operational.phase = "PHASE_B_3";
  next.operational.status = "AWAITING_IMPLEMENTATION";
  next.activeTask = null;
  next.lastTask = { task_id: f.task_id, attempt: f.attempt, task_type: f.task_type, actor: f.actor, verdict: f.verdict, footerDigest: digest, at };
  next.next = { actor: "CODEX", taskType: "IMPLEMENTATION", taskId: "ORCH-B3-IMPL-001",
    task: "Implement Project Operations Orchestrator Phase B.3 task generation and evidence verification.",
    humanApprovalRequired: false, humanApprovalReason: null };
  return next;
}

const closureTaskId = "ORCH-B3-STATE-MAINTENANCE-CLOSURE-001";
function closureEligible(s: ProjectState, f: AgentReportFooter): boolean {
  return s.schemaVersion === 2 && s.stateRevision === 2 && s.activeTask === null
    && s.operational.milestone === "PROJECT_OPERATIONS_ORCHESTRATOR"
    && s.operational.phase === "PHASE_B_3" && s.operational.status === "AWAITING_IMPLEMENTATION"
    && s.lastTask !== null && s.lastTask.task_id === bootstrapTaskId && s.lastTask.attempt === 1
    && s.lastTask.task_type === "STATE_MAINTENANCE" && s.lastTask.actor === "HUMAN" && s.lastTask.verdict === "BOOTSTRAP_SYNC"
    && s.lastTask.footerDigest === "deaa10e76d1194031df3a00fc8a9002ae634d285f9ce2ba42ee60b7c7b6b778b"
    && s.lastTask.at === "2026-09-28T19:45:03.794Z"
    && s.next.actor === "CODEX" && s.next.taskId === "ORCH-B3-IMPL-001" && s.next.taskType === "IMPLEMENTATION"
    && !s.next.humanApprovalRequired && s.next.humanApprovalReason === null && s.blockers.length === 0
    && s.product.lastClosed === "T1.6.2.c.2c" && s.product.status === "CLOSED" && s.product.nextAfterOrchestratorMvp === "B"
    && s.product.laterRoadmap.length === 1 && s.product.laterRoadmap[0] === "T1.6.2.d"
    && f.actor === "HUMAN" && f.task_type === "STATE_MAINTENANCE" && f.verdict === "MVP_CLOSURE_SYNC"
    && f.task_id === closureTaskId && f.attempt === 1 && f.expected_state_revision === 2
    && f.baseline_sha === null && f.result_sha === null && f.scope.length === 0 && f.evidence === "HUMAN_VERIFIED"
    && f.blockers.length === 0 && !f.human_approval_required && f.human_approval_reason === null;
}

// Only close this operational milestone; preserve every historical product/evidence fact.
function closureState(current: ProjectState, f: AgentReportFooter, digest: string, at: string): ProjectState {
  const next = structuredClone(current);
  next.stateRevision++;
  next.operational.phase = "ORCHESTRATOR_MVP_CLOSED";
  next.operational.status = "CLOSED";
  next.activeTask = null;
  next.lastTask = { task_id: f.task_id, attempt: f.attempt, task_type: f.task_type, actor: f.actor, verdict: f.verdict, footerDigest: digest, at };
  next.next = { actor: "HUMAN", taskType: "STATE_MAINTENANCE", taskId: closureTaskId,
    task: "Orchestrator MVP CLOSED. No next executable task; the architecture/scope decision for product work B is a separate, later human-initiated action.",
    humanApprovalRequired: false, humanApprovalReason: null };
  return next;
}

function taskPrefix(phase: string): string | null {
  switch (phase) {
    case "PHASE_B_2B": return "ORCH-B2";
    case "PHASE_B_3": return "ORCH-B3";
    default: return null;
  }
}

function patchedState(current: ProjectState, f: AgentReportFooter, digest: string, at: string, prefix: string | null): ProjectState {
  const next = structuredClone(current);
  let routing = route(f);
  const replacesBlockers = ["ARCHITECTURE_AUDIT", "INDEPENDENT_REVIEW", "STATE_MAINTENANCE"].includes(f.task_type);
  if (replacesBlockers) next.blockers = f.blockers.map((b) => b.description);
  // Preserve blockers on tasks without permission to replace them. Stored
  // blockers have no flags, so conservatively require a human for any remainder.
  const humanGate = f.human_approval_required || (!replacesBlockers && next.blockers.length > 0);
  if (humanGate && routing.status !== "CLOSED") routing = correction;
  next.operational.status = routing.status;
  if (f.task_type === "CONTROLLED_PUSH" && f.verdict === "PASS") {
    // The footer requires result_sha; no independent Git verification is claimed.
    next.repository.originSha = f.result_sha!.toLowerCase();
    next.repository.approvedSha = f.result_sha!.toLowerCase();
    next.repository.evidence = "CLAIMED";
  }
  if (f.task_type === "CI_VERIFICATION") {
    next.ci.status = f.verdict === "PASS" ? "SUCCESS" : f.verdict === "FAIL" ? "FAILURE" : "PENDING";
    next.ci.evidence = "CLAIMED"; // runId is the unchanged prior snapshot fact.
  }
  if (f.task_type === "PRODUCTION_VERIFICATION") {
    next.production.evidence = f.actor === "HUMAN" && f.evidence === "HUMAN_VERIFIED" ? "HUMAN_VERIFIED" : "CLAIMED";
    // No deployment fact or release-gate evidence is inferred from this report.
  }
  next.stateRevision++;
  next.activeTask = null; // terminal report completes a task; routing does not start one.
  next.lastTask = { task_id: f.task_id, attempt: f.attempt, task_type: f.task_type, actor: f.actor, verdict: f.verdict, footerDigest: digest, at };
  const terminal = routing.status === "CLOSED";
  const humanApprovalRequired = !terminal && routing.actor === "HUMAN";
  next.next = {
    actor: routing.actor, taskType: routing.taskType,
    // Global revision provides a deterministic, bounded, collision-free sequence.
    taskId: terminal ? f.task_id : `${prefix}-${routing.taskType.replaceAll("_", "-")}-${String(next.stateRevision).padStart(3, "0")}`,
    task: terminal ? "Closed; no executable next task." : descriptions[routing.taskType],
    humanApprovalRequired,
    humanApprovalReason: humanApprovalRequired ? (humanGate ? f.human_approval_reason ?? "Unresolved blockers require a human decision." : descriptions[routing.taskType]) : null,
  };
  return next;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}
function sameFile(a: fs.Stats, b: fs.Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }

export function ingestAgentReport(reportText: string, stateFilePath: string, dependencies: UpdateDependencies = {}): UpdateResult {
  const io = dependencies.fs ?? fs;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? ((ms: number) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); });
  const anomalies: string[] = [];
  const fail = (reason: Reason, step: string): UpdateResult => ({ ok: false, reason, step, anomalies });
  const lockPath = `${stateFilePath}.lock`;
  let lockFd: number | undefined;
  let lockIdentity: fs.Stats | undefined;
  let lockBytes: string | undefined;
  let lockInitialized = false;
  let step = "acquire_lock";
  function ownedLock(): boolean {
    return lockIdentity !== undefined && lockBytes !== undefined && sameFile(lockIdentity, io.lstatSync(lockPath)) && io.readFileSync(lockPath, "utf8") === lockBytes;
  }
  function writeAll(fd: number, text: string): void {
    const buffer = Buffer.from(text);
    for (let offset = 0; offset < buffer.length;) {
      const written = io.writeSync(fd, buffer, offset, buffer.length - offset);
      if (written <= 0) throw new Error("short_write");
      offset += written;
    }
  }
  try {
    // Exactly one stale-lock removal/reacquisition, never a waiting loop.
    try { lockFd = io.openSync(lockPath, "wx"); }
    catch (error) {
      if (errorCode(error) !== "EEXIST") return fail("lock_busy", step);
      try {
        const stat = io.lstatSync(lockPath);
        if (!stat.isFile() || stat.isSymbolicLink()) return fail("lock_busy", "malformed_lock");
        const raw = io.readFileSync(lockPath, "utf8");
        const lock = JSON.parse(raw) as Record<string, unknown>;
        if (!lock || typeof lock !== "object" || !Number.isSafeInteger(lock.pid) || Number(lock.pid) <= 0 || typeof lock.hostname !== "string" || !lock.hostname.trim()
          || typeof lock.acquiredAt !== "string" || !Number.isFinite(Date.parse(lock.acquiredAt)) || new Date(lock.acquiredAt).toISOString() !== lock.acquiredAt) return fail("lock_busy", "malformed_lock");
        if (now().getTime() - Date.parse(lock.acquiredAt) <= 60_000) return fail("lock_busy", "fresh_lock");
        if (!sameFile(stat, io.lstatSync(lockPath)) || io.readFileSync(lockPath, "utf8") !== raw) return fail("lock_busy", "lock_changed");
        io.unlinkSync(lockPath);
        anomalies.push("stale_lock_removed");
        lockFd = io.openSync(lockPath, "wx");
      } catch { return fail("lock_busy", "stale_lock_recovery"); }
    }
    lockIdentity = io.fstatSync(lockFd);
    lockBytes = JSON.stringify({ pid: process.pid, hostname: hostname(), acquiredAt: now().toISOString() });
    writeAll(lockFd, lockBytes);
    lockInitialized = true;
    io.fsyncSync(lockFd);
    step = "read_state";
    let raw: string;
    try { raw = io.readFileSync(stateFilePath, "utf8"); } catch { return fail("state_read_failed", step); }
    step = "validate_state";
    const loaded = parseProjectState(raw);
    if (!loaded.ok) return fail("state_invalid", step);
    const current = loaded.state;
    // Reject normalization that would rewrite protected snapshot fields incidentally.
    if (canonicalJson(JSON.parse(raw)) !== canonicalJson(current)) return fail("state_invalid", "state_normalization");
    step = "parse_footer";
    const parsed = parseAgentReportFooter(reportText);
    if (!parsed.ok) return fail(parsed.reason === "missing_footer" ? "footer_missing" : "footer_invalid", step);
    const validated = validateAgentReportFooter(parsed.footer);
    if (!validated.ok) return fail("footer_invalid", "validate_footer");
    const f = validated.footer;
    const digest = footerDigest(f);
    if (current.lastTask?.task_id === f.task_id && current.lastTask.attempt === f.attempt) {
      return current.lastTask.footerDigest === digest
        ? { ok: true, kind: "DUPLICATE_NOOP", revision: current.stateRevision, anomalies }
        : fail("duplicate_conflict", "duplicate_check");
    }
    if (f.expected_state_revision !== current.stateRevision) return fail("stale_revision", "revision_check");
    let candidate: ProjectState;
    if (f.verdict === "BOOTSTRAP_SYNC") {
      if (f.expected_state_revision !== 1) return fail("stale_revision", "revision_check");
      if (!bootstrapEligible(current, f)) return fail("invalid_transition", "bootstrap_eligibility");
      candidate = bootstrapState(current, f, digest, now().toISOString());
    } else if (f.verdict === "MVP_CLOSURE_SYNC") {
      if (f.expected_state_revision !== 2) return fail("stale_revision", "revision_check");
      if (!closureEligible(current, f)) return fail("invalid_transition", "closure_sync_eligibility");
      candidate = closureState(current, f, digest, now().toISOString());
    } else {
      if (f.task_id !== current.next.taskId) return fail("unexpected_task", "task_check");
      if (f.actor !== current.next.actor) return fail("unexpected_actor", "actor_check");
      if (!actors[f.task_type].includes(f.actor)) return fail("human_approval_required", "authority_check");
      if (f.task_type !== current.next.taskType || !compatible[current.operational.status].includes(f.task_type)
        || (f.task_type === "STATE_MAINTENANCE" && f.verdict === "UPDATED")) return fail("invalid_transition", "transition_check");
      if (current.next.humanApprovalRequired && f.actor !== "HUMAN") return fail("human_approval_required", "human_gate");
      if (f.verdict === "CLOSED" && (f.human_approval_required || f.blockers.some((b) => b.blocking || b.requiresHuman))) return fail("human_approval_required", "closure_gate");
      if (current.activeTask && (current.activeTask.task_id !== f.task_id || current.activeTask.attempt !== f.attempt || current.activeTask.actor !== f.actor || current.activeTask.task_type !== f.task_type)) return fail("invalid_transition", "active_task_check");
      const prefix = taskPrefix(current.operational.phase);
      if (f.verdict !== "CLOSED" && prefix === null) return fail("invalid_transition", "task_id_policy");
      candidate = patchedState(current, f, digest, now().toISOString(), prefix);
    }
    step = "validate_new_state";
    const updated = validateProjectState(candidate);
    if (!updated.ok) return fail("state_invalid", step);
    const serialized = serializeProjectState(updated.state);
    step = "write_temp";
    const tempPath = `${stateFilePath}.tmp-${process.pid}-${now().getTime()}-${randomUUID()}`;
    const tempFd = io.openSync(tempPath, "wx");
    try { writeAll(tempFd, serialized); io.fsyncSync(tempFd); } finally { io.closeSync(tempFd); }
    step = "validate_temp";
    // readFileSync(path) re-opens the fully closed file before parsing it.
    const tempBytes = io.readFileSync(tempPath, "utf8");
    if (tempBytes !== serialized || !parseProjectState(tempBytes).ok) return fail("write_failed", step);
    step = "rename";
    for (let attempt = 0; attempt < 3; attempt++) {
      // A displaced/expired writer must not persist after another acquired its lock.
      if (!ownedLock()) return fail("lock_busy", "lock_ownership_lost");
      try { io.renameSync(tempPath, stateFilePath); break; }
      catch (error) {
        if (!["EPERM", "EBUSY"].includes(errorCode(error) ?? "") || attempt === 2) return fail("write_failed", step);
        sleep([50, 150][attempt]); // Three TOTAL attempts, two bounded intervening waits.
      }
    }
    step = "post_write_validation";
    try {
      const disk = io.readFileSync(stateFilePath, "utf8");
      if (disk !== serialized || !parseProjectState(disk).ok) return fail("post_write_validation_failed", step);
    } catch { return fail("post_write_validation_failed", step); }
    return { ok: true, kind: "UPDATED", revision: updated.state.stateRevision, operationalStatus: updated.state.operational.status, nextActor: updated.state.next.actor, anomalies };
  } catch {
    return fail(step === "acquire_lock" ? "lock_busy" : "write_failed", step);
  } finally {
    // Only remove our own lock. Never remove a replacement lock on failure.
    if (lockFd !== undefined) {
      try { io.closeSync(lockFd); } catch { anomalies.push("lock_close_failed"); }
      try {
        if (lockIdentity && sameFile(lockIdentity, io.lstatSync(lockPath)) && (!lockInitialized || ownedLock())) {
          // Partial initialization failure still owns the exclusively created inode.
          io.unlinkSync(lockPath);
        } else anomalies.push("lock_ownership_lost");
      } catch { anomalies.push("lock_release_failed"); }
    }
  }
}
