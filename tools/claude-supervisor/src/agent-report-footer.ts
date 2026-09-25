// Pure raw-report contract. No state access, authentication, routing or Git checks.
// Actor labels are structural claims, not authenticated identities. B.2b must
// independently verify provenance before trusting or applying any report.
import { z } from "zod";

const actor = z.enum(["CLAUDE", "CODEX", "HUMAN", "CI", "RAILWAY", "ORCHESTRATOR"]);
const verdicts = {
  ARCHITECTURE_AUDIT: ["READY_FOR_IMPLEMENTATION", "HOLD"],
  IMPLEMENTATION: ["READY_FOR_REVIEW", "BLOCKED"],
  INDEPENDENT_REVIEW: ["GO", "HOLD"],
  CONTROLLED_PUSH: ["PASS", "FAIL"],
  CI_VERIFICATION: ["PASS", "FAIL", "PENDING"],
  PRODUCTION_VERIFICATION: ["PASS", "FAIL", "UNKNOWN"],
  STATE_MAINTENANCE: ["CLOSED", "UPDATED"],
} as const;
const taskType = z.enum([
  "ARCHITECTURE_AUDIT", "IMPLEMENTATION", "INDEPENDENT_REVIEW", "CONTROLLED_PUSH",
  "CI_VERIFICATION", "PRODUCTION_VERIFICATION", "STATE_MAINTENANCE",
]);
const actorTasks: Record<z.infer<typeof actor>, readonly z.infer<typeof taskType>[]> = {
  CLAUDE: ["ARCHITECTURE_AUDIT", "INDEPENDENT_REVIEW"],
  CODEX: ["IMPLEMENTATION", "CONTROLLED_PUSH"],
  HUMAN: ["CONTROLLED_PUSH", "PRODUCTION_VERIFICATION", "STATE_MAINTENANCE"],
  CI: ["CI_VERIFICATION"],
  RAILWAY: ["PRODUCTION_VERIFICATION"],
  // No explicit architecture permission for orchestrator maintenance yet.
  ORCHESTRATOR: [],
};
const nonempty = z.string().refine((s) => s.trim().length > 0);
const sha = z.string().regex(/^[0-9a-fA-F]{40}$/).nullable();
const path = z.string().refine((s) =>
  s.length > 0 && s === s.trim() && !/[\\:\x00-\x1f\x7f<>"|?*%]/.test(s) &&
  s.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && !/[. ]$/.test(part)),
);
const schema = z.strictObject({
  schema_version: z.literal(1),
  task_id: z.string().max(160).regex(/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*-[A-Z][A-Z0-9]*-\d{3,}$/),
  attempt: z.number().int().positive().safe(),
  actor,
  task_type: taskType,
  baseline_sha: sha,
  result_sha: sha,
  scope: z.array(path),
  verdict: z.enum(["READY_FOR_IMPLEMENTATION", "HOLD", "READY_FOR_REVIEW", "BLOCKED", "GO", "PASS", "FAIL", "PENDING", "UNKNOWN", "CLOSED", "UPDATED"]),
  evidence: z.enum(["CLAIMED", "MACHINE_VERIFIED", "HUMAN_VERIFIED", "UNKNOWN"]),
  blockers: z.array(z.strictObject({ description: nonempty, blocking: z.boolean(), requiresHuman: z.boolean() })),
  next_actor_suggested: actor.nullable(), // Advisory only; B.2b/B.3 derive routing.
  human_approval_required: z.boolean(),
  human_approval_reason: nonempty.nullable(),
  expected_state_revision: z.number().int().nonnegative().safe(), // B.2b enforces against stored revision.
});

export type AgentReportFooter = z.infer<typeof schema>;
export type AgentReportResult = { ok: true; footer: AgentReportFooter } | { ok: false; reason: string };

export function validateAgentReportFooter(value: unknown): AgentReportResult {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: "invalid_structure" };
  const f = parsed.data;
  const fail = (reason: string): AgentReportResult => ({ ok: false, reason });
  if (!(verdicts[f.task_type] as readonly string[]).includes(f.verdict)) return fail("invalid_task_verdict");
  if (!actorTasks[f.actor].includes(f.task_type)) return fail("invalid_actor_task");
  if (f.verdict === "CLOSED" && f.actor !== "HUMAN") return fail("human_only_closure");
  if (f.evidence === "HUMAN_VERIFIED" && f.actor !== "HUMAN") return fail("human_only_evidence");
  // The raw intake cannot establish independent verification, even for CI.
  if (f.evidence === "MACHINE_VERIFIED") return fail("machine_evidence_requires_independent_verification");
  const writes = f.task_type === "IMPLEMENTATION" || f.task_type === "CONTROLLED_PUSH";
  if (!writes && f.scope.length) return fail("readonly_scope");
  if (!writes && f.result_sha !== null) return fail("forbidden_result_sha");
  if (["IMPLEMENTATION", "INDEPENDENT_REVIEW", "CONTROLLED_PUSH"].includes(f.task_type) && f.baseline_sha === null) return fail("required_baseline_sha");
  if (f.task_type === "CONTROLLED_PUSH" && f.result_sha === null) return fail("required_result_sha");
  if (f.task_type === "STATE_MAINTENANCE" && f.baseline_sha !== null) return fail("forbidden_baseline_sha");
  // A null implementation result declares no commit; actual Git verification is later.
  if (f.blockers.some((b) => b.blocking || b.requiresHuman) && !f.human_approval_required) return fail("required_human_approval");
  if (f.human_approval_required !== (f.human_approval_reason !== null)) return fail("invalid_human_approval_reason");
  return { ok: true, footer: f };
}

// Contract: optional prose, then exactly one terminal block with standalone
// BEGIN_PROJECT_REPORT and END_PROJECT_REPORT lines. Only whitespace may follow.
// Reserved marker strings cannot occur elsewhere; prose is never interpreted.
export function parseAgentReportFooter(reportText: string): AgentReportResult {
  const begin = "BEGIN_PROJECT_REPORT", end = "END_PROJECT_REPORT";
  if (!reportText.includes(begin) || !reportText.includes(end)) return { ok: false, reason: "missing_footer" };
  if (reportText.split(begin).length !== 2 || reportText.split(end).length !== 2) return { ok: false, reason: "multiple_or_ambiguous_footer" };
  const match = /(?:^|\n)BEGIN_PROJECT_REPORT\r?\n([\s\S]*?)\r?\nEND_PROJECT_REPORT[\t \r\n]*$/.exec(reportText);
  if (!match) return { ok: false, reason: "invalid_footer_boundary" };
  let value: unknown;
  try { value = JSON.parse(match[1]); }
  catch { return { ok: false, reason: "malformed_json" }; }
  return validateAgentReportFooter(value);
}
