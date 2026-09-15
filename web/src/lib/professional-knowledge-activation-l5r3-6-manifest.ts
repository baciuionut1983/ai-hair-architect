import { createHash } from "crypto";

import {
  computeProfessionalKnowledgeEntryId,
  type ProfessionalKnowledgeEntry,
  type ProfessionalKnowledgeProvenance,
} from "@/lib/professional-knowledge-entry-contracts";
import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS } from "@/lib/professional-knowledge-review-l5r3-2-real-decisions";
import type { ProfessionalReviewDecision } from "@/lib/professional-knowledge-review-decision";
import type { ProposedRegistryMutation } from "@/lib/professional-knowledge-assimilation-mutation-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 -- THE
// REAL ACTIVE PROFESSIONAL KNOWLEDGE ENTRIES + ACTIVATION MANIFEST. Pure,
// no I/O, no database, ZERO AI calls, ZERO registry writes anywhere in
// this file. Every entry below is built by READING an already-approved
// ProposedRegistryMutation (L5.R3.4.R1's own real 10-mutation plan,
// professional-knowledge-assimilation-l5r3-4-real-plan.ts, completely
// unmodified, read-only) and its underlying ProfessionalReviewDecision
// (L5.R3.2's own real 13 decisions, also unmodified, read-only) --
// NEVER reconstructed, reinterpreted, or re-authored from this stage's
// own task prompt. If a real mutation this file expects to find is
// missing or renamed, the lookup helpers below throw rather than
// silently proceed on a guess.
//
// 45deg Interior (activated at L5.R3.5) is DELIBERATELY untouched here
// -- this file's own scope is strictly the OTHER 10 approved L5.R3.4.R1
// mutations (10, not 11 -- the 45deg Interior PROPOSE_NEW_SKILL mutation
// is excluded by construction, see EXPECTED_MUTATION_COUNT below).
//
// SIX APPROVED ITEMS -> TWELVE TYPED ENTRIES, ALL ACTIVE: each of the
// six approved items (Graduated Cutting evidence; Deep Point Cut; Point
// Cut; Channel Cut; wet->dry workflow; the effect relationship) is a
// bundle of several real facts (an identity, a purpose, one or more
// contextual claims, ...) -- this file decomposes each into its own
// correctly-typed ProfessionalKnowledgeEntry, never one flattened
// record. This is a NATURAL, non-inflated decomposition: every field
// below is copied verbatim from the real mutation/decision, nothing
// invented, nothing merged.
//
// FOUR ITEMS -> FOUR PENDING_OBSERVATION ENTRIES: #4-guide, #9, #10,
// #6a-direction stay exactly what the approved plan already said they
// are -- KEEP_PENDING, unattached -- now additionally VISIBLE and
// QUERYABLE as ACTIVE-REGISTRY-RESIDENT knowledge (status
// APPROVED_BUT_UNATTACHED, type-locked, can never silently become
// ACTIVE), rather than only existing buried inside a plan object.

const VERTICAL = "cutting";
const CREATED_AT = "2026-09-15T00:00:00.000Z";

// The 10 non-45deg-Interior mutations this stage operates on.
export const EXPECTED_MUTATION_COUNT = 10;

export function buildScopedMutationSet(): readonly ProposedRegistryMutation[] {
  return buildRealAssimilationPlan().mutationSet.filter((m) => m.proposedIdentity?.techniqueId !== "45-degree-interior");
}

function findMutation(mutations: readonly ProposedRegistryMutation[], predicate: (m: ProposedRegistryMutation) => boolean, label: string): ProposedRegistryMutation {
  const found = mutations.find(predicate);
  if (!found) throw new Error(`L5.R3.6 activation manifest: expected approved mutation "${label}" was not found in the real L5.R3.4.R1 plan -- baseline drift, refusing to proceed.`);
  return found;
}

function findDecision(decisionId: string): ProfessionalReviewDecision {
  const found = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.id === decisionId);
  if (!found) throw new Error(`L5.R3.6 activation manifest: source decision id ${decisionId} was not found in the real L5.R3.2 decisions -- baseline drift, refusing to proceed.`);
  return found;
}

