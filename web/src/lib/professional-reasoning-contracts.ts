import { createHash } from "crypto";

import { isRecord } from "@/lib/technical-visual-map-validators";
import { SKILL_CAPABILITY_KINDS, type SkillCapabilityKind } from "@/lib/professional-skill-contracts";
import type { HairStateDelta, HairStateDeltaEntry } from "@/lib/hair-state-delta";
import type { HairStateDeltaSkillSelectionResult } from "@/lib/hair-state-delta-skill-candidate-selector";

// AI Hair Architect, Professional Skill Engine Stage 5 -- PROFESSIONAL
// REASONING CONTRACTS. Pure types + pure builder + pure structural
// validators. No I/O, no AI, no provider call. Mirrors orchestrator-ai-
// intent-schema.ts's own exact "raw AI JSON boundary" discipline: a small,
// closed, structurally-validated shape the model may produce, never an
// arbitrary object trusted directly.
//
// PART A -- REASONING CONTEXT (the sealed input). Deliberately NOT
// persisted as its own row: like HairStateDelta itself (Stage 4), it is a
// pure, deterministic function of already-immutable, already-versioned
// sources (HairStateSnapshot ids/versions, candidate skill ids/versions).
// Reproducibility/audit comes from stamping those exact references plus a
// deterministic contextFingerprint, never from persisting the object
// itself -- the smallest architecture consistent with the repository (the
// PROPOSAL, Part B, is what actually needs a lifecycle and gets persisted;
// see professional-reasoning-repository.ts).
//
// MINIMUM CONTEXT ONLY (task's own explicit rule: "do NOT send the entire
// database or irrelevant client history"): candidateSkills carries only
// identity + matched capability + which delta it addresses + the
// deterministic reason already computed by Stage 4 -- never a full
// SkillDefinition dump, never unrelated client history. Evidence is
// summarized to (kind, role) only -- never image bytes, never a URL --
// so this context is structurally incapable of smuggling new, untracked
// visual observations into the model (Stage 5's own explicit "must not
// silently infer new observations from image IDs" boundary, Part N).
//
// PART B -- REASONING PROPOSAL (the response schema). Structured data
// ONLY, never authoritative prose. isProfessionalReasoningProposal is the
// FIRST wall against malformed model output -- purely structural, exactly
// like isAiIntentClassificationResult's own role one layer up from here.
// Business-rule validation (does this skill/version/capability/
// applicability/parameter actually check out) is a SEPARATE, later stage
// -- see professional-reasoning-validator.ts. This file only proves the
// SHAPE is well-formed.

export const PROFESSIONAL_REASONING_SCHEMA_VERSION = "1.0.0-pr5";

// ---------------------------------------------------------------------------
// Part A -- Reasoning Context
// ---------------------------------------------------------------------------

export interface ProfessionalReasoningPreserveConstraint {
  scope: string; // "global" | HeadZone
  field: string;
  value: string;
  description: string;
}

export interface ProfessionalReasoningCandidateSkillRef {
  skillDefinitionId: string;
  skillKey: string;
  skillVersion: number;
  matchedCapability: SkillCapabilityKind;
  addressesDelta: { scope: string; field: string };
  deterministicReason: string;
}

export const PROFESSIONAL_REASONING_EVIDENCE_KINDS = ["IMAGE_ASSET", "CAPTURE_SET"] as const;
export type ProfessionalReasoningEvidenceKind = (typeof PROFESSIONAL_REASONING_EVIDENCE_KINDS)[number];

export interface ProfessionalReasoningEvidenceSummary {
  evidenceKind: ProfessionalReasoningEvidenceKind;
  evidenceRole: string;
}

export interface ProfessionalReasoningContext {
  schemaVersion: string;
  currentSnapshotId: string;
  currentSnapshotVersion: number;
  targetSnapshotId: string;
  targetSnapshotVersion: number;
  delta: HairStateDelta;
  candidateSkills: readonly ProfessionalReasoningCandidateSkillRef[];
  unresolvedDeltas: readonly HairStateDeltaEntry[];
  preserveConstraints: readonly ProfessionalReasoningPreserveConstraint[];
  // Bounded, optional professional/client intent text (task's own
  // future-voice/text-compatibility requirement, Part M) -- never derived
  // automatically, always caller-supplied, never Voice/STT wired here.
  professionalRequestText?: string;
  currentEvidence: readonly ProfessionalReasoningEvidenceSummary[];
  targetEvidence: readonly ProfessionalReasoningEvidenceSummary[];
  // Deterministic hash of every field above -- the audit answer to
  // "exactly what facts and skill versions did the AI see". Two contexts
  // built from the same inputs always fingerprint identically.
  contextFingerprint: string;
}

