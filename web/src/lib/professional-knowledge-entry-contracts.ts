import { createHash } from "crypto";

import { isRecord } from "@/lib/technical-visual-map-validators";
import {
  isProfessionalDecisionType,
  type ContextualKnowledgeClaim,
  type ProfessionalDecisionType,
  type TechniqueIdentity,
} from "@/lib/professional-knowledge-review-decision";
import { isProfessionalLearningProvenanceSource, type ProfessionalLearningProvenanceSource } from "@/lib/professional-learning-draft-validators";
import type { AtomicActionStateTransition } from "@/lib/professional-skill-atomic-action-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 --
// PROFESSIONAL KNOWLEDGE ENTRY, contract/foundation only. Types + pure
// validators, no I/O, no database, no AI. Mirrors every prior "Stage 1"
// convention in this domain (professional-skill-contracts.ts,
// professional-skill-execution-unit-contracts.ts, professional-skill-
// guide-relationship-contracts.ts): a shared vocabulary + runtime
// guards, nothing more.
//
// WHY THIS FILE EXISTS (L5.R3.5's own root cause, closed here): the ONLY
// existing "active professional authority" mechanism (SKILL_DEFINITION_
// STATUSES + isSkillEligibleForAuthority) operates on WHOLE, compilable
// SkillDefinition objects only. L5.R3.5 could activate exactly 1 of 11
// approved proposals because the other 10 are not skill-shaped at all --
// they are evidence, purpose, effect, workflow, and contextual facts.
// This file is the general, typed home for that OTHER kind of active
// professional knowledge -- reusable across future techniques and,
// eventually, future verticals -- without forcing any of it into a
// disguised SkillDefinition and without an untyped `metadata: Json`
// dump.
//
// REUSE, NOT REINVENTION (the task's own explicit "audit first"
// requirement): every payload shape below composes an ALREADY-PROVEN
// type from this codebase, never a duplicate:
//   TechniqueIdentity            -- professional-knowledge-review-decision.ts
//   ContextualKnowledgeClaim     -- professional-knowledge-review-decision.ts
//     (its own disjointness from UniversalRuleRelation is what makes
//     "commonly used for" structurally unable to become "required for")
//   AtomicActionStateTransition  -- professional-skill-atomic-action-contracts.ts
//     (the one reused before/after-state shape already flowing into
//     ExecutionScene.stateTransitions -- reused a third time here)
//   ProfessionalLearningProvenanceSource + ProfessionalDecisionType
//     -- composed together (never a third, redundant provenance enum)
//     to express every value in the task's own PROVENANCE list: AI
//     OBSERVED/INFERRED map onto ProfessionalLearningProvenanceSource;
//     PROFESSIONAL CORRECTION/ADDITION map onto ProfessionalDecisionType;
//     PROFESSIONAL INPUT is the constant professionalAuthority every
//     entry carries (mirrors ProposedRegistryMutation.professionalAuthority
//     verbatim); PROFESSIONALLY VALIDATED is decisionType CONFIRMATION
//     (the AI's own claim was professionally confirmed correct); UNKNOWN
//     is ProfessionalLearningProvenanceSource's own real UNKNOWN value.
//
// SEVEN KINDS, A DISCRIMINATED UNION, NEVER A GENERIC BAG (the task's
// own explicit "no giant generic JSON dump" requirement): each `kind`
// gates its own strongly-typed `payload` shape, mirroring AtomicAction's
// own actionKind-gated stateTransition/observationCriterion discipline
// exactly. Six carry a real, safely-attachable fact; the seventh
// (PENDING_OBSERVATION) is the general, honest home for professionally
// approved knowledge that has NO safe target yet -- the ACTIVE-layer
// sibling of MUTATION_OPERATION_TYPES' own "KEEP_PENDING", never
// silently promoted, never dropped.
//
//   TECHNIQUE_IDENTITY   -- a technique KNOWN to exist as a distinct,
//     named identity (techniqueId/label/relatedTechniqueIds/distinctFrom
//     + knownFields/unknownFields) -- explicitly NOT a claim that a
//     compilable SkillDefinition (procedure/parameters/ExecutionUnits)
//     exists for it. Deep Point Cut / Point Cut / Channel Cut activate
//     at exactly this layer: the brain can now truthfully say "this
//     technique is real, approved, and distinct from X/Y/Z" without
//     this stage inventing the missing procedure a real SkillDefinition
//     would require (which would be new professional-technique
//     engineering, forbidden during activation).
//   TECHNIQUE_PURPOSE    -- techniqueId + purpose, deliberately
//     independent of TECHNIQUE_IDENTITY (the task's own explicit "do not
//     make PURPOSE part of technique identity" rule) -- a technique may
//     carry more than one purpose entry over time, never forcing a
//     rename ("Correction Point Cut") to express a second use.
//   EFFECT_RELATIONSHIP  -- one effect label + >=2 relatedTechniqueIds,
//     many-to-many by construction (a plain array, never a merge) --
//     shared effect can never collapse into shared identity.
//   WORKFLOW_TRANSITION  -- a reusable AtomicActionStateTransition,
//     never a disguised cutting technique.
//   CONTEXTUAL_KNOWLEDGE -- techniqueId + a real ContextualKnowledgeClaim
//     -- "commonly used for" is structurally impossible to read as
//     "required for" (ContextualPreferenceRelation and
//     UniversalRuleRelation remain the two disjoint enums they already
//     were; this file adds no new relation vocabulary).
//   EVIDENCE_SUPPORT      -- targetSkillId + which fields the evidence
//     confirms unchanged + a reference to the supporting claim/decision
//     -- never a cloned or rewritten copy of the target skill.
//   PENDING_OBSERVATION   -- professionally known content with no safe
//     target; status is TYPE-LOCKED to APPROVED_BUT_UNATTACHED (see
//     below) -- it is structurally impossible to construct one with any
//     other status, so this kind can never silently become "active".