// Provenance is derived from the mutation's own FIRST sourceDecisionId
// (a documented, single-pointer convention -- mirrors SkillInstance's
// own "one sourceSkillId+version reference, never an embedded copy"
// precedent). Full multi-decision traceability remains on the
// underlying mutation object itself (sourceDecisionIds, plural),
// reachable by any consumer that needs it.
function provenanceFromMutation(mutation: ProposedRegistryMutation): ProfessionalKnowledgeProvenance {
  const primaryDecisionId = mutation.sourceDecisionIds[0];
  const decision = findDecision(primaryDecisionId);
  return {
    originalAIClaim: decision.originalAIClaim,
    decisionType: decision.decisionType,
    professionalAuthority: "PROFESSIONAL_INPUT",
    sourceDecisionId: decision.id,
  };
}

// ---------------------------------------------------------------------
// A. Graduated Cutting evidence -- 1 EVIDENCE_SUPPORT entry.
// ---------------------------------------------------------------------

export function buildGraduatedCuttingEvidenceEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  const mutation = findMutation(mutations, (m) => m.operation === "ATTACH_EVIDENCE", "#2-guide ATTACH_EVIDENCE");
  const evidenceField = mutation.fieldsAdded.find((f) => f.name === "guideRelationshipEvidence");
  if (!evidenceField) throw new Error("L5.R3.6: expected fieldsAdded entry 'guideRelationshipEvidence' missing from the real #2-guide mutation.");
  const provenance = provenanceFromMutation(mutation);
  return [
    {
      id: computeProfessionalKnowledgeEntryId("EVIDENCE_SUPPORT", provenance.sourceDecisionId, mutation.id),
      kind: "EVIDENCE_SUPPORT",
      vertical: VERTICAL,
      status: "ACTIVE",
      payload: {
        targetSkillId: mutation.targetSkillId ?? "",
        fieldsPreservedUnchanged: mutation.fieldsPreservedUnchanged,
        evidenceReference: evidenceField.value,
        note: mutation.reason,
      },
      provenance,
      createdAt: CREATED_AT,
    },
  ];
}

// ---------------------------------------------------------------------
// B/C/D. Deep Point Cut / Point Cut / Channel Cut -- each a
// TECHNIQUE_IDENTITY + TECHNIQUE_PURPOSE entry, plus one
// CONTEXTUAL_KNOWLEDGE entry per real contextualKnowledge claim on the
// underlying mutation (0, 1, or 2 depending on the real, approved data).
// ---------------------------------------------------------------------

function buildTechniqueEntries(mutation: ProposedRegistryMutation): readonly ProfessionalKnowledgeEntry[] {
  if (!mutation.proposedIdentity) throw new Error(`L5.R3.6: mutation ${mutation.id} has no proposedIdentity -- cannot build TECHNIQUE_IDENTITY/TECHNIQUE_PURPOSE entries.`);
  const provenance = provenanceFromMutation(mutation);
  const identity = mutation.proposedIdentity;

  const identityEntry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", provenance.sourceDecisionId, mutation.id),
    kind: "TECHNIQUE_IDENTITY",
    vertical: VERTICAL,
    status: "ACTIVE",
    payload: {
      technique: { techniqueId: identity.techniqueId, label: identity.label, familyId: identity.familyId, relatedTechniqueIds: identity.relatedTechniqueIds, distinctFrom: identity.distinctFrom },
      knownFields: mutation.fieldsAdded.map((f) => f.name),
      unknownFields: mutation.unknownFieldsPreserved,
    },
    provenance,
    createdAt: CREATED_AT,
  };

  const purposeEntry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("TECHNIQUE_PURPOSE", provenance.sourceDecisionId, `${mutation.id}|purpose`),
    kind: "TECHNIQUE_PURPOSE",
    vertical: VERTICAL,
    status: "ACTIVE",
    payload: { techniqueId: identity.techniqueId, purpose: identity.purpose, note: mutation.reason },
    provenance,
    createdAt: CREATED_AT,
  };

  const contextualEntries: ProfessionalKnowledgeEntry[] = mutation.contextualKnowledge.map((claim, index) => ({
    id: computeProfessionalKnowledgeEntryId("CONTEXTUAL_KNOWLEDGE", provenance.sourceDecisionId, `${mutation.id}|context|${index}`),
    kind: "CONTEXTUAL_KNOWLEDGE" as const,
    vertical: VERTICAL,
    status: "ACTIVE" as const,
    payload: { techniqueId: identity.techniqueId, claim },
    provenance,
    createdAt: CREATED_AT,
  }));

  return [identityEntry, purposeEntry, ...contextualEntries];
}