const MAX_REQUEST_TEXT_LENGTH = 2000;

export interface BuildProfessionalReasoningContextInput {
  selection: HairStateDeltaSkillSelectionResult;
  professionalRequestText?: string;
  currentEvidence?: readonly ProfessionalReasoningEvidenceSummary[];
  targetEvidence?: readonly ProfessionalReasoningEvidenceSummary[];
}

// Pure. Derives preserveConstraints DIRECTLY from the delta's own
// PRESERVED entries -- never a second, independently-authored constraint
// source (Stage 4's own delta already IS the authority for "what must
// stay the same").
function derivePreserveConstraints(delta: HairStateDelta): ProfessionalReasoningPreserveConstraint[] {
  return delta.entries
    .filter((entry) => entry.transformation === "PRESERVED")
    .map((entry) => ({
      scope: entry.scope,
      field: entry.field,
      value: entry.target.value,
      description: `Preserve ${entry.field} at ${entry.scope === "global" ? "the global level" : `zone "${entry.scope}"`} (target value: ${entry.target.value}).`,
    }));
}

export function buildProfessionalReasoningContext(input: BuildProfessionalReasoningContextInput): ProfessionalReasoningContext {
  const { selection } = input;
  const candidateSkills: ProfessionalReasoningCandidateSkillRef[] = selection.candidateMatches.map((match) => ({
    skillDefinitionId: match.skillDefinitionId,
    skillKey: match.skillKey,
    skillVersion: match.skillVersion,
    matchedCapability: match.matchedCapability,
    addressesDelta: { scope: match.deltaEntry.scope, field: match.deltaEntry.field },
    deterministicReason: match.deterministicReason,
  }));

  const professionalRequestText = input.professionalRequestText?.trim().slice(0, MAX_REQUEST_TEXT_LENGTH) || undefined;

  const base = {
    schemaVersion: PROFESSIONAL_REASONING_SCHEMA_VERSION,
    currentSnapshotId: selection.delta.sourceCurrentSnapshotId,
    currentSnapshotVersion: selection.delta.sourceCurrentSnapshotVersion,
    targetSnapshotId: selection.delta.sourceTargetSnapshotId,
    targetSnapshotVersion: selection.delta.sourceTargetSnapshotVersion,
    delta: selection.delta,
    candidateSkills,
    unresolvedDeltas: selection.unresolvedDeltas,
    preserveConstraints: derivePreserveConstraints(selection.delta),
    professionalRequestText,
    currentEvidence: input.currentEvidence ?? [],
    targetEvidence: input.targetEvidence ?? [],
  };

  return { ...base, contextFingerprint: computeContextFingerprint(base) };
}