export const PROFESSIONAL_KNOWLEDGE_ENTRY_KINDS = [
  "TECHNIQUE_IDENTITY",
  "TECHNIQUE_PURPOSE",
  "EFFECT_RELATIONSHIP",
  "WORKFLOW_TRANSITION",
  "CONTEXTUAL_KNOWLEDGE",
  "EVIDENCE_SUPPORT",
  "PENDING_OBSERVATION",
] as const;
export type ProfessionalKnowledgeEntryKind = (typeof PROFESSIONAL_KNOWLEDGE_ENTRY_KINDS)[number];

export function isProfessionalKnowledgeEntryKind(value: unknown): value is ProfessionalKnowledgeEntryKind {
  return typeof value === "string" && (PROFESSIONAL_KNOWLEDGE_ENTRY_KINDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// Authority model -- APPROVED != ATTACHED != ACTIVE (the task's own
// explicit trichotomy). Every entry in this file's own registry is
// already PROFESSIONALLY APPROVED by construction (see the real-entries
// builder file -- every entry is built FROM an already-approved
// ProposedRegistryMutation/ProfessionalReviewDecision, never authored
// fresh here). What THIS status expresses is the remaining two states:
//   ACTIVE                  -- a safe target/shape was found; the brain
//     may use this fact in deterministic reasoning/queries now.
//   APPROVED_BUT_UNATTACHED -- professionally true, structurally known,
//     but no safe target/shape exists yet -- visible, queryable, but
//     inert (never consulted as though it were attached to a target).
//   RETIRED                 -- mirrors SkillDefinitionStatus's own
//     RETIRED exactly; not used by this stage (no entry is ever
//     retired here), declared for the same forward-compatible reason
//     SkillDefinitionStatus declares it.
// ---------------------------------------------------------------------

export const PROFESSIONAL_KNOWLEDGE_ENTRY_STATUSES = ["ACTIVE", "APPROVED_BUT_UNATTACHED", "RETIRED"] as const;
export type ProfessionalKnowledgeEntryStatus = (typeof PROFESSIONAL_KNOWLEDGE_ENTRY_STATUSES)[number];

export function isProfessionalKnowledgeEntryStatus(value: unknown): value is ProfessionalKnowledgeEntryStatus {
  return typeof value === "string" && (PROFESSIONAL_KNOWLEDGE_ENTRY_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// Provenance -- composed from two already-proven types, never a third
// redundant enum. See file header for the full PROVENANCE-list mapping.
// ---------------------------------------------------------------------

export interface ProfessionalKnowledgeProvenance {
  readonly originalAIClaim: { readonly value: unknown; readonly provenance: ProfessionalLearningProvenanceSource } | null;
  readonly decisionType: ProfessionalDecisionType;
  readonly professionalAuthority: "PROFESSIONAL_INPUT";
  // The exact ProfessionalReviewDecision.id (or, where the source is a
  // ProposedRegistryMutation with no underlying decision -- never the
  // case for these 10 items, all of which trace to real L5.R3.2
  // decisions -- the mutation id instead) this entry is justified by.
  // Never fabricated; never a placeholder.
  readonly sourceDecisionId: string;
}

function isValidProfessionalKnowledgeProvenance(value: unknown): value is ProfessionalKnowledgeProvenance {
  if (!isRecord(value)) return false;
  if (value.originalAIClaim !== null) {
    if (!isRecord(value.originalAIClaim)) return false;
    if (!isProfessionalLearningProvenanceSource(value.originalAIClaim.provenance)) return false;
    if (!("value" in value.originalAIClaim)) return false;
  }
  if (!isProfessionalDecisionType(value.decisionType)) return false;
  if (value.professionalAuthority !== "PROFESSIONAL_INPUT") return false;
  if (typeof value.sourceDecisionId !== "string" || value.sourceDecisionId.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------
// Per-kind payloads.
// ---------------------------------------------------------------------

export interface TechniqueIdentityKnowledgePayload {
  readonly technique: TechniqueIdentity;
  readonly knownFields: readonly string[];
  readonly unknownFields: readonly string[];
}

function isValidTechniqueIdentity(value: unknown): value is TechniqueIdentity {
  if (!isRecord(value)) return false;
  if (typeof value.techniqueId !== "string" || value.techniqueId.length === 0) return false;
  if (typeof value.label !== "string" || value.label.length === 0) return false;
  if (value.familyId !== undefined && typeof value.familyId !== "string") return false;
  if (value.relatedTechniqueIds !== undefined && !Array.isArray(value.relatedTechniqueIds)) return false;
  if (value.distinctFrom !== undefined && !Array.isArray(value.distinctFrom)) return false;
  return true;
}

function isValidTechniqueIdentityKnowledgePayload(value: unknown): value is TechniqueIdentityKnowledgePayload {
  if (!isRecord(value)) return false;
  if (!isValidTechniqueIdentity(value.technique)) return false;
  if (!Array.isArray(value.knownFields) || !value.knownFields.every((f) => typeof f === "string")) return false;
  if (!Array.isArray(value.unknownFields) || !value.unknownFields.every((f) => typeof f === "string")) return false;
  return true;
}

export interface TechniquePurposeKnowledgePayload {
  readonly techniqueId: string;
  readonly purpose: string;
  readonly note: string;
}

function isValidTechniquePurposeKnowledgePayload(value: unknown): value is TechniquePurposeKnowledgePayload {
  if (!isRecord(value)) return false;
  return typeof value.techniqueId === "string" && value.techniqueId.length > 0 && typeof value.purpose === "string" && value.purpose.length > 0 && typeof value.note === "string";
}

export interface EffectRelationshipKnowledgePayload {
  readonly effect: string;
  // >= 2, by construction (a "relationship" of one thing to itself is
  // not a relationship) -- enforced in the validator below.
  readonly relatedTechniqueIds: readonly string[];
}

function isValidEffectRelationshipKnowledgePayload(value: unknown): value is EffectRelationshipKnowledgePayload {
  if (!isRecord(value)) return false;
  if (typeof value.effect !== "string" || value.effect.length === 0) return false;
  if (!Array.isArray(value.relatedTechniqueIds) || value.relatedTechniqueIds.length < 2) return false;
  if (!value.relatedTechniqueIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  if (new Set(value.relatedTechniqueIds).size !== value.relatedTechniqueIds.length) return false; // never a duplicate/self-alias
  return true;
}

export interface WorkflowTransitionKnowledgePayload {
  readonly transition: AtomicActionStateTransition;
}

// AtomicActionStateTransition's own validator (professional-skill-atomic-
// action-contracts.ts) is a private, unexported helper -- reproduced
// here verbatim (a plain fact/fromValue?/toValue literal-typed shape)
// rather than exporting a new surface from that existing, stable
// contracts file for one reuse.
function isParameterLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

function isValidReusedAtomicActionStateTransition(value: unknown): value is AtomicActionStateTransition {
  if (!isRecord(value)) return false;
  if (typeof value.fact !== "string" || value.fact.length === 0) return false;
  if (value.fromValue !== undefined && !isParameterLiteral(value.fromValue)) return false;
  if (!("toValue" in value) || value.toValue === undefined || !isParameterLiteral(value.toValue)) return false;
  return true;
}

function isValidWorkflowTransitionKnowledgePayload(value: unknown): value is WorkflowTransitionKnowledgePayload {
  if (!isRecord(value)) return false;
  return isValidReusedAtomicActionStateTransition(value.transition);
}

export interface ContextualKnowledgePayload {
  readonly techniqueId: string;
  readonly claim: ContextualKnowledgeClaim;
}

function isValidContextualKnowledgeClaim(value: unknown): value is ContextualKnowledgeClaim {
  if (!isRecord(value)) return false;
  const relations = ["COMMONLY_USED_FOR", "TYPICALLY_USED_FOR", "PREFERRED_IN_CONTEXT", "COMPATIBLE_WITH", "ALTERNATIVE_TO", "MAY_BE_USED_FOR"];
  if (typeof value.relation !== "string" || !relations.includes(value.relation)) return false;
  if (typeof value.subject !== "string" || value.subject.length === 0) return false;
  if (typeof value.note !== "string" || value.note.length === 0) return false;
  return true;
}

function isValidContextualKnowledgePayload(value: unknown): value is ContextualKnowledgePayload {
  if (!isRecord(value)) return false;
  if (typeof value.techniqueId !== "string" || value.techniqueId.length === 0) return false;
  return isValidContextualKnowledgeClaim(value.claim);
}

export interface EvidenceSupportKnowledgePayload {
  readonly targetSkillId: string;
  readonly fieldsPreservedUnchanged: readonly string[];
  readonly evidenceReference: string;
  readonly note: string;
}

function isValidEvidenceSupportKnowledgePayload(value: unknown): value is EvidenceSupportKnowledgePayload {
  if (!isRecord(value)) return false;
  if (typeof value.targetSkillId !== "string" || value.targetSkillId.length === 0) return false;
  if (!Array.isArray(value.fieldsPreservedUnchanged) || !value.fieldsPreservedUnchanged.every((f) => typeof f === "string")) return false;
  if (typeof value.evidenceReference !== "string" || value.evidenceReference.length === 0) return false;
  if (typeof value.note !== "string") return false;
  return true;
}

export interface PendingObservationKnowledgePayload {
  readonly professionalKnowledgeSummary: string;
  readonly knownFields: readonly string[];
  readonly unknownFields: readonly string[];
  readonly reasonPending: string;
}

function isValidPendingObservationKnowledgePayload(value: unknown): value is PendingObservationKnowledgePayload {
  if (!isRecord(value)) return false;
  if (typeof value.professionalKnowledgeSummary !== "string" || value.professionalKnowledgeSummary.length === 0) return false;
  if (!Array.isArray(value.knownFields) || !value.knownFields.every((f) => typeof f === "string")) return false;
  if (!Array.isArray(value.unknownFields) || !value.unknownFields.every((f) => typeof f === "string")) return false;
  if (typeof value.reasonPending !== "string" || value.reasonPending.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------
// The discriminated union itself. Note PENDING_OBSERVATION's own
// `status` field is TYPE-LOCKED to the single literal
// "APPROVED_BUT_UNATTACHED" -- not a convention, a compile-time
// guarantee mirroring MUTATION_ACTIVATION_STATES' own single-member-
// union discipline: no code path anywhere can construct a
// PENDING_OBSERVATION entry with status ACTIVE.
// ---------------------------------------------------------------------

interface ProfessionalKnowledgeEntryBase {
  readonly id: string;
  readonly vertical: string;
  readonly provenance: ProfessionalKnowledgeProvenance;
  readonly createdAt: string;
}

export type ProfessionalKnowledgeEntry =
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "TECHNIQUE_IDENTITY"; readonly status: ProfessionalKnowledgeEntryStatus; readonly payload: TechniqueIdentityKnowledgePayload })
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "TECHNIQUE_PURPOSE"; readonly status: ProfessionalKnowledgeEntryStatus; readonly payload: TechniquePurposeKnowledgePayload })
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "EFFECT_RELATIONSHIP"; readonly status: ProfessionalKnowledgeEntryStatus; readonly payload: EffectRelationshipKnowledgePayload })
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "WORKFLOW_TRANSITION"; readonly status: ProfessionalKnowledgeEntryStatus; readonly payload: WorkflowTransitionKnowledgePayload })
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "CONTEXTUAL_KNOWLEDGE"; readonly status: ProfessionalKnowledgeEntryStatus; readonly payload: ContextualKnowledgePayload })
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "EVIDENCE_SUPPORT"; readonly status: ProfessionalKnowledgeEntryStatus; readonly payload: EvidenceSupportKnowledgePayload })
  | (ProfessionalKnowledgeEntryBase & { readonly kind: "PENDING_OBSERVATION"; readonly status: "APPROVED_BUT_UNATTACHED"; readonly payload: PendingObservationKnowledgePayload });