export function buildDeepPointCutEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  return buildTechniqueEntries(findMutation(mutations, (m) => m.proposedIdentity?.techniqueId === "deep-point-cut", "deep-point-cut PROPOSE_NEW_SKILL"));
}

export function buildPointCutEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  return buildTechniqueEntries(findMutation(mutations, (m) => m.proposedIdentity?.techniqueId === "point-cut", "point-cut PROPOSE_NEW_SKILL"));
}

export function buildChannelCutEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  return buildTechniqueEntries(findMutation(mutations, (m) => m.proposedIdentity?.techniqueId === "channel-cut", "channel-cut PROPOSE_NEW_SKILL"));
}

// ---------------------------------------------------------------------
// E. Wet -> dry workflow transition -- 1 WORKFLOW_TRANSITION entry.
// ---------------------------------------------------------------------

export function buildWetToDryWorkflowEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  const mutation = findMutation(mutations, (m) => m.operation === "ADD_WORKFLOW_STATE_TRANSITION", "#6b-wet-to-dry ADD_WORKFLOW_STATE_TRANSITION");
  if (!mutation.workflowStateTransition) throw new Error("L5.R3.6: expected workflowStateTransition missing from the real #6b mutation.");
  const provenance = provenanceFromMutation(mutation);
  return [
    {
      id: computeProfessionalKnowledgeEntryId("WORKFLOW_TRANSITION", provenance.sourceDecisionId, mutation.id),
      kind: "WORKFLOW_TRANSITION",
      vertical: VERTICAL,
      status: "ACTIVE",
      payload: { transition: { fact: mutation.workflowStateTransition.fact, fromValue: mutation.workflowStateTransition.fromValue, toValue: mutation.workflowStateTransition.toValue } },
      provenance,
      createdAt: CREATED_AT,
    },
  ];
}

// ---------------------------------------------------------------------
// F. Effect relationship -- 1 EFFECT_RELATIONSHIP entry.
// ---------------------------------------------------------------------

export function buildEffectRelationshipEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  const mutation = findMutation(mutations, (m) => m.operation === "ADD_EFFECT_RELATIONSHIP", "ADD_EFFECT_RELATIONSHIP");
  const relatedTechniqueIds = mutation.fieldsAdded.filter((f) => f.name === "relatedTechniqueId").map((f) => f.value);
  if (relatedTechniqueIds.length < 2) throw new Error("L5.R3.6: the real effect-relationship mutation has fewer than 2 relatedTechniqueId entries.");
  // ADD_EFFECT_RELATIONSHIP (professional-knowledge-assimilation-mutation-
  // contracts.ts, protected/unmodified by this stage) has no dedicated
  // "effect label" field of its own -- only fieldsAdded (the related
  // technique ids) and a free-text `reason`. The real, already-approved
  // reason text names the effect in ALL_CAPS quotes (verified directly:
  // "...contribute to the target effect \"REDUCE_SOFTEN_TEXTURIZE_
  // TERMINAL_MASS\"..."); extracted here via a narrow, fail-closed
  // pattern match over this one known, already-approved string -- never
  // a general inference/NLP mechanism -- and this function throws rather
  // than guessing if the pattern is ever absent.
  const effectLabel = mutation.reason.match(/"([A-Z_]+)"/)?.[1];
  if (!effectLabel) throw new Error("L5.R3.6: could not extract the effect label from the real effect-relationship mutation's own reason text.");
  const provenance = provenanceFromMutation(mutation);
  return [
    {
      id: computeProfessionalKnowledgeEntryId("EFFECT_RELATIONSHIP", provenance.sourceDecisionId, mutation.id),
      kind: "EFFECT_RELATIONSHIP",
      vertical: VERTICAL,
      status: "ACTIVE",
      payload: { effect: effectLabel, relatedTechniqueIds },
      provenance,
      createdAt: CREATED_AT,
    },
  ];
}

// ---------------------------------------------------------------------
// The 4 items that MUST remain pending/unattached -- #4-guide, #9, #10,
// #6a-direction. Each becomes exactly one PENDING_OBSERVATION entry,
// status type-locked to APPROVED_BUT_UNATTACHED. Content is copied
// verbatim from the real KEEP_PENDING mutation + its own real decision
// -- nothing inferred, nothing attached to any target.
// ---------------------------------------------------------------------