function computeContextFingerprint(base: Omit<ProfessionalReasoningContext, "contextFingerprint">): string {
  // Deterministic, canonical -- excludes delta.computedAt (a wall-clock
  // timestamp, never part of "what facts did the AI see") so the SAME
  // underlying state always fingerprints identically regardless of when
  // it was recomputed.
  const canonical = JSON.stringify({
    schemaVersion: base.schemaVersion,
    currentSnapshotId: base.currentSnapshotId,
    currentSnapshotVersion: base.currentSnapshotVersion,
    targetSnapshotId: base.targetSnapshotId,
    targetSnapshotVersion: base.targetSnapshotVersion,
    deltaEntries: base.delta.entries,
    candidateSkills: base.candidateSkills,
    unresolvedDeltas: base.unresolvedDeltas,
    preserveConstraints: base.preserveConstraints,
    professionalRequestText: base.professionalRequestText ?? null,
    currentEvidence: base.currentEvidence,
    targetEvidence: base.targetEvidence,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Part B -- Reasoning Proposal (response schema)
// ---------------------------------------------------------------------------

export const PROFESSIONAL_REASONING_STATUSES = [
  "COMPLETE_CANDIDATE_PLAN",
  "PARTIAL_PLAN",
  "NEEDS_PROFESSIONAL_INPUT",
  "BLOCKED_BY_MISSING_SKILL",
  "BLOCKED_BY_MISSING_STATE",
  "CONFLICTING_REQUIREMENTS",
] as const;
export type ProfessionalReasoningStatus = (typeof PROFESSIONAL_REASONING_STATUSES)[number];

export function isProfessionalReasoningStatus(value: unknown): value is ProfessionalReasoningStatus {
  return typeof value === "string" && (PROFESSIONAL_REASONING_STATUSES as readonly string[]).includes(value);
}

export interface ProposedSkillParameter {
  name: string;
  value: string | boolean | number;
}

function isValidProposedSkillParameter(value: unknown): value is ProposedSkillParameter {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || value.name.length === 0) return false;
  return typeof value.value === "string" || typeof value.value === "boolean" || typeof value.value === "number";
}

// ONE delta target per step -- a skill addressing multiple deltas is
// multiple steps (same skillDefinitionId, different addressesDelta),
// mirroring Stage 4's own SkillCandidateMatch shape 1:1 (one match per
// (skill, delta) pair) rather than inventing a new "many deltas per step"
// shape the deterministic side has no equivalent for.
export interface ProposedSkillStep {
  stepId: string;
  skillDefinitionId: string;
  skillKey: string;
  skillVersion: number;
  zone: string;
  addressesDelta: { scope: string; field: string };
  declaredCapabilityUsed: SkillCapabilityKind;
  parameters: readonly ProposedSkillParameter[];
  rationale: string;
}

const MAX_RATIONALE_LENGTH = 500;

function isValidProposedSkillStep(value: unknown): value is ProposedSkillStep {
  if (!isRecord(value)) return false;
  if (typeof value.stepId !== "string" || value.stepId.length === 0) return false;
  if (typeof value.skillDefinitionId !== "string" || value.skillDefinitionId.length === 0) return false;
  if (typeof value.skillKey !== "string" || value.skillKey.length === 0) return false;
  if (typeof value.skillVersion !== "number" || !Number.isInteger(value.skillVersion) || value.skillVersion < 1) return false;
  if (typeof value.zone !== "string" || value.zone.length === 0) return false;
  if (!isRecord(value.addressesDelta) || typeof value.addressesDelta.scope !== "string" || typeof value.addressesDelta.field !== "string") return false;
  if (!(SKILL_CAPABILITY_KINDS as readonly string[]).includes(value.declaredCapabilityUsed as string)) return false;
  if (!Array.isArray(value.parameters) || !value.parameters.every(isValidProposedSkillParameter)) return false;
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0 || value.rationale.length > MAX_RATIONALE_LENGTH) return false;
  return true;
}

export interface ProfessionalReasoningProposal {
  schemaVersion: string;
  planSummary: string;
  proposedSkills: readonly ProposedSkillStep[];
  proposedOrder: readonly string[];
  preservationConstraints: readonly ProfessionalReasoningPreserveConstraint[];
  unresolvedRequirements: readonly { scope: string; field: string; reason: string }[];
  clarifyingQuestions: readonly string[];
  reasoningStatus: ProfessionalReasoningStatus;
}

const MAX_PLAN_SUMMARY_LENGTH = 1000;
const MAX_CLARIFYING_QUESTION_LENGTH = 500;

// Purely structural (Part B's own boundary) -- registry/capability/
// applicability/parameter/coverage business rules are validated
// separately (professional-reasoning-validator.ts), never here.
export function isProfessionalReasoningProposal(value: unknown): value is ProfessionalReasoningProposal {
  if (!isRecord(value)) return false;
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.length === 0) return false;
  if (typeof value.planSummary !== "string" || value.planSummary.trim().length === 0 || value.planSummary.length > MAX_PLAN_SUMMARY_LENGTH) return false;
  if (!Array.isArray(value.proposedSkills) || !value.proposedSkills.every(isValidProposedSkillStep)) return false;
  if (!Array.isArray(value.proposedOrder) || !value.proposedOrder.every((s) => typeof s === "string" && s.length > 0)) return false;
  if (!Array.isArray(value.preservationConstraints)) return false;
  if (
    !value.preservationConstraints.every(
      (c) => isRecord(c) && typeof c.scope === "string" && typeof c.field === "string" && typeof c.value === "string" && typeof c.description === "string",
    )
  ) {
    return false;
  }
  if (!Array.isArray(value.unresolvedRequirements)) return false;
  if (!value.unresolvedRequirements.every((r) => isRecord(r) && typeof r.scope === "string" && typeof r.field === "string" && typeof r.reason === "string")) return false;
  if (!Array.isArray(value.clarifyingQuestions) || !value.clarifyingQuestions.every((q) => typeof q === "string" && q.length > 0 && q.length <= MAX_CLARIFYING_QUESTION_LENGTH)) {
    return false;
  }
  if (!isProfessionalReasoningStatus(value.reasoningStatus)) return false;

  // proposedOrder must be exactly a permutation of proposedSkills' own
  // stepIds -- no duplicate, no missing, no unknown reference.
  const stepIds = (value.proposedSkills as ProposedSkillStep[]).map((s) => s.stepId);
  if (new Set(stepIds).size !== stepIds.length) return false;
  const orderSet = new Set(value.proposedOrder as string[]);
  if (orderSet.size !== value.proposedOrder.length) return false;
  if (orderSet.size !== stepIds.length || !stepIds.every((id) => orderSet.has(id))) return false;

  return true;
}