export function isValidProfessionalKnowledgeEntry(value: unknown): value is ProfessionalKnowledgeEntry {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (!isProfessionalKnowledgeEntryStatus(value.status)) return false;
  if (!isValidProfessionalKnowledgeProvenance(value.provenance)) return false;
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) return false;
  if (!isProfessionalKnowledgeEntryKind(value.kind)) return false;

  switch (value.kind) {
    case "TECHNIQUE_IDENTITY":
      return isValidTechniqueIdentityKnowledgePayload(value.payload);
    case "TECHNIQUE_PURPOSE":
      return isValidTechniquePurposeKnowledgePayload(value.payload);
    case "EFFECT_RELATIONSHIP":
      return isValidEffectRelationshipKnowledgePayload(value.payload);
    case "WORKFLOW_TRANSITION":
      return isValidWorkflowTransitionKnowledgePayload(value.payload);
    case "CONTEXTUAL_KNOWLEDGE":
      return isValidContextualKnowledgePayload(value.payload);
    case "EVIDENCE_SUPPORT":
      return isValidEvidenceSupportKnowledgePayload(value.payload);
    case "PENDING_OBSERVATION":
      // Type-locked status, also runtime-checked -- defense in depth.
      if (value.status !== "APPROVED_BUT_UNATTACHED") return false;
      return isValidPendingObservationKnowledgePayload(value.payload);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------
// Deterministic id -- mirrors computeProposedRegistryMutationId's own
// exact sha256-of-canonical-content precedent.
// ---------------------------------------------------------------------

export function computeProfessionalKnowledgeEntryId(kind: ProfessionalKnowledgeEntryKind, sourceDecisionId: string, discriminator: string): string {
  return createHash("sha256").update(`${kind}|${sourceDecisionId}|${discriminator}`, "utf8").digest("hex");
}
