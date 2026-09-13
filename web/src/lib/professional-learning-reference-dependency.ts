import { createHash } from "crypto";

import { isProfessionalLearningProvenanceSource, type ProfessionalLearningProvenanceSource } from "@/lib/professional-learning-draft-validators";
import { isValidVideoTimeInterval, type VideoTimeInterval } from "@/lib/professional-learning-video-temporal";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1.1 --
// PROFESSIONAL GUIDE RELATIONSHIP / REFERENCE DEPENDENCY. Pure, no I/O,
// no database, zero real AI calls, DOMAIN-GENERAL (not hair-cutting-
// specific, not video-specific -- reusable for color, nails, make-up, and
// text/image evidence exactly as well as video).
//
// THE GAP THIS FILE CLOSES: L5's temporal reasoning (professional-
// learning-video-temporal-reasoning.ts) can order events and compute
// repetition/progression/completion/effect, but has no way to represent
// that one professional action/material state is executed RELATIVE TO
// another -- e.g. "this strand is cut to that guide." Stage 8.5L5.R1's
// own real blind extraction correctly left this UNKNOWN (no guide/
// reference field exists in the 32-field extraction vocabulary at all),
// and Ionuț's post-hoc professional review supplied exactly this missing
// relationship as PROFESSIONAL_INPUT. This file is the smallest generic
// place to represent it, so future evidence (real or professionally
// annotated) can carry the same shape without inventing a haircut-
// specific field each time.
//
// THE CORE DISTINCTION THIS FILE EXISTS TO ENFORCE:
//   "I SAW ENTITY A BEFORE ENTITY B" (temporal order, professional-
//   learning-video-temporal.ts's own job)
//   is NOT
//   "ENTITY B IS EXECUTED RELATIVE TO ENTITY A" (professional semantics,
//   this file's job).
// REFERENCE != GUIDE AUTOMATICALLY: a visible previous strand, two
// temporally adjacent cuts, or a matching visible length NEVER
// automatically establish a reference relationship. A relationship is
// "established" (isReferenceDependencyEstablished below) ONLY when it
// carries PROFESSIONAL_INPUT authority, or OBSERVED/INFERRED evidence
// with genuine, CALLER-SUPPLIED semantic support -- exactly like R2.2's
// own isClaimSemanticallyBound, this file never derives semantic support
// from raw text itself (that would risk becoming a second lexical rule
// farm); the caller (a future bound extractor proposal, or a
// professional annotation) supplies it.
//
// SOURCE SUPPORT vs SEMANTIC SUPPORT vs PROFESSIONAL AUTHORITY (Section
// 24) are kept as three genuinely separate, independently-inspectable
// booleans on every built relationship -- never collapsed into one
// "confidence" number and never a single hasGuide=true boolean (Section
// 14's own explicit prohibition).

// ---------------------------------------------------------------------
// Relationship type vocabulary (Section 7)
// ---------------------------------------------------------------------

export const REFERENCE_DEPENDENCY_RELATIONSHIP_TYPES = [
  "ESTABLISHES_REFERENCE",
  "USES_REFERENCE",
  "ALIGNS_TO_REFERENCE",
  "CUTS_TO_REFERENCE",
  "CONTINUES_REFERENCE",
  "REPLACES_REFERENCE",
  "REFERENCE_ROLE_UNKNOWN",
] as const;
export type ReferenceDependencyRelationshipType = (typeof REFERENCE_DEPENDENCY_RELATIONSHIP_TYPES)[number];

