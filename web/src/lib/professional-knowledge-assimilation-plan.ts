import { createHash } from "crypto";

import {
  buildProposedRegistryMutation,
  type MutationConflictClass,
  type ProposedRegistryMutation,
  type ProposedTechniqueIdentity,
  type ProposedWorkflowStateTransition,
} from "@/lib/professional-knowledge-assimilation-mutation-contracts";
import type { ProfessionalDecisionAssimilationOutcome } from "@/lib/professional-knowledge-review-decision";
import type { ProfessionalReviewDecision } from "@/lib/professional-knowledge-review-decision";
import type { GuideRelationshipCapability } from "@/lib/professional-skill-guide-relationship-contracts";
import type { CompareGuideRelationshipResult } from "@/lib/professional-skill-guide-relationship-execution-unit-comparison";
import { computeRegistryContextHash } from "@/lib/professional-knowledge-registry-comparison";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4 --
// PROFESSIONAL KNOWLEDGE ASSIMILATION PLAN + APPROVAL GATE. Pure, no
// I/O, no database, ZERO AI calls, ZERO registry writes.
//
// Combines the FOUR already-built layers (L5.R2 frozen evidence,
// L5.R3.1 claim binding, L5.R3.2 professional decision classification,
// L5.R3.3 guide relationship comparison) into ONE deterministic plan
// PLUS its proposed registry mutation set. This file never re-classifies
// anything itself -- it only ORGANIZES already-computed classification
// results into a human-inspectable plan. Status is always DRAFT_
// PENDING_PROFESSIONAL_APPROVAL (mirrors L5.R3's own
// ProfessionalKnowledgeAssimilationProposal status discipline exactly).

export const ASSIMILATION_PLAN_STATUSES = ["DRAFT_PENDING_PROFESSIONAL_APPROVAL"] as const;
export type AssimilationPlanStatus = (typeof ASSIMILATION_PLAN_STATUSES)[number];

// ---------------------------------------------------------------------
// Guide-relationship items (#2/#4/#9/#10) -- Section "GUIDE KNOWLEDGE
// FROM L5.R3.3": SEMANTIC REPRESENTATION SUFFICIENT is never the same
// claim as SAFE REGISTRY ATTACHMENT. The threshold below is the ONE
// deterministic rule this file uses to decide which is which: evidence
// is attachable ONLY when the comparison confirmed BOTH `source` AND
// `behavior` against a real execution unit -- the two dimensions that
// together identify "what this guide actually is and how it acts."
// `role` alone, or `behavior` alone (Section 4's real case), is
// deliberately insufficient -- matches the task's own explicit
// instruction not to force #4's attachment merely because ONE dimension
// happens to coincide.
// ---------------------------------------------------------------------

function isGuideEvidenceAttachable(comparison: CompareGuideRelationshipResult): boolean {
  return comparison.matches.some((m) => m.matchedDimensions.includes("source") && m.matchedDimensions.includes("behavior"));
}

export interface GuideReplayInput {
  readonly reviewItemLabel: string;
  readonly decision: ProfessionalReviewDecision;
  readonly capability: GuideRelationshipCapability;
  readonly comparison: CompareGuideRelationshipResult;
}

function buildGuideMutations(sourceEvidenceId: string, approvedResultHash: string, inputs: readonly GuideReplayInput[]): readonly ProposedRegistryMutation[] {
  const mutations: ProposedRegistryMutation[] = [];
  for (const input of inputs) {
    if (isGuideEvidenceAttachable(input.comparison)) {
      // One mutation PER distinct matched skill -- deduplicated, never
      // one mutation silently picking a single "winner" skill when
      // several are equally, genuinely compatible (Section 2's own real
      // finding: #2 is compatible with BOTH Graduated Cutting AND
      // One-Length Perimeter, evidence the relationship is reusable).
      const skillIds = [...new Set(input.comparison.matches.filter((m) => m.matchedDimensions.includes("source") && m.matchedDimensions.includes("behavior")).map((m) => m.skillId))];
      for (const skillId of skillIds) {
        mutations.push(
          buildProposedRegistryMutation({
            sourceEvidenceId,
            approvedResultHash,
            operation: "ATTACH_EVIDENCE",
            discriminator: `guide|${input.reviewItemLabel}|${skillId}`,
            targetSkillId: skillId,
            sourceDecisionIds: [input.decision.id],
            fieldsAdded: [{ name: "guideRelationshipEvidence", value: input.capability.id, provenance: "PROFESSIONAL_INPUT" }],
            fieldsPreservedUnchanged: ["guideType", "guideReferenceMode", "guideIdentifiabilityCriterion"],
            unknownFieldsPreserved: [...input.decision.unknownFields],
            conflict: "COMPATIBLE_EXTENSION",
            reason: `Professionally confirmed guide relationship (${input.reviewItemLabel}) matches ${skillId}'s own already-declared fixed guide parameters on source AND behavior -- genuine additional evidence for existing knowledge, not a structural change.`,
          }),
        );
      }
    } else {
      mutations.push(
        buildProposedRegistryMutation({
          sourceEvidenceId,
          approvedResultHash,
          operation: "KEEP_PENDING",
          discriminator: `guide|${input.reviewItemLabel}`,
          targetSkillId: null,
          sourceDecisionIds: [input.decision.id],
          unknownFieldsPreserved: [...input.decision.unknownFields],
          conflict: "UNKNOWN_INSUFFICIENT_FOR_MUTATION",
          conflictDetail: input.comparison.matches.length > 0 ? `Only a partial match exists (${input.comparison.matches[0].matchedDimensions.join("+")}) -- source and behavior are not BOTH confirmed, so attachment would overstate the evidence.` : "No existing execution unit's own fixed guide parameters are compatible with this capability yet.",
          reason: `Professionally confirmed guide relationship (${input.reviewItemLabel}) is semantically well-formed (per L5.R3.3) but not yet safely attachable to one existing execution unit -- retained as structured, reviewable professional knowledge pending a future safe registry target, never forced.`,
        }),
      );
    }
  }
  return mutations;
}

