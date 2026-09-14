import type { ApprovedKnowledgeSource } from "@/lib/professional-knowledge-approved-source";
import { computeKnowledgeUnitId, type KnowledgeUnitType, type ProfessionalKnowledgeUnit } from "@/lib/professional-knowledge-unit";
import { isWithinCoreInterval, type AnalysisWindow } from "@/lib/professional-learning-video-long-window-planner";
import type { ActionTransitionState, ProceduralCandidateActionEntry } from "@/lib/professional-learning-video-procedural-candidate";
import type { ReconciledEditGap } from "@/lib/professional-learning-video-cross-window-reconciliation";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3 -- COMPOUND
// PROCEDURE DECOMPOSITION. Pure, no I/O, no database, ZERO AI calls.
//
// OBSERVATION != REUSABLE KNOWLEDGE (Section 17): every raw action
// candidate is first classified for RELEVANCE via ONE small, declarative,
// domain-general table (ACTION_KIND_RELEVANCE below) -- mirrors the
// established "small declarative table, never a lexical rule farm"
// discipline already used by professional-learning-reviewed-comparison.ts's
// own RELATIONSHIP_TYPE_TO_CAPABILITY_KIND. An action `kind` this table
// does not recognize fails CLOSED to NON_REUSABLE_OBSERVATION -- relevance
// is never assumed by default.
//
// DO NOT OVER-SPLIT / DO NOT UNDER-SPLIT (Section 15/16): relevant actions
// are grouped by (kind, source window) -- the ONE clean, non-invented
// distinguishing boundary this pipeline actually has evidence for (each
// AnalysisWindow's own core interval is contiguous and independently
// call-planned; L5.R2's real result independently produced a DIFFERENT
// technique description per window, confirming windows really do
// correspond to distinct procedure phases). This groups 13 repeated
// CUTTING_ACTION instances within one window into ONE candidate unit
// (never 13), while keeping genuinely different windows/phases distinct
// (never one giant unit) -- without ever inventing a finer-grained
// technique taxonomy from free text, which would risk exactly the
// keyword-rule-farm problem this engagement has repeatedly forbidden.

const ACTION_KIND_RELEVANCE: Partial<Record<string, "EXECUTION_CAPABILITY" | "VALIDATION_RULE">> = {
  CUTTING_ACTION: "EXECUTION_CAPABILITY",
  STYLING_ACTION: "EXECUTION_CAPABILITY",
  INSPECTION: "VALIDATION_RULE",
  // COMBING and REPOSITIONING are deliberately absent -- generic
  // preparatory/movement actions with no declared professional relevance
  // signal. An unrecognized kind falls through the same way (Section 17:
  // "stylist turns toward camera" style observations stay
  // NON_REUSABLE_OBSERVATION).
};

export interface NonReusableObservationRecord {
  readonly actionCandidateId: string;
  readonly kind: string;
  readonly reason: string;
}

function windowIndexForStart(timeStartSeconds: number, windows: readonly AnalysisWindow[]): number | null {
  const owning = windows.find((w) => isWithinCoreInterval(timeStartSeconds, w));
  return owning ? owning.index : null;
}

interface ExecutionGroupKey {
  readonly relevance: "EXECUTION_CAPABILITY" | "VALIDATION_RULE";
  readonly kind: string;
  readonly windowIndex: number;
}

function groupKeyString(key: ExecutionGroupKey): string {
  return `${key.relevance}|${key.kind}|window-${key.windowIndex}`;
}

export interface ProcedureSequenceEntry {
  readonly knowledgeUnitId: string;
  readonly precedingTransition: ActionTransitionState;
}

export interface ProcedureKnowledgeDecomposition {
  readonly approvedSourceEvidenceId: string;
  readonly reviewId: string;
  readonly approvedResultHash: string;
  readonly assimilationVersion: string;
  readonly knowledgeUnits: readonly ProfessionalKnowledgeUnit[];
  readonly nonReusableObservations: readonly NonReusableObservationRecord[];
  // Section 39-41: ordering reflects what happened IN THIS PROCEDURE ONLY.
  // It is NEVER a universal execution-order rule, and temporal order is
  // NEVER read as causality -- see the doc comment on
  // ProcedureKnowledgeDecomposition.procedureSpecificSequence's own type.
  readonly procedureSpecificSequence: readonly ProcedureSequenceEntry[];
  readonly knownGaps: readonly ReconciledEditGap[];
}