export function isReferenceDependencyRelationshipType(value: unknown): value is ReferenceDependencyRelationshipType {
  return typeof value === "string" && (REFERENCE_DEPENDENCY_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

// Section 10: STRUCTURAL AUTHORITY (the contour/final-length/perimeter
// that defines the intended structure) vs. CONTINUATION GUIDE (a
// previously produced entity used only to continue that structure) are
// related but NOT identical -- kept as a distinct, optional axis on a
// relationship's SOURCE entity, never collapsed into the relationship
// type itself (the same relationship TYPE, e.g. CUTS_TO_REFERENCE, can
// point at either kind of reference).
export const REFERENCE_ROLE_KINDS = ["STRUCTURAL_AUTHORITY", "CONTINUATION_GUIDE", "UNKNOWN"] as const;
export type ReferenceRoleKind = (typeof REFERENCE_ROLE_KINDS)[number];

export function isReferenceRoleKind(value: unknown): value is ReferenceRoleKind {
  return typeof value === "string" && (REFERENCE_ROLE_KINDS as readonly string[]).includes(value);
}

// Generic entity addressing -- deliberately NOT typed to any one
// evidence family's own id space (not "must be a VideoLearningSegment
// id"). A relationship can point at an L5 TemporalObservation/
// ActionCandidate id, a specific extraction FIELD_CLAIM, or a
// PROFESSIONAL_STATEMENT the professional's own review introduces that
// was never detected by any extractor at all -- exactly what happened in
// this stage's own real case (Ionuț's "guide strand"/"next strand"
// narrative has no corresponding id in L5.R1's own blind action
// candidates, and forcing one would itself be an invented
// correspondence the evidence does not establish).
export const REFERENCE_ENTITY_KINDS = ["OBSERVATION", "ACTION", "FIELD_CLAIM", "PROFESSIONAL_STATEMENT", "UNSPECIFIED"] as const;
export type ReferenceEntityKind = (typeof REFERENCE_ENTITY_KINDS)[number];

export function isReferenceEntityKind(value: unknown): value is ReferenceEntityKind {
  return typeof value === "string" && (REFERENCE_ENTITY_KINDS as readonly string[]).includes(value);
}

export interface ReferenceEntityRef {
  readonly ref: string;
  readonly kind: ReferenceEntityKind;
  readonly label?: string;
}

export function isValidReferenceEntityRef(value: unknown): value is ReferenceEntityRef {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.ref !== "string" || record.ref.length === 0) return false;
  if (!isReferenceEntityKind(record.kind)) return false;
  if (record.label !== undefined && typeof record.label !== "string") return false;
  return true;
}

// ---------------------------------------------------------------------
// Relationship (Section 7/8/24)
// ---------------------------------------------------------------------

export interface ReferenceDependencyRelationshipInput {
  readonly sourceEntity: ReferenceEntityRef;
  readonly targetEntity: ReferenceEntityRef;
  readonly relationshipType: ReferenceDependencyRelationshipType;
  readonly provenance: ProfessionalLearningProvenanceSource;
  // Section 10 -- the ROLE the source entity plays as a reference for
  // this specific relationship. Optional: most relationships do not need
  // to take a position on this axis.
  readonly referenceRole?: ReferenceRoleKind;
  // Caller-supplied only (Section 6/60-style discipline carried over from
  // R2.2/L5) -- this file never derives it from raw text. Irrelevant/
  // ignored when provenance is PROFESSIONAL_INPUT or UNKNOWN (see
  // isReferenceDependencyEstablished).
  readonly semanticSupport?: boolean;
  // Section 8 -- whether temporal ordering data supports this
  // relationship (e.g. source genuinely precedes target). Purely
  // informational; never itself sufficient to establish the relationship
  // (temporal order != professional semantics, this file's absolute
  // rule).
  readonly temporalSupport?: boolean;
  readonly evidenceInterval?: VideoTimeInterval;
  readonly note?: string;
}

export interface ReferenceDependencyRelationship extends ReferenceDependencyRelationshipInput {
  readonly id: string;
  // Derived (Section 24): something was genuinely asserted at all (any
  // provenance other than UNKNOWN). NOT the same as `established` below.
  readonly sourceSupport: boolean;
  // Derived (Section 24): PROFESSIONAL AUTHORITY is its own, independent
  // dimension from source observation.
  readonly professionalAuthority: boolean;
  // Derived via isReferenceDependencyEstablished -- the single place that
  // decides whether this relationship may be treated as real professional
  // knowledge rather than an unproven possibility.
  readonly established: boolean;
}

export function computeReferenceDependencyRelationshipId(input: ReferenceDependencyRelationshipInput): string {
  const canonical = [
    `${input.sourceEntity.kind}:${input.sourceEntity.ref}`,
    `${input.targetEntity.kind}:${input.targetEntity.ref}`,
    input.relationshipType,
    input.provenance,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// THE core safety gate (Section 6). PROFESSIONAL_INPUT is self-
// authorizing (a professional's own explicit statement is already the
// strongest authority this application recognizes, same precedent as
// every prior stage's PROFESSIONAL_INPUT handling). UNKNOWN can never be
// "established" (nothing to establish). OBSERVED/INFERRED require
// genuine, caller-supplied semantic support -- temporal adjacency,
// matching visible length, or bare co-occurrence NEVER satisfy this on
// their own, because none of those ever sets `semanticSupport: true` by
// themselves; a caller must explicitly assert it, and only after real
// grounding (the same discipline R2.2's isClaimSemanticallyBound
// enforces for scalar field claims).
export function isReferenceDependencyEstablished(input: Pick<ReferenceDependencyRelationshipInput, "provenance" | "semanticSupport">): boolean {
  if (input.provenance === "PROFESSIONAL_INPUT") return true;
  if (input.provenance === "UNKNOWN") return false;
  return input.semanticSupport === true;
}

export function createReferenceDependencyRelationship(input: ReferenceDependencyRelationshipInput): ReferenceDependencyRelationship {
  return {
    ...input,
    id: computeReferenceDependencyRelationshipId(input),
    sourceSupport: input.provenance !== "UNKNOWN",
    professionalAuthority: input.provenance === "PROFESSIONAL_INPUT",
    established: isReferenceDependencyEstablished(input),
  };
}

export function isValidReferenceDependencyRelationship(value: unknown): value is ReferenceDependencyRelationship {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (!isValidReferenceEntityRef(record.sourceEntity)) return false;
  if (!isValidReferenceEntityRef(record.targetEntity)) return false;
  if (!isReferenceDependencyRelationshipType(record.relationshipType)) return false;
  if (!isProfessionalLearningProvenanceSource(record.provenance)) return false;
  if (record.referenceRole !== undefined && !isReferenceRoleKind(record.referenceRole)) return false;
  if (record.semanticSupport !== undefined && typeof record.semanticSupport !== "boolean") return false;
  if (record.temporalSupport !== undefined && typeof record.temporalSupport !== "boolean") return false;
  if (record.evidenceInterval !== undefined && !isValidVideoTimeInterval(record.evidenceInterval)) return false;
  if (record.note !== undefined && typeof record.note !== "string") return false;
  if (typeof record.id !== "string" || record.id.length === 0) return false;
  if (typeof record.sourceSupport !== "boolean") return false;
  if (typeof record.professionalAuthority !== "boolean") return false;
  if (typeof record.established !== "boolean") return false;
  return true;
}

// ---------------------------------------------------------------------
// Guide/reference lifecycle summary (Section 9) -- reporting-only, exact
// same "missing stage is NOT_OBSERVED, never fabricated" discipline as
// L5's own summarizeCoreCompletionChain. Deliberately stops before
// "NEXT_ITERATION": claiming a video/evidence demonstrates a SECOND
// iteration of the pattern requires real repetition evidence this
// module never assumes on its own (Section 15 -- capable of representing
// the pattern, never claims the source demonstrates the whole pattern).
// ---------------------------------------------------------------------

export const REFERENCE_LIFECYCLE_STAGES = [
  "REFERENCE_ESTABLISHED",
  "NEXT_MATERIAL_PRESENTED",
  "NEXT_MATERIAL_CONTROLLED_AGAINST_REFERENCE",
  "ACTION_RELATIVE_TO_REFERENCE",
  "RESULT_PRODUCED",
  "RESULT_MAY_BECOME_CONTINUATION_REFERENCE",
] as const;
export type ReferenceLifecycleStage = (typeof REFERENCE_LIFECYCLE_STAGES)[number];

export interface ReferenceLifecycleInput {
  readonly relationships: readonly ReferenceDependencyRelationship[];
  readonly nextMaterialPresentedObserved: boolean;
  readonly resultProducedObserved: boolean;
}

export function summarizeReferenceLifecycle(input: ReferenceLifecycleInput): Readonly<Record<ReferenceLifecycleStage, "OBSERVED" | "NOT_OBSERVED">> {
  const established = input.relationships.filter((r) => r.established);
  const hasType = (type: ReferenceDependencyRelationshipType) => established.some((r) => r.relationshipType === type);

  return {
    REFERENCE_ESTABLISHED: hasType("ESTABLISHES_REFERENCE") ? "OBSERVED" : "NOT_OBSERVED",
    NEXT_MATERIAL_PRESENTED: input.nextMaterialPresentedObserved ? "OBSERVED" : "NOT_OBSERVED",
    NEXT_MATERIAL_CONTROLLED_AGAINST_REFERENCE: hasType("ALIGNS_TO_REFERENCE") || hasType("USES_REFERENCE") ? "OBSERVED" : "NOT_OBSERVED",
    ACTION_RELATIVE_TO_REFERENCE: hasType("CUTS_TO_REFERENCE") || hasType("USES_REFERENCE") ? "OBSERVED" : "NOT_OBSERVED",
    RESULT_PRODUCED: input.resultProducedObserved ? "OBSERVED" : "NOT_OBSERVED",
    RESULT_MAY_BECOME_CONTINUATION_REFERENCE: hasType("CONTINUES_REFERENCE") ? "OBSERVED" : "NOT_OBSERVED",
  };
}
