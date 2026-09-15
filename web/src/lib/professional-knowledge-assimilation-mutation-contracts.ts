import { createHash } from "crypto";

import type { ContextualKnowledgeClaim } from "@/lib/professional-knowledge-review-decision";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4 --
// PROPOSED REGISTRY MUTATION SET. Pure, no I/O, no database, ZERO AI
// calls, ZERO registry writes -- and, critically, this file contains NO
// "apply" function of any kind, to any skill/execution-unit/registry
// table, anywhere. That is not an oversight -- it is this file's entire
// safety property (Section "MUTATION SET MUST BE NON-EXECUTABLE BY
// DEFAULT"): a ProposedRegistryMutation is incapable of mutating active
// registry state merely by being constructed, because no code path in
// this repository ever reads one and writes to
// professional-skill-registry-repository.ts (verified in this stage's
// own test suite by grep).
//
// activationState is a SINGLE-MEMBER literal union -- not merely a
// convention but a type-level guarantee: nothing in this file can ever
// construct a ProposedRegistryMutation whose activationState is
// anything other than "PENDING_PROFESSIONAL_APPROVAL". Promoting one to
// ACTIVE/APPROVED/APPLIED is a genuinely separate, later, explicitly-
// authorized stage's own new code, never a state this type can hold.

export const MUTATION_ACTIVATION_STATES = ["PENDING_PROFESSIONAL_APPROVAL"] as const;
export type MutationActivationState = (typeof MUTATION_ACTIVATION_STATES)[number];

export const MUTATION_OPERATION_TYPES = [
  "ATTACH_EVIDENCE",
  "EXTEND_CAPABILITY",
  "ADD_TECHNIQUE_VARIANT",
  "PROPOSE_NEW_SKILL",
  "ADD_CONTEXTUAL_KNOWLEDGE",
  "ADD_EFFECT_RELATIONSHIP",
  "ADD_WORKFLOW_STATE_TRANSITION",
  "KEEP_PENDING",
] as const;
export type MutationOperationType = (typeof MUTATION_OPERATION_TYPES)[number];

export function isMutationOperationType(value: unknown): value is MutationOperationType {
  return typeof value === "string" && (MUTATION_OPERATION_TYPES as readonly string[]).includes(value);
}

// Section "CONFLICT DETECTION" -- the task's own suggested vocabulary,
// used verbatim (no better existing project model was found for
// cross-technique conflict classification at proposal time; the closest
// existing concept, professional-learning-draft-validators.ts's
// PROFESSIONAL_LEARNING_COMPARISON_OUTCOMES, operates one layer down, on
// a single flat extraction against a single skill -- not expressive
// enough for a multi-decision, multi-technique plan).
export const MUTATION_CONFLICT_CLASSES = [
  "NONE",
  "SEMANTIC_DUPLICATE",
  "COMPATIBLE_EXTENSION",
  "PARAMETER_CONFLICT",
  "MECHANICS_CONFLICT",
  "PURPOSE_CONFLICT",
  "PROVENANCE_CONFLICT",
  "CONTEXTUAL_RULE_CONFLICT",
  "UNKNOWN_INSUFFICIENT_FOR_MUTATION",
] as const;
export type MutationConflictClass = (typeof MUTATION_CONFLICT_CLASSES)[number];

export function isMutationConflictClass(value: unknown): value is MutationConflictClass {
  return typeof value === "string" && (MUTATION_CONFLICT_CLASSES as readonly string[]).includes(value);
}

export interface ProposedFieldAddition {
  readonly name: string;
  readonly value: string;
  // Always PROFESSIONAL_INPUT -- a proposed mutation only ever exists
  // because of professional review authority (Section "PROVENANCE").
  readonly provenance: "PROFESSIONAL_INPUT";
}

export interface ProposedTechniqueIdentity {
  readonly techniqueId: string;
  readonly label: string;
  readonly familyId?: string;
  readonly relatedTechniqueIds?: readonly string[];
  readonly distinctFrom?: readonly string[];
  readonly purpose: string;
}