export function decomposeApprovedSource(source: ApprovedKnowledgeSource, assimilationVersion: string): ProcedureKnowledgeDecomposition {
  const nonReusableObservations: NonReusableObservationRecord[] = [];
  const groups = new Map<string, { key: ExecutionGroupKey; entries: ProceduralCandidateActionEntry[] }>();

  for (const entry of source.proceduralCandidate.orderedActions) {
    const relevance = ACTION_KIND_RELEVANCE[entry.action.kind];
    if (!relevance) {
      nonReusableObservations.push({
        actionCandidateId: entry.action.id,
        kind: entry.action.kind,
        reason: `Action kind "${entry.action.kind}" carries no declared professional-relevance signal (relevance gate, Section 17) -- treated as a non-reusable observation, never assimilated.`,
      });
      continue;
    }
    const windowIndex = windowIndexForStart(entry.absoluteInterval.timeStartSeconds, source.windows);
    if (windowIndex === null) {
      // Fails closed: an action whose start time cannot be attributed to
      // any known window's own core interval is never silently assimilated.
      nonReusableObservations.push({
        actionCandidateId: entry.action.id,
        kind: entry.action.kind,
        reason: "Action start time could not be attributed to any known analysis window's core interval -- excluded from assimilation.",
      });
      continue;
    }
    const key: ExecutionGroupKey = { relevance, kind: entry.action.kind, windowIndex };
    const groupId = groupKeyString(key);
    const existing = groups.get(groupId);
    if (existing) existing.entries.push(entry);
    else groups.set(groupId, { key, entries: [entry] });
  }

  const knowledgeUnits: ProfessionalKnowledgeUnit[] = [];
  const unitIdByFirstEntry = new Map<string, string>();

  for (const [discriminator, group] of groups) {
    const type: KnowledgeUnitType = group.key.relevance;
    const id = computeKnowledgeUnitId(source.sourceEvidenceId, source.reviewId, source.approvedResultHash, type, discriminator, assimilationVersion);
    const window = source.windows.find((w) => w.index === group.key.windowIndex);
    const raw = window ? source.rawResultsByWindowId.get(window.id) : undefined;
    const contextLabel = raw?.extraction.techniqueCandidate?.value;

    knowledgeUnits.push({
      id,
      type,
      sourceEvidenceId: source.sourceEvidenceId,
      reviewId: source.reviewId,
      approvedResultHash: source.approvedResultHash,
      assimilationVersion,
      domain: "hair_cutting",
      label: `${group.key.kind} pattern observed in window ${group.key.windowIndex}`,
      sourceIntervals: group.entries.map((e) => ({ timeStartSeconds: e.absoluteInterval.timeStartSeconds, timeEndSeconds: e.absoluteInterval.timeEndSeconds })),
      supportingActionCandidateIds: group.entries.map((e) => e.action.id),
      occurrenceCount: group.entries.length,
      knownFields: {},
      referenceRelationshipIds: [],
      evidenceSupport: group.entries.length > 1 ? "PARTIALLY_SUPPORTED" : "UNKNOWN",
      note: typeof contextLabel === "string" ? `Descriptive context only (never authoritative, Section 32): "${contextLabel}"` : undefined,
    });

    for (const entry of group.entries) unitIdByFirstEntry.set(entry.action.id, id);
  }

  // Reference dependency candidates (Section 20-21): one knowledge unit
  // per candidate, REGARDLESS of established/unestablished -- but an
  // unestablished relationship NEVER becomes SUPPORTED merely because the
  // overall extraction was professionally approved. established stays
  // exactly what it already was.
  for (const relationship of source.reconciliation.referenceDependencyCandidates) {
    const discriminator = relationship.id;
    const id = computeKnowledgeUnitId(source.sourceEvidenceId, source.reviewId, source.approvedResultHash, "REFERENCE_RELATIONSHIP", discriminator, assimilationVersion);
    const evidenceSupport = relationship.established ? "SUPPORTED" : relationship.provenance === "UNKNOWN" ? "UNKNOWN" : "INSUFFICIENT";
    knowledgeUnits.push({
      id,
      type: "REFERENCE_RELATIONSHIP",
      sourceEvidenceId: source.sourceEvidenceId,
      reviewId: source.reviewId,
      approvedResultHash: source.approvedResultHash,
      assimilationVersion,
      domain: "hair_cutting",
      label: `${relationship.relationshipType} candidate (${relationship.sourceEntity.kind} -> ${relationship.targetEntity.kind})`,
      sourceIntervals: relationship.evidenceInterval ? [{ timeStartSeconds: relationship.evidenceInterval.timeStartSeconds, timeEndSeconds: relationship.evidenceInterval.timeEndSeconds }] : [],
      supportingActionCandidateIds: [],
      occurrenceCount: 1,
      knownFields: {},
      referenceRelationshipIds: [relationship.id],
      evidenceSupport,
      note: `established=${relationship.established}, provenance=${relationship.provenance} -- professional approval of the overall extraction does NOT by itself establish this relationship (Section 20).`,
    });
  }

  // Procedure-specific sequence orders KNOWLEDGE UNITS (not raw actions)
  // by each unit's first supporting action's own preceding-transition
  // state. A unit contributed to by multiple actions inherits the
  // transition of whichever action first introduced it (deterministic:
  // orderedActions is itself time-sorted).
  const seenUnitIds = new Set<string>();
  const procedureSpecificSequence: ProcedureSequenceEntry[] = [];
  for (const entry of source.proceduralCandidate.orderedActions) {
    const unitId = unitIdByFirstEntry.get(entry.action.id);
    if (!unitId || seenUnitIds.has(unitId)) continue;
    seenUnitIds.add(unitId);
    procedureSpecificSequence.push({ knowledgeUnitId: unitId, precedingTransition: entry.precedingTransition });
  }

  return {
    approvedSourceEvidenceId: source.sourceEvidenceId,
    reviewId: source.reviewId,
    approvedResultHash: source.approvedResultHash,
    assimilationVersion,
    knowledgeUnits,
    nonReusableObservations,
    procedureSpecificSequence,
    knownGaps: source.reconciliation.editGaps,
  };
}
