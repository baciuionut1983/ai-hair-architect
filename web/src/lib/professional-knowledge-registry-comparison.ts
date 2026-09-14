import { createHash } from "crypto";

import type { ProfessionalLearningExtractionFieldName } from "@/lib/professional-learning-draft-validators";
import type { ReferenceDependencyRelationship, ReferenceDependencyRelationshipType } from "@/lib/professional-learning-reference-dependency";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import type { SkillCapabilityKind } from "@/lib/professional-skill-contracts";
import type { ProfessionalKnowledgeUnit } from "@/lib/professional-knowledge-unit";
import type { BoundClaim } from "@/lib/professional-knowledge-claim-binding";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 --
// DETERMINISTIC KNOWLEDGE-UNIT REGISTRY COMPARISON. Pure, no I/O, no
// database, ZERO AI calls, ZERO registry writes.
//
// Reuses the EXACT two structural-evidence mechanisms
// professional-learning-reviewed-comparison.ts already established and
// proved on real data (Stage 8.5L5.R1.1): PARAMETER EVIDENCE (a unit's own
// PROFESSIONAL_INPUT field value matches a registry skill's declared
// FIXED, single-allowed-value parameter) and CAPABILITY EVIDENCE (an
// ESTABLISHED reference-dependency relationship maps, via ONE small
// declarative table, to a capability the skill declares). This file does
// NOT duplicate that logic by accident -- it re-derives the same two
// mechanisms because they operate over a ProfessionalKnowledgeUnit
// (Section 13's shape) rather than a flat ProfessionalLearningExtraction
// (a draft's shape); the underlying evidence discipline is identical on
// purpose.
//
// Never lexical/title/haircut-name matching (Section 27/32) -- this file
// never reads `unit.label` or any provider-supplied technique text.

const RELATIONSHIP_TYPE_TO_CAPABILITY_KIND: Partial<Record<ReferenceDependencyRelationshipType, SkillCapabilityKind>> = {
  ESTABLISHES_REFERENCE: "ESTABLISH_GUIDE",
  REPLACES_REFERENCE: "ESTABLISH_GUIDE",
  USES_REFERENCE: "CONNECT_ZONES",
  ALIGNS_TO_REFERENCE: "CONNECT_ZONES",
  CUTS_TO_REFERENCE: "CONNECT_ZONES",
  CONTINUES_REFERENCE: "CONNECT_ZONES",
};