export interface ProposedWorkflowStateTransition {
  readonly fact: string;
  readonly fromValue: string;
  readonly toValue: string;
}

export interface ProposedRegistryMutation {
  readonly id: string;
  readonly operation: MutationOperationType;
  // An existing skillId this mutation targets, or null when the
  // operation proposes a new identity / touches no single existing skill
  // (ADD_EFFECT_RELATIONSHIP, KEEP_PENDING).
  readonly targetSkillId: string | null;
  readonly proposedIdentity: ProposedTechniqueIdentity | null;
  readonly workflowStateTransition: ProposedWorkflowStateTransition | null;
  // Which ProfessionalReviewDecision.id(s) (L5.R3.2) justify this
  // mutation -- one mutation may be supported by more than one decision
  // (e.g. #7 and #12B both support the same proposed "deep-point-cut"
  // identity; #11 and #12A both support "point-cut").
  readonly sourceDecisionIds: readonly string[];
  readonly professionalAuthority: "PROFESSIONAL_INPUT";
  readonly fieldsAdded: readonly ProposedFieldAddition[];
  readonly fieldsPreservedUnchanged: readonly string[];
  readonly unknownFieldsPreserved: readonly string[];
  readonly contextualKnowledge: readonly ContextualKnowledgeClaim[];
  readonly conflict: MutationConflictClass;
  readonly conflictDetail?: string;
  readonly activationState: MutationActivationState;
  readonly reason: string;
}

export function computeProposedRegistryMutationId(sourceEvidenceId: string, approvedResultHash: string, operation: MutationOperationType, discriminator: string): string {
  return createHash("sha256").update(`${sourceEvidenceId}|${approvedResultHash}|${operation}|${discriminator}`, "utf8").digest("hex");
}

export interface BuildProposedRegistryMutationInput {
  readonly sourceEvidenceId: string;
  readonly approvedResultHash: string;
  readonly operation: MutationOperationType;
  readonly discriminator: string;
  readonly targetSkillId?: string | null;
  readonly proposedIdentity?: ProposedTechniqueIdentity | null;
  readonly workflowStateTransition?: ProposedWorkflowStateTransition | null;
  readonly sourceDecisionIds: readonly string[];
  readonly fieldsAdded?: readonly ProposedFieldAddition[];
  readonly fieldsPreservedUnchanged?: readonly string[];
  readonly unknownFieldsPreserved?: readonly string[];
  readonly contextualKnowledge?: readonly ContextualKnowledgeClaim[];
  readonly conflict?: MutationConflictClass;
  readonly conflictDetail?: string;
  readonly reason: string;
}

// The ONLY constructor. Note there is no `activationState` parameter --
// it is always, unconditionally, "PENDING_PROFESSIONAL_APPROVAL" (Section
// "HARD APPROVAL GATE"). A caller cannot pass a different value even by
// mistake.
export function buildProposedRegistryMutation(input: BuildProposedRegistryMutationInput): ProposedRegistryMutation {
  if (input.sourceDecisionIds.length === 0) throw new Error("A proposed mutation must be justified by at least one professional review decision.");
  return {
    id: computeProposedRegistryMutationId(input.sourceEvidenceId, input.approvedResultHash, input.operation, input.discriminator),
    operation: input.operation,
    targetSkillId: input.targetSkillId ?? null,
    proposedIdentity: input.proposedIdentity ?? null,
    workflowStateTransition: input.workflowStateTransition ?? null,
    sourceDecisionIds: input.sourceDecisionIds,
    professionalAuthority: "PROFESSIONAL_INPUT",
    fieldsAdded: input.fieldsAdded ?? [],
    fieldsPreservedUnchanged: input.fieldsPreservedUnchanged ?? [],
    unknownFieldsPreserved: input.unknownFieldsPreserved ?? [],
    contextualKnowledge: input.contextualKnowledge ?? [],
    conflict: input.conflict ?? "NONE",
    ...(input.conflictDetail !== undefined ? { conflictDetail: input.conflictDetail } : {}),
    activationState: "PENDING_PROFESSIONAL_APPROVAL",
    reason: input.reason,
  };
}