// ---------------------------------------------------------------------
// Technique items (#7/#11/#12A/#12B/#13) -- decisions sharing the SAME
// technique.techniqueId are GROUPED into ONE proposed mutation (Section
// "ITEM #12": #7 and #12B both support "deep-point-cut"; #11 and #12A
// both support "point-cut" -- never two competing proposals for what is
// professionally the same reusable technique).
// ---------------------------------------------------------------------

export interface TechniqueDecisionInput {
  readonly decision: ProfessionalReviewDecision;
  readonly outcome: ProfessionalDecisionAssimilationOutcome;
  readonly purpose: string;
}

function buildTechniqueMutations(sourceEvidenceId: string, approvedResultHash: string, inputs: readonly TechniqueDecisionInput[]): readonly ProposedRegistryMutation[] {
  const groups = new Map<string, TechniqueDecisionInput[]>();
  for (const input of inputs) {
    const techniqueId = input.decision.technique?.techniqueId;
    if (!techniqueId) continue;
    if (!(input.outcome === "PROPOSE_NEW_SKILL" || input.outcome === "PROPOSE_TECHNIQUE_VARIANT" || input.outcome === "PROFESSIONAL_ADDITION_PENDING_REVIEW")) continue;
    const existing = groups.get(techniqueId);
    if (existing) existing.push(input);
    else groups.set(techniqueId, [input]);
  }

  const mutations: ProposedRegistryMutation[] = [];
  for (const [techniqueId, group] of groups) {
    const first = group[0];
    const technique = first.decision.technique!;
    const identity: ProposedTechniqueIdentity = {
      techniqueId,
      label: technique.label,
      ...(technique.familyId !== undefined ? { familyId: technique.familyId } : {}),
      ...(technique.relatedTechniqueIds !== undefined ? { relatedTechniqueIds: technique.relatedTechniqueIds } : {}),
      ...(technique.distinctFrom !== undefined ? { distinctFrom: technique.distinctFrom } : {}),
      purpose: first.purpose,
    };
    const isPureAddition = group.every((g) => g.decision.decisionType === "ADDITION");
    mutations.push(
      buildProposedRegistryMutation({
        sourceEvidenceId,
        approvedResultHash,
        operation: "PROPOSE_NEW_SKILL",
        discriminator: `technique|${techniqueId}`,
        targetSkillId: null,
        proposedIdentity: identity,
        sourceDecisionIds: group.map((g) => g.decision.id),
        fieldsAdded: group.flatMap((g) => g.decision.knownFields.map((f) => ({ name: f, value: g.decision.professionalValue, provenance: "PROFESSIONAL_INPUT" as const }))),
        unknownFieldsPreserved: [...new Set(group.flatMap((g) => g.decision.unknownFields))],
        contextualKnowledge: group.flatMap((g) => g.decision.contextualKnowledge),
        conflict: "NONE",
        reason: isPureAddition
          ? `Professional addition (${group.map((g) => g.decision.reviewItemLabel).join(", ")}) -- the AI extraction never claimed this technique at all. Proposed as new reusable knowledge, requiring the highest bar of explicit approval before any activation.`
          : `Professionally corrected/confirmed technique (${group.map((g) => g.decision.reviewItemLabel).join(", ")}), materially distinct from every existing registry skill's own fixed parameters (see distinctFrom) -- proposed as a new reusable technique, never merged into an incompatible existing one.`,
      }),
    );
  }
  return mutations;
}

