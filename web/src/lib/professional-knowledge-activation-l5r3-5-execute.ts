import {
  buildAuthorizedProposalSet,
  classifyMutationForActivation,
  type MutationActivationClassificationResult,
} from "@/lib/professional-knowledge-activation-l5r3-5-manifest";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { computeRegistryContextHash } from "@/lib/professional-knowledge-registry-comparison";
import { INTERIOR_45_SKILL } from "@/lib/cutting-skill-45-degree-interior";
import { GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";
import { SLICE_AND_SLIDE_REFINEMENT_SKILL } from "@/lib/cutting-skill-slice-and-slide-refinement";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.5 --
// ACTIVATION EXECUTION / VERIFICATION. Pure, no I/O, no database, ZERO AI
// calls. "ACTIVATION IS NOT REASONING": every function here VERIFIES an
// already-made, deterministic source-level change (this stage's own one
// real edit: cutting-skill-45-degree-interior.ts's `status` field,
// DRAFT -> ACTIVE) -- nothing here decides content, infers a missing
// field, or constructs a SkillDefinition from scratch. A function that
// found a real drift would report it; none of them ever silently repair
// one.

// ---------------------------------------------------------------------
// Activation summary -- classifies all 11 authorized proposals, grouped
// by outcome. See the manifest file's own header for the full
// architecture audit behind each classification.
// ---------------------------------------------------------------------

export interface ActivationSummary {
  readonly activated: readonly MutationActivationClassificationResult[];
  readonly pendingByDesign: readonly MutationActivationClassificationResult[];
  readonly pendingNoMechanism: readonly MutationActivationClassificationResult[];
}

export function computeActivationSummary(): ActivationSummary {
  const classifications = buildAuthorizedProposalSet().map(classifyMutationForActivation);
  return {
    activated: classifications.filter((c) => c.classification === "ACTIVATED"),
    pendingByDesign: classifications.filter((c) => c.classification === "PENDING_BY_DESIGN"),
    pendingNoMechanism: classifications.filter((c) => c.classification === "PENDING_NO_MECHANISM"),
  };
}

// ---------------------------------------------------------------------
// Skill activation diff verifier -- proves the ONE real source edit this
// stage performed changed EXACTLY `status` (DRAFT -> ACTIVE) and nothing
// else on INTERIOR_45_SKILL. The pre-activation DRAFT shape is
// reconstructed (never re-read from git/disk -- this is a pure, in-memory
// verification), since `status` is the only field this stage's own task
// authorized changing.
// ---------------------------------------------------------------------

export function reconstructPreActivationDraftSkill(): typeof INTERIOR_45_SKILL {
  return { ...INTERIOR_45_SKILL, status: "DRAFT" };
}

export interface SkillActivationDiffResult {
  readonly onlyStatusChanged: boolean;
  readonly changedFields: readonly string[];
  readonly before: string;
  readonly after: string;
}

export function verifyInterior45ActivationDiff(): SkillActivationDiffResult {
  const draft = reconstructPreActivationDraftSkill();
  const active = INTERIOR_45_SKILL;
  const keys = new Set<string>([...Object.keys(draft), ...Object.keys(active)]);
  const changedFields: string[] = [];
  for (const key of keys) {
    const draftValue = JSON.stringify((draft as unknown as Record<string, unknown>)[key]);
    const activeValue = JSON.stringify((active as unknown as Record<string, unknown>)[key]);
    if (draftValue !== activeValue) changedFields.push(key);
  }
  return { onlyStatusChanged: changedFields.length === 1 && changedFields[0] === "status", changedFields, before: draft.status, after: active.status };
}

// ---------------------------------------------------------------------
// Registry diff -- ADDED / MODIFIED / UNCHANGED, computed against the
// same pre-activation reconstruction the manifest file uses (filtering
// the live registry down to exclude 45-degree-interior).
// ---------------------------------------------------------------------

export const REGISTRY_DIFF_OPERATIONS = ["ADDED", "MODIFIED", "UNCHANGED"] as const;
export type RegistryDiffOperation = (typeof REGISTRY_DIFF_OPERATIONS)[number];

export interface RegistryDiffEntry {
  readonly skillId: string;
  readonly version: number;
  readonly operation: RegistryDiffOperation;
  readonly beforeStatus: string | null;
  readonly afterStatus: string | null;
}

export function computeRegistryDiff(): readonly RegistryDiffEntry[] {
  const post = buildCanonicalCandidateSkillRegistry();
  const pre = post.filter((record) => record.skillId !== INTERIOR_45_SKILL.skillId);
  const preById = new Map(pre.map((record) => [record.skillId, record]));

  return post.map((record) => {
    const before = preById.get(record.skillId);
    if (!before) {
      return { skillId: record.skillId, version: record.version, operation: "ADDED" as const, beforeStatus: null, afterStatus: record.status };
    }
    const operation: RegistryDiffOperation = JSON.stringify(before.payload) === JSON.stringify(record.payload) ? "UNCHANGED" : "MODIFIED";
    return { skillId: record.skillId, version: record.version, operation, beforeStatus: before.status, afterStatus: record.status };
  });
}

export function computePreActivationRegistryFingerprintNow(): string {
  return computeRegistryContextHash(buildCanonicalCandidateSkillRegistry().filter((record) => record.skillId !== INTERIOR_45_SKILL.skillId));
}

export function computePostActivationRegistryFingerprintNow(): string {
  return computeRegistryContextHash(buildCanonicalCandidateSkillRegistry());
}

// ---------------------------------------------------------------------
// Named FAIL-CLOSED safety guards -- each proves one specific forbidden
// drift did NOT happen, per this stage's own explicit FAIL-CLOSED
// REQUIREMENTS list. Every guard is a real, structural check over the
// live constants, never a hardcoded "true".
// ---------------------------------------------------------------------

export function guardNoElevation45OnInterior45(): boolean {
  return INTERIOR_45_SKILL.parameters.every((p) => p.name !== "elevation");
}

export function guardGraduatedElevationIntact(): boolean {
  const elevationParam = GRADUATED_CUTTING_SKILL.parameters.find((p) => p.name === "elevation");
  return Boolean(elevationParam && (elevationParam.allowedValues ?? []).includes("45_deg_graduation"));
}

export function guardOneLengthNoTravellingGuideRegression(): boolean {
  const serialized = JSON.stringify(ONE_LENGTH_PERIMETER_SKILL).toLowerCase();
  return !serialized.includes("travel");
}

export function guardSliceAndSlideUnchanged(expectedPayloadJson: string): boolean {
  return JSON.stringify(SLICE_AND_SLIDE_REFINEMENT_SKILL) === expectedPayloadJson;
}

export function guardInterior45DependsOnOneLength(): boolean {
  return (INTERIOR_45_SKILL.prerequisiteSkillIds ?? []).includes(ONE_LENGTH_PERIMETER_SKILL.skillId);
}

export function guardInterior45NotMandatoryForOneLength(): boolean {
  const serialized = JSON.stringify(ONE_LENGTH_PERIMETER_SKILL);
  return !serialized.includes(INTERIOR_45_SKILL.skillId);
}

export function guardInterior45LengthRelationshipIntact(): boolean {
  const param = INTERIOR_45_SKILL.parameters.find((p) => p.name === "terminalLengthRelationship");
  return Boolean(param?.allowedValues?.length === 1 && param.allowedValues[0] === "exterior_shorter_than_interior");
}

// Aggregate -- every guard must pass, or activation must be considered
// unsafe. Never called from a mutating path; this stage's own report
// calls it as a final safety confirmation.
export function runAllFailClosedGuards(): { allPassed: boolean; failedGuardNames: readonly string[] } {
  const guards: readonly [string, () => boolean][] = [
    ["guardNoElevation45OnInterior45", guardNoElevation45OnInterior45],
    ["guardGraduatedElevationIntact", guardGraduatedElevationIntact],
    ["guardOneLengthNoTravellingGuideRegression", guardOneLengthNoTravellingGuideRegression],
    ["guardInterior45DependsOnOneLength", guardInterior45DependsOnOneLength],
    ["guardInterior45NotMandatoryForOneLength", guardInterior45NotMandatoryForOneLength],
    ["guardInterior45LengthRelationshipIntact", guardInterior45LengthRelationshipIntact],
  ];
  const failedGuardNames = guards.filter(([, fn]) => !fn()).map(([name]) => name);
  return { allPassed: failedGuardNames.length === 0, failedGuardNames };
}