function buildPendingObservationEntry(mutation: ProposedRegistryMutation, decision: ProfessionalReviewDecision): ProfessionalKnowledgeEntry {
  const provenance = provenanceFromMutation(mutation);
  return {
    id: computeProfessionalKnowledgeEntryId("PENDING_OBSERVATION", provenance.sourceDecisionId, mutation.id),
    kind: "PENDING_OBSERVATION",
    vertical: VERTICAL,
    status: "APPROVED_BUT_UNATTACHED",
    payload: {
      professionalKnowledgeSummary: decision.professionalValue,
      knownFields: decision.knownFields,
      unknownFields: mutation.unknownFieldsPreserved,
      reasonPending: mutation.reason,
    },
    provenance,
    createdAt: CREATED_AT,
  };
}

export function buildPendingObservationEntries(mutations: readonly ProposedRegistryMutation[]): readonly ProfessionalKnowledgeEntry[] {
  const keepPending = mutations.filter((m) => m.operation === "KEEP_PENDING");
  if (keepPending.length !== 4) throw new Error(`L5.R3.6: expected exactly 4 KEEP_PENDING mutations in the real plan, found ${keepPending.length} -- baseline drift, refusing to proceed.`);
  return keepPending.map((mutation) => buildPendingObservationEntry(mutation, findDecision(mutation.sourceDecisionIds[0])));
}

// ---------------------------------------------------------------------
// The full real entry set -- all 16 (12 ACTIVE + 4 APPROVED_BUT_UNATTACHED).
// ---------------------------------------------------------------------

export function buildRealProfessionalKnowledgeEntries(): readonly ProfessionalKnowledgeEntry[] {
  const mutations = buildScopedMutationSet();
  return [
    ...buildGraduatedCuttingEvidenceEntries(mutations),
    ...buildDeepPointCutEntries(mutations),
    ...buildPointCutEntries(mutations),
    ...buildChannelCutEntries(mutations),
    ...buildWetToDryWorkflowEntries(mutations),
    ...buildEffectRelationshipEntries(mutations),
    ...buildPendingObservationEntries(mutations),
  ];
}

// ---------------------------------------------------------------------
// Activation manifest -- mirrors professional-knowledge-activation-
// l5r3-5-manifest.ts's own exact pattern: a deterministic, fail-closed
// record of EXACTLY which approved mutations this stage is authorized
// to read, so activation never silently drifts onto an unapproved or
// changed set.
// ---------------------------------------------------------------------

export interface KnowledgeActivationManifest {
  readonly activationId: string;
  readonly sourceMutationIds: readonly string[];
  readonly expectedMutationCount: number;
  readonly professionalAuthority: "PROFESSIONAL_INPUT";
}

export function buildKnowledgeActivationManifest(): KnowledgeActivationManifest {
  const mutations = buildScopedMutationSet();
  const ids = [...mutations.map((m) => m.id)].sort();
  return {
    activationId: createHash("sha256").update(`l5r3-6-knowledge-activation|${ids.join("|")}`, "utf8").digest("hex"),
    sourceMutationIds: mutations.map((m) => m.id),
    expectedMutationCount: EXPECTED_MUTATION_COUNT,
    professionalAuthority: "PROFESSIONAL_INPUT",
  };
}

export interface KnowledgeActivationManifestValidationResult {
  readonly valid: boolean;
  readonly failures: readonly string[];
}

export function validateKnowledgeActivationManifest(manifest: KnowledgeActivationManifest, liveMutations: readonly ProposedRegistryMutation[]): KnowledgeActivationManifestValidationResult {
  const failures: string[] = [];
  if (manifest.expectedMutationCount !== EXPECTED_MUTATION_COUNT) failures.push(`manifest.expectedMutationCount (${manifest.expectedMutationCount}) != required ${EXPECTED_MUTATION_COUNT}`);
  if (liveMutations.length !== manifest.expectedMutationCount) failures.push(`live mutation count (${liveMutations.length}) != manifest expected (${manifest.expectedMutationCount})`);
  const liveIds = new Set(liveMutations.map((m) => m.id));
  for (const id of manifest.sourceMutationIds) {
    if (!liveIds.has(id)) failures.push(`manifest-authorized mutation id ${id} missing from the live set`);
  }
  const manifestIds = new Set(manifest.sourceMutationIds);
  for (const id of liveIds) {
    if (!manifestIds.has(id)) failures.push(`live mutation id ${id} not present in the manifest -- unauthorized/unexpected mutation`);
  }
  return { valid: failures.length === 0, failures };
}