function extractLeadingNumber(text: string): number | null {
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

// Section 30/31: a parameter-evidence match may come from either an
// actual field-level PROFESSIONAL_INPUT correction (the original L5.R1.1
// mechanism) OR a PROFESSIONALLY_CONFIRMED claim binding (Stage
// 8.5L5.R3.1 -- Ionuț named a theme that matches this exact OBSERVED/
// INFERRED claim). `via` keeps the two visibly distinct -- a review
// confirmation is never silently presented as if it were a field-level
// correction (Section 6/8).
export const KNOWLEDGE_PARAMETER_EVIDENCE_SOURCES = ["PROFESSIONAL_INPUT_CORRECTION", "PROFESSIONAL_REVIEW_CONFIRMATION"] as const;
export type KnowledgeParameterEvidenceSource = (typeof KNOWLEDGE_PARAMETER_EVIDENCE_SOURCES)[number];

export interface KnowledgeParameterEvidence {
  readonly skillId: string;
  readonly fieldName: ProfessionalLearningExtractionFieldName;
  readonly parameterName: string;
  readonly via: KnowledgeParameterEvidenceSource;
}

export interface KnowledgeParameterConflict {
  readonly skillId: string;
  readonly fieldName: ProfessionalLearningExtractionFieldName;
  readonly parameterName: string;
  readonly existingAllowedValue: string | boolean | number;
  readonly proposedValue: string;
}

function matchAgainstParameter(
  skillId: string,
  fieldName: ProfessionalLearningExtractionFieldName,
  value: string,
  parameterName: string,
  allowedValues: readonly (string | boolean | number)[] | undefined,
  via: KnowledgeParameterEvidenceSource,
): { evidence: KnowledgeParameterEvidence | null; conflict: KnowledgeParameterConflict | null } {
  if (!allowedValues || allowedValues.length !== 1) return { evidence: null, conflict: null };

  const fieldNumber = extractLeadingNumber(value);
  const allowed = allowedValues[0];
  const allowedNumber = typeof allowed === "string" ? extractLeadingNumber(allowed) : typeof allowed === "number" ? allowed : null;

  const numericMatch = fieldNumber !== null && allowedNumber !== null && fieldNumber === allowedNumber;
  const exactMatch = fieldNumber === null && typeof allowed === "string" && allowed.toLowerCase() === value.toLowerCase();

  if (numericMatch || exactMatch) return { evidence: { skillId, fieldName, parameterName, via }, conflict: null };
  if (fieldNumber !== null && allowedNumber !== null) {
    // A genuine, comparable numeric value that does NOT match the skill's
    // own fixed allowed value is a real structural conflict (Section 36)
    // -- never silently ignored, never auto-resolved.
    return { evidence: null, conflict: { skillId, fieldName, parameterName, existingAllowedValue: allowed, proposedValue: value } };
  }
  return { evidence: null, conflict: null };
}

// `confirmedClaims` (Section 30/31, Stage 8.5L5.R3.1): PROFESSIONALLY_
// CONFIRMED EXTRACTION_FIELD claim bindings for this exact unit -- an
// OBSERVED/INFERRED claim Ionuț's review specifically named a theme for.
// Checked with the SAME structural matching logic as a PROFESSIONAL_INPUT
// field, but tagged `via: "PROFESSIONAL_REVIEW_CONFIRMATION"` so the two
// evidence sources are never conflated (Section 6/8).
function evaluateParameters(
  unit: ProfessionalKnowledgeUnit,
  skill: ProfessionalSkillDefinitionRecord,
  confirmedClaims: readonly BoundClaim[] = [],
): { evidence: KnowledgeParameterEvidence[]; conflicts: KnowledgeParameterConflict[] } {
  const evidence: KnowledgeParameterEvidence[] = [];
  const conflicts: KnowledgeParameterConflict[] = [];
  const parameters = skill.payload.parameters ?? [];

  for (const parameter of parameters) {
    const fieldName = parameter.name as ProfessionalLearningExtractionFieldName;

    // Only a professionally-authored field claim counts here -- an
    // OBSERVED/INFERRED claim alone is not strong enough structural
    // evidence to attach/vary/conflict a registry skill (mirrors L5.R1.1's
    // own "reflects what professional review ADDED" scope), UNLESS it was
    // specifically confirmed by Ionuț's review (checked separately below).
    const field = unit.knownFields[fieldName];
    if (field && field.source === "PROFESSIONAL_INPUT" && typeof field.value === "string") {
      const { evidence: match, conflict } = matchAgainstParameter(skill.skillId, fieldName, field.value, parameter.name, parameter.allowedValues, "PROFESSIONAL_INPUT_CORRECTION");
      if (match) evidence.push(match);
      if (conflict) conflicts.push(conflict);
    }

    const confirmedClaim = confirmedClaims.find((c) => c.claimType === "EXTRACTION_FIELD" && c.fieldName === fieldName && c.reviewConfirmation === "PROFESSIONALLY_CONFIRMED");
    if (confirmedClaim && typeof confirmedClaim.value === "string") {
      const { evidence: match, conflict } = matchAgainstParameter(skill.skillId, fieldName, confirmedClaim.value, parameter.name, parameter.allowedValues, "PROFESSIONAL_REVIEW_CONFIRMATION");
      if (match) evidence.push(match);
      if (conflict) conflicts.push(conflict);
    }
  }

  return { evidence, conflicts };
}

export interface KnowledgeCapabilityEvidence {
  readonly skillId: string;
  readonly relationshipId: string;
  readonly capabilityKind: SkillCapabilityKind;
}

function evaluateCapabilities(relationships: readonly ReferenceDependencyRelationship[], skill: ProfessionalSkillDefinitionRecord): KnowledgeCapabilityEvidence[] {
  const declaredKinds = new Set((skill.payload.capabilities ?? []).map((c) => c.kind));
  const evidence: KnowledgeCapabilityEvidence[] = [];
  for (const relationship of relationships) {
    if (!relationship.established) continue;
    const capabilityKind = RELATIONSHIP_TYPE_TO_CAPABILITY_KIND[relationship.relationshipType];
    if (!capabilityKind) continue;
    if (declaredKinds.has(capabilityKind)) evidence.push({ skillId: skill.skillId, relationshipId: relationship.id, capabilityKind });
  }
  return evidence;
}

export const KNOWLEDGE_UNIT_COMPARISON_OUTCOMES = [
  "ATTACH_EVIDENCE_TO_EXISTING",
  "PROPOSE_VARIATION_OF_EXISTING",
  "PROPOSE_EXTENSION_OF_EXISTING",
  "POSSIBLE_CONFLICT_WITH_EXISTING",
  "PROPOSE_NEW_REUSABLE_SKILL",
  "INSUFFICIENT_FOR_ASSIMILATION",
  "NON_REUSABLE_OBSERVATION",
] as const;
export type KnowledgeUnitComparisonOutcome = (typeof KNOWLEDGE_UNIT_COMPARISON_OUTCOMES)[number];

export interface KnowledgeUnitComparisonResult {
  readonly knowledgeUnitId: string;
  readonly outcome: KnowledgeUnitComparisonOutcome;
  readonly comparedSkillId: string | null;
  readonly parameterEvidence: readonly KnowledgeParameterEvidence[];
  readonly capabilityEvidence: readonly KnowledgeCapabilityEvidence[];
  readonly conflicts: readonly KnowledgeParameterConflict[];
  readonly reason: string;
}

// `unitRelationships` -- the (typically zero or one) established
// ReferenceDependencyRelationship objects this specific unit represents
// (populated only for type REFERENCE_RELATIONSHIP units; see
// professional-knowledge-decomposition.ts). EXECUTION_CAPABILITY/
// VALIDATION_RULE units pass an empty array -- this run's real evidence
// never ties a specific action group to a specific established
// relationship (Section 38: correctly INSUFFICIENT rather than invented).
export function compareKnowledgeUnitAgainstRegistry(
  unit: ProfessionalKnowledgeUnit,
  unitRelationships: readonly ReferenceDependencyRelationship[],
  registry: readonly ProfessionalSkillDefinitionRecord[],
  confirmedClaims: readonly BoundClaim[] = [],
): KnowledgeUnitComparisonResult {
  if (unit.type === "REFERENCE_RELATIONSHIP" && unitRelationships.every((r) => !r.established)) {
    return {
      knowledgeUnitId: unit.id,
      outcome: "INSUFFICIENT_FOR_ASSIMILATION",
      comparedSkillId: null,
      parameterEvidence: [],
      capabilityEvidence: [],
      conflicts: [],
      reason: "Reference-dependency candidate is not established -- professional approval of the overall extraction does not establish it (Section 20). Insufficient for assimilation.",
    };
  }

  const perSkillEvidence: { skillId: string; parameterEvidence: KnowledgeParameterEvidence[]; capabilityEvidence: KnowledgeCapabilityEvidence[]; conflicts: KnowledgeParameterConflict[] }[] = [];
  for (const skill of registry) {
    const { evidence: parameterEvidence, conflicts } = evaluateParameters(unit, skill, confirmedClaims);
    const capabilityEvidence = evaluateCapabilities(unitRelationships, skill);
    if (parameterEvidence.length > 0 || capabilityEvidence.length > 0 || conflicts.length > 0) {
      perSkillEvidence.push({ skillId: skill.skillId, parameterEvidence, capabilityEvidence, conflicts });
    }
  }

  const withConflicts = perSkillEvidence.filter((f) => f.conflicts.length > 0);
  if (withConflicts.length > 0) {
    const first = withConflicts[0];
    return {
      knowledgeUnitId: unit.id,
      outcome: "POSSIBLE_CONFLICT_WITH_EXISTING",
      comparedSkillId: first.skillId,
      parameterEvidence: first.parameterEvidence,
      capabilityEvidence: first.capabilityEvidence,
      conflicts: first.conflicts,
      reason: `A professionally-authored field value conflicts with ${first.skillId}'s own fixed declared parameter -- preserved as a conflict, never auto-resolved (Section 36).`,
    };
  }

  const withEvidence = perSkillEvidence.filter((f) => f.parameterEvidence.length > 0 || f.capabilityEvidence.length > 0);
  if (withEvidence.length === 0) {
    return {
      knowledgeUnitId: unit.id,
      outcome: "INSUFFICIENT_FOR_ASSIMILATION",
      comparedSkillId: null,
      parameterEvidence: [],
      capabilityEvidence: [],
      conflicts: [],
      reason: "No registry skill's declared fixed parameters or capabilities are supported by this unit's own professionally-authored evidence.",
    };
  }

  const evidenceCount = (f: (typeof withEvidence)[number]) => f.parameterEvidence.length + f.capabilityEvidence.length;
  const maxCount = Math.max(...withEvidence.map(evidenceCount));
  const top = withEvidence.filter((f) => evidenceCount(f) === maxCount);

  if (top.length > 1) {
    return {
      knowledgeUnitId: unit.id,
      outcome: "ATTACH_EVIDENCE_TO_EXISTING",
      comparedSkillId: null,
      parameterEvidence: top.flatMap((f) => f.parameterEvidence),
      capabilityEvidence: top.flatMap((f) => f.capabilityEvidence),
      conflicts: [],
      reason: `Evidence equally supports ${top.length} registry skills (${top.map((f) => f.skillId).join(", ")}) -- insufficient to uniquely identify one.`,
    };
  }

  const best = top[0];
  const outcome: KnowledgeUnitComparisonOutcome = best.parameterEvidence.length > 0 && best.capabilityEvidence.length > 0 ? "PROPOSE_VARIATION_OF_EXISTING" : "ATTACH_EVIDENCE_TO_EXISTING";
  return {
    knowledgeUnitId: unit.id,
    outcome,
    comparedSkillId: best.skillId,
    parameterEvidence: best.parameterEvidence,
    capabilityEvidence: best.capabilityEvidence,
    conflicts: [],
    reason:
      outcome === "PROPOSE_VARIATION_OF_EXISTING"
        ? `Unit's own evidence matches both a declared parameter and a declared capability of ${best.skillId} -- proposed as a supported variation, never a clone.`
        : `Unit's own evidence matches ${best.parameterEvidence.length > 0 ? "a declared parameter" : "a declared capability"} of ${best.skillId} -- proposed as additional attachable evidence.`,
  };
}

// Registry context hash (Section 62/63) -- deterministic sha256 over the
// registry's own stable identity fields (skillId/version/payload), sorted
// by skillId then version so byte-identical registries always hash
// identically regardless of array order.
export function computeRegistryContextHash(registry: readonly ProfessionalSkillDefinitionRecord[]): string {
  const canonical = [...registry]
    .sort((a, b) => (a.skillId === b.skillId ? a.version - b.version : a.skillId.localeCompare(b.skillId)))
    .map((s) => ({ skillId: s.skillId, version: s.version, payload: s.payload }));
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function isProposalStaleAgainstRegistry(proposalRegistryContextHash: string, currentRegistryContextHash: string): boolean {
  return proposalRegistryContextHash !== currentRegistryContextHash;
}
