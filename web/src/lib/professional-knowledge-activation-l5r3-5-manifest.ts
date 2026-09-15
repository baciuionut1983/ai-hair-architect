import { createHash } from "crypto";

import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { INTERIOR_45_PROPOSED_MUTATION } from "@/lib/professional-knowledge-assimilation-l5r3-4-r2-proposal";
import type { ProposedRegistryMutation } from "@/lib/professional-knowledge-assimilation-mutation-contracts";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { computeRegistryContextHash } from "@/lib/professional-knowledge-registry-comparison";
import { INTERIOR_45_SKILL } from "@/lib/cutting-skill-45-degree-interior";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.5 --
// PROFESSIONAL KNOWLEDGE ACTIVATION MANIFEST. Pure, no I/O, no database,
// ZERO AI calls. This file defines EXACTLY which of the 11 professionally
// approved L5.R3.4.R1 (10) + L5.R3.4.R2 (1) proposals the activation
// layer is authorized to consider, and classifies each one deterministically
// -- it never reasons about NEW professional content, only about whether an
// EXISTING mechanism can safely apply an ALREADY-approved proposal.
//
// ARCHITECTURE AUDIT (this stage's own required first step, performed by
// direct reading -- professional-skill-contracts.ts, professional-skill-
// execution-unit-contracts.ts, professional-skill-registry-repository.ts,
// professional-brain-skill-templates.ts, prisma/schema.prisma's own model
// list):
//
//   THE ONE EXISTING ACTIVATION MECHANISM: SKILL_DEFINITION_STATUSES
//   ("DRAFT"|"ACTIVE"|"RETIRED") + isSkillEligibleForAuthority (status
//   ACTIVE, authorityType !== MACHINE_DRAFTED) is the ONLY lifecycle
//   model this codebase has for "professional knowledge is now active
//   authority" -- and it operates on WHOLE, structurally complete
//   SkillDefinition objects only (isValidSkillDefinition requires a real
//   >=2-step procedure, parameters, etc.). Two real, parallel expressions
//   of this ONE mechanism exist: (a) professional-skill-registry-
//   repository.ts's DB-backed createSkillDefinition/activateSkillDefinition
//   (a real Prisma table, ProfessionalSkillDefinition, currently EMPTY --
//   never populated by any of the 6 pre-existing skills); (b) the
//   in-memory canonical registry professional-brain-skill-templates.ts
//   builds by literally authoring `status: "ACTIVE"` on a cutting-skill-
//   *.ts constant and collecting it into buildCanonicalCandidateSkillRegistry()
//   -- THIS is what every one of the 6 pre-existing skills actually used,
//   and it is what the real runtime brain/compiler pipeline actually
//   reads today (per that file's own header: reading the DB registry is
//   "a purely additive follow-up", not yet wired). Both are exercised by
//   this stage, honestly labeled (see the L5.R3.5 report).
//
//   WHAT HAS NO EXISTING MECHANISM (verified by direct grep/read, not
//   assumed): "evidence attachment" (no field anywhere on SkillDefinition
//   or ExecutionUnit represents an attached evidence pointer -- the
//   mutation's own `guideRelationshipEvidence` fieldsAdded entry names a
//   fact with no architectural home; forcing it into `parameters` would
//   misrepresent audit/provenance evidence as a professional-configurable
//   execution parameter); "workflow state transition knowledge" as
//   standalone active authority (no persisted or in-memory "active
//   workflow knowledge" registry exists anywhere -- "hairWorkflowPhase"
//   appears only inside the proposal/mutation layer, and this fact is not
//   skill-specific, targetSkillId is null); "effect relationship" as
//   standalone active authority (same -- a plan-level annotation only);
//   and a full SkillDefinition for Deep Point Cut / Point Cut / Channel
//   Cut specifically (their own PROPOSE_NEW_SKILL mutations carry ONLY
//   proposal-level identity metadata -- techniqueId/label/purpose/
//   distinctFrom -- with zero procedure/parameters/capabilities; nothing
//   in the codebase has ever authored a real SkillDefinition for any of
//   these three techniqueIds, unlike 45-degree-interior, which DOES have
//   one, authored at Stage 8.5L5.R3.4.R2). Authoring full technique
//   content for these three now would be NEW professional-technique
//   engineering during an "activation" stage -- exactly what this stage's
//   own task explicitly forbids ("must not... reinterpret it; expand it;
//   generalize it; repair it... infer missing fields").
//
// CONCLUSION: of the 11 approved proposals, exactly ONE (45-degree-interior)
// has a real artifact this architecture can safely activate today. The
// other 10 remain PENDING -- 4 by the approved plan's OWN original design
// (operation === "KEEP_PENDING": #4-guide, #9, #10, #6a-direction, never
// intended to become active knowledge yet) and 6 due to a genuine,
// independently-verified architecture gap (ATTACH_EVIDENCE #2-guide;
// PROPOSE_NEW_SKILL for deep-point-cut/point-cut/channel-cut;
// ADD_WORKFLOW_STATE_TRANSITION #6b; ADD_EFFECT_RELATIONSHIP). This is
// reported honestly, never papered over by forcing an unsafe or
// improvised mutation.