// ---------------------------------------------------------------------
// Workflow / directional items (#6a/#6b) -- Section "ITEM #6": #6a
// (forward+outward direction) has no existing parameter that can hold
// DIRECTION (every registry skill's own `overdirection` parameter is a
// bare boolean) -- an honest architecture gap, KEEP_PENDING. #6b
// (wet->dry) is genuinely new, additive WORKFLOW knowledge, represented
// via the SAME AtomicActionStateTransition-shaped fact/fromValue/toValue
// triple this lineage already reuses elsewhere (L5.R3.3's own
// deriveGuideStateTransition) -- never invented as a new shape.
// ---------------------------------------------------------------------

function buildDirectionGapMutation(sourceEvidenceId: string, approvedResultHash: string, decision: ProfessionalReviewDecision): ProposedRegistryMutation {
  return buildProposedRegistryMutation({
    sourceEvidenceId,
    approvedResultHash,
    operation: "KEEP_PENDING",
    discriminator: `workflow|${decision.reviewItemLabel}`,
    targetSkillId: null,
    sourceDecisionIds: [decision.id],
    unknownFieldsPreserved: [...decision.unknownFields],
    conflict: "UNKNOWN_INSUFFICIENT_FOR_MUTATION",
    conflictDetail: "Every existing registry skill's own `overdirection` parameter is a bare boolean (present/absent) -- none can hold a qualitative DIRECTION value. Attaching 'forward and outward' would require a new parameter shape on an existing skill, which this stage does not propose without explicit architectural authorization.",
    reason: "Professionally confirmed direction (forward and outward) is real, qualitative knowledge, but the current Skill Engine has no field shaped to hold it -- retained pending a future, separately-authorized parameter-shape decision, never forced into the existing boolean.",
  });
}

function buildWorkflowTransitionMutation(sourceEvidenceId: string, approvedResultHash: string, decision: ProfessionalReviewDecision, transition: ProposedWorkflowStateTransition): ProposedRegistryMutation {
  return buildProposedRegistryMutation({
    sourceEvidenceId,
    approvedResultHash,
    operation: "ADD_WORKFLOW_STATE_TRANSITION",
    discriminator: `workflow|${decision.reviewItemLabel}`,
    targetSkillId: null,
    workflowStateTransition: transition,
    sourceDecisionIds: [decision.id],
    unknownFieldsPreserved: [...decision.unknownFields],
    conflict: "NONE",
    reason: "Professionally confirmed workflow transition (wet structural work -> dry refinement/check/finishing) -- represented as workflow/state-transition knowledge, never as a cutting technique in its own right.",
  });
}

// ---------------------------------------------------------------------
// Effect relationship (Section "EFFECT-BASED KNOWLEDGE GRAPH") -- a
// single, additive, plan-level annotation linking technique identities
// (proposed and/or existing) to a shared qualitative target effect.
// Deliberately NOT a new SkillCapabilityKind (that vocabulary is
// registry-authoritative; this is a proposal-only annotation) and
// deliberately never implies interchangeability -- see contractsFile
// header. Only constructed when at least 2 technique identities are
// named, since a single-technique "relationship" is not a relationship.
// ---------------------------------------------------------------------

function buildEffectRelationshipMutation(sourceEvidenceId: string, approvedResultHash: string, sourceDecisionIds: readonly string[], targetEffect: string, relatedTechniqueIds: readonly string[]): ProposedRegistryMutation | null {
  if (relatedTechniqueIds.length < 2) return null;
  return buildProposedRegistryMutation({
    sourceEvidenceId,
    approvedResultHash,
    operation: "ADD_EFFECT_RELATIONSHIP",
    discriminator: `effect|${targetEffect}`,
    targetSkillId: null,
    sourceDecisionIds,
    fieldsAdded: relatedTechniqueIds.map((id) => ({ name: "relatedTechniqueId", value: id, provenance: "PROFESSIONAL_INPUT" as const })),
    conflict: "NONE",
    reason: `${relatedTechniqueIds.join(", ")} may each independently contribute to the target effect "${targetEffect}" -- a plan-level annotation only, never implying they are interchangeable or that one is an alias of another.`,
  });
}

// ---------------------------------------------------------------------
// The plan itself.
// ---------------------------------------------------------------------

export interface AssimilationPlanEntry {
  readonly reviewItemLabel: string;
  readonly professionalKnowledgeSummary: string;
  readonly originalAIClaim: { readonly value: unknown; readonly provenance: string } | null;
  readonly knownFields: readonly string[];
  readonly unknownFields: readonly string[];
  readonly registryCandidates: readonly string[];
  readonly conflicts: readonly MutationConflictClass[];
  readonly proposedMutationIds: readonly string[];
  readonly safeToApplyLater: "YES" | "NO" | "PARTIAL";
  readonly reason: string;
}

export interface ProfessionalKnowledgeAssimilationPlan {
  readonly id: string;
  readonly status: AssimilationPlanStatus;
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly registryContextHash: string;
  readonly planVersion: string;
  readonly entries: readonly AssimilationPlanEntry[];
  readonly mutationSet: readonly ProposedRegistryMutation[];
  readonly canonicalHash: string;
}

export interface BuildAssimilationPlanInput {
  readonly sourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly planVersion: string;
  readonly registry: readonly ProfessionalSkillDefinitionRecord[];
  readonly guideInputs: readonly GuideReplayInput[];
  readonly techniqueInputs: readonly TechniqueDecisionInput[];
  readonly directionGapDecision: ProfessionalReviewDecision;
  readonly workflowDecision: ProfessionalReviewDecision;
  readonly workflowTransition: ProposedWorkflowStateTransition;
  readonly effectTargetEffect: string;
  readonly effectRelatedTechniqueIds: readonly string[];
}

function entryFromDecision(decision: ProfessionalReviewDecision, mutations: readonly ProposedRegistryMutation[]): AssimilationPlanEntry {
  const own = mutations.filter((m) => m.sourceDecisionIds.includes(decision.id));
  const safeToApplyLater: "YES" | "NO" | "PARTIAL" = own.length === 0 ? "NO" : own.every((m) => m.operation === "ATTACH_EVIDENCE" || m.operation === "ADD_WORKFLOW_STATE_TRANSITION" || m.operation === "ADD_EFFECT_RELATIONSHIP") ? "YES" : own.every((m) => m.operation === "KEEP_PENDING") ? "NO" : "PARTIAL";
  return {
    reviewItemLabel: decision.reviewItemLabel,
    professionalKnowledgeSummary: decision.professionalValue,
    originalAIClaim: decision.originalAIClaim,
    knownFields: decision.knownFields,
    unknownFields: decision.unknownFields,
    registryCandidates: [...new Set(own.map((m) => m.targetSkillId).filter((id): id is string => id !== null))],
    conflicts: own.map((m) => m.conflict),
    proposedMutationIds: own.map((m) => m.id),
    safeToApplyLater,
    reason: own[0]?.reason ?? "No proposed mutation was generated for this decision.",
  };
}

export function buildProfessionalKnowledgeAssimilationPlan(input: BuildAssimilationPlanInput): ProfessionalKnowledgeAssimilationPlan {
  const guideMutations = buildGuideMutations(input.sourceEvidenceId, input.approvedResultHash, input.guideInputs);
  const techniqueMutations = buildTechniqueMutations(input.sourceEvidenceId, input.approvedResultHash, input.techniqueInputs);
  const directionMutation = buildDirectionGapMutation(input.sourceEvidenceId, input.approvedResultHash, input.directionGapDecision);
  const workflowMutation = buildWorkflowTransitionMutation(input.sourceEvidenceId, input.approvedResultHash, input.workflowDecision, input.workflowTransition);
  const effectMutation = buildEffectRelationshipMutation(input.sourceEvidenceId, input.approvedResultHash, input.techniqueInputs.map((t) => t.decision.id), input.effectTargetEffect, input.effectRelatedTechniqueIds);

  const mutationSet: ProposedRegistryMutation[] = [...guideMutations, ...techniqueMutations, directionMutation, workflowMutation, ...(effectMutation ? [effectMutation] : [])];

  const allDecisions = [...input.guideInputs.map((g) => g.decision), ...input.techniqueInputs.map((t) => t.decision), input.directionGapDecision, input.workflowDecision];
  const uniqueDecisions = [...new Map(allDecisions.map((d) => [d.id, d])).values()];
  const entries = uniqueDecisions.map((d) => entryFromDecision(d, mutationSet));

  const registryContextHash = computeRegistryContextHash(input.registry);

  const withoutHash: Omit<ProfessionalKnowledgeAssimilationPlan, "canonicalHash"> = {
    id: createHash("sha256").update(`${input.sourceEvidenceId}|${input.reviewId}|${input.approvedResultHash}|${input.planVersion}`, "utf8").digest("hex"),
    status: "DRAFT_PENDING_PROFESSIONAL_APPROVAL",
    sourceEvidenceId: input.sourceEvidenceId,
    reviewId: input.reviewId,
    approvedResultHash: input.approvedResultHash,
    registryContextHash,
    planVersion: input.planVersion,
    entries,
    mutationSet,
  };
  const canonicalHash = createHash("sha256").update(JSON.stringify(withoutHash), "utf8").digest("hex");
  return { ...withoutHash, canonicalHash };
}