export const EXPECTED_APPROVED_PROPOSAL_COUNT = 11;

// The exact authorized set -- the 10 existing L5.R3.4.R1 mutations
// (read-only, never rebuilt or reinterpreted) plus the 1 new L5.R3.4.R2
// mutation. Order is deterministic (existing plan's own array order,
// then the new mutation appended last) -- see the manifest's own
// canonical hash, which sorts by id anyway, so array order never affects
// the manifest's own identity.
export function buildAuthorizedProposalSet(): readonly ProposedRegistryMutation[] {
  return [...buildRealAssimilationPlan().mutationSet, INTERIOR_45_PROPOSED_MUTATION];
}

// The ONE techniqueId with a real, authored, structurally valid
// SkillDefinition ready for activation -- an explicit, auditable
// allowlist, never a runtime "try to guess if content exists" heuristic.
export const ACTIVATION_ELIGIBLE_TECHNIQUE_IDS: ReadonlySet<string> = new Set(["45-degree-interior"]);

export const MUTATION_ACTIVATION_CLASSIFICATIONS = ["ACTIVATED", "PENDING_BY_DESIGN", "PENDING_NO_MECHANISM"] as const;
export type MutationActivationClassification = (typeof MUTATION_ACTIVATION_CLASSIFICATIONS)[number];

export interface MutationActivationClassificationResult {
  readonly mutationId: string;
  readonly operation: string;
  readonly classification: MutationActivationClassification;
  readonly reason: string;
}

// Pure classification logic -- consumes an already-approved
// ProposedRegistryMutation exactly as constructed by the existing
// L5.R3.4/L5.R3.4.R2 planners; never reinterprets its content, only
// asks "does a safe existing mechanism exist for this operation type
// (and, for PROPOSE_NEW_SKILL, this specific techniqueId)".
export function classifyMutationForActivation(mutation: ProposedRegistryMutation): MutationActivationClassificationResult {
  if (mutation.operation === "KEEP_PENDING") {
    return {
      mutationId: mutation.id,
      operation: mutation.operation,
      classification: "PENDING_BY_DESIGN",
      reason: "This mutation's own operation is KEEP_PENDING -- the approved plan itself never intended this to become active knowledge yet; retained as structured, reviewable professional knowledge only.",
    };
  }
  if (mutation.operation === "PROPOSE_NEW_SKILL" && mutation.proposedIdentity && ACTIVATION_ELIGIBLE_TECHNIQUE_IDS.has(mutation.proposedIdentity.techniqueId)) {
    return {
      mutationId: mutation.id,
      operation: mutation.operation,
      classification: "ACTIVATED",
      reason: `A complete, structurally valid SkillDefinition already exists for techniqueId "${mutation.proposedIdentity.techniqueId}" -- activated via the existing DRAFT->ACTIVE mechanism (SKILL_DEFINITION_STATUSES + isSkillEligibleForAuthority), both in-memory (professional-brain-skill-templates.ts) and via the real DB-backed repository (professional-skill-registry-repository.ts).`,
    };
  }
  if (mutation.operation === "PROPOSE_NEW_SKILL") {
    return {
      mutationId: mutation.id,
      operation: mutation.operation,
      classification: "PENDING_NO_MECHANISM",
      reason: `techniqueId "${mutation.proposedIdentity?.techniqueId ?? "unknown"}" has no authored SkillDefinition anywhere in the codebase -- only proposal-level identity metadata exists (no procedure/parameters/capabilities). Authoring one now would be new professional-technique engineering, not activation of an already-approved artifact.`,
    };
  }
  if (mutation.operation === "ATTACH_EVIDENCE") {
    return {
      mutationId: mutation.id,
      operation: mutation.operation,
      classification: "PENDING_NO_MECHANISM",
      reason: "SkillDefinition/ExecutionUnit have no field representing an attached evidence pointer. Forcing this into `parameters` would misrepresent audit/provenance evidence as a professional-configurable execution parameter -- a structural mismatch, not a missing value.",
    };
  }
  if (mutation.operation === "ADD_WORKFLOW_STATE_TRANSITION") {
    return {
      mutationId: mutation.id,
      operation: mutation.operation,
      classification: "PENDING_NO_MECHANISM",
      reason: "No persisted or in-memory 'active workflow knowledge' registry exists anywhere in this codebase -- this fact is not skill-specific (targetSkillId is null) and has no existing home.",
    };
  }
  if (mutation.operation === "ADD_EFFECT_RELATIONSHIP") {
    return {
      mutationId: mutation.id,
      operation: mutation.operation,
      classification: "PENDING_NO_MECHANISM",
      reason: "No persisted or in-memory 'active effect relationship' registry exists anywhere in this codebase -- a plan-level annotation only today.",
    };
  }
  return {
    mutationId: mutation.id,
    operation: mutation.operation,
    classification: "PENDING_NO_MECHANISM",
    reason: `No known activation mechanism exists for operation "${mutation.operation}".`,
  };
}

// ---------------------------------------------------------------------
// The Activation Manifest itself -- the deterministic record the
// activation layer is bound to. See file header: "the activation code
// must know EXACTLY which approved proposal set it is allowed to apply."
// ---------------------------------------------------------------------

export const ACTIVATION_MANIFEST_STATES = ["MANIFEST_PREPARED"] as const;
export type ActivationManifestState = (typeof ACTIVATION_MANIFEST_STATES)[number];

export interface ActivationManifest {
  readonly activationId: string;
  readonly sourceProposalIds: readonly string[];
  readonly expectedProposalCount: number;
  readonly expectedBaselineRegistryFingerprint: string;
  readonly professionalAuthority: "PROFESSIONAL_INPUT";
  readonly approvedProposalFingerprints: readonly string[];
  readonly expectedTargetIdentities: readonly { techniqueId: string | null; targetSkillId: string | null }[];
  readonly expectedOperationTypes: readonly string[];
  readonly unknownFields: readonly string[];
  readonly conflictStatus: readonly string[];
  readonly activationState: ActivationManifestState;
}

// The pre-activation baseline registry (6 skills) is reconstructed by
// filtering the LIVE canonical registry down to exclude 45-degree-interior
// -- mathematically identical to a true pre-edit capture, because none of
// the other 6 skills' own source files were touched by this stage (proven
// independently by cutting-skill-45-degree-interior.test.ts's own byte-
// unchanged assertions for Graduated Cutting / One-Length, and by this
// file's own sibling test suite for the remaining four).
export function computePreActivationBaselineRegistryFingerprint(): string {
  const preActivationRegistry = buildCanonicalCandidateSkillRegistry().filter((record) => record.skillId !== INTERIOR_45_SKILL.skillId);
  return computeRegistryContextHash(preActivationRegistry);
}

export function buildActivationManifest(): ActivationManifest {
  const proposals = buildAuthorizedProposalSet();
  const canonicalIds = [...proposals.map((m) => m.id)].sort();
  return {
    activationId: createHash("sha256").update(`l5r3-5-activation|${canonicalIds.join("|")}`, "utf8").digest("hex"),
    sourceProposalIds: proposals.map((m) => m.id),
    expectedProposalCount: EXPECTED_APPROVED_PROPOSAL_COUNT,
    expectedBaselineRegistryFingerprint: computePreActivationBaselineRegistryFingerprint(),
    professionalAuthority: "PROFESSIONAL_INPUT",
    approvedProposalFingerprints: proposals.map((m) => m.id),
    expectedTargetIdentities: proposals.map((m) => ({ techniqueId: m.proposedIdentity?.techniqueId ?? null, targetSkillId: m.targetSkillId })),
    expectedOperationTypes: proposals.map((m) => m.operation),
    unknownFields: [...new Set(proposals.flatMap((m) => m.unknownFieldsPreserved))].sort(),
    conflictStatus: proposals.map((m) => m.conflict),
    activationState: "MANIFEST_PREPARED",
  };
}

// ---------------------------------------------------------------------
// Fail-closed validation -- see the L5.R3.5 task's own explicit
// FAIL-CLOSED REQUIREMENTS list. Every check below returns a reason
// string on failure; validation NEVER throws, NEVER mutates, and NEVER
// partially applies -- the caller decides what to do with a failed
// result (this stage's own answer: STOP, no activation).
// ---------------------------------------------------------------------

export interface ActivationManifestValidationResult {
  readonly valid: boolean;
  readonly failures: readonly string[];
}

export function validateActivationManifest(
  manifest: ActivationManifest,
  liveProposals: readonly ProposedRegistryMutation[],
  liveBaselineRegistryFingerprint: string,
): ActivationManifestValidationResult {
  const failures: string[] = [];

  if (manifest.expectedProposalCount !== EXPECTED_APPROVED_PROPOSAL_COUNT) {
    failures.push(`manifest.expectedProposalCount (${manifest.expectedProposalCount}) does not equal the required ${EXPECTED_APPROVED_PROPOSAL_COUNT}.`);
  }
  if (liveProposals.length !== manifest.expectedProposalCount) {
    failures.push(`Live authorized proposal count (${liveProposals.length}) does not match the manifest's own expected count (${manifest.expectedProposalCount}).`);
  }

  const liveIds = new Set(liveProposals.map((m) => m.id));
  for (const id of manifest.sourceProposalIds) {
    if (!liveIds.has(id)) failures.push(`Manifest-authorized proposal id ${id} is missing from the live authorized set (fingerprint drift or removal).`);
  }
  const manifestIds = new Set(manifest.sourceProposalIds);
  for (const id of liveIds) {
    if (!manifestIds.has(id)) failures.push(`Live proposal id ${id} is not present in the manifest -- an unexpected/unauthorized proposal (would become a 12th item).`);
  }

  if (liveBaselineRegistryFingerprint !== manifest.expectedBaselineRegistryFingerprint) {
    failures.push(`Registry baseline fingerprint drifted: manifest expected ${manifest.expectedBaselineRegistryFingerprint}, live is ${liveBaselineRegistryFingerprint}.`);
  }

  return { valid: failures.length === 0, failures };
}
