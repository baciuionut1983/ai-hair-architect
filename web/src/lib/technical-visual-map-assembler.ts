import type { ProposalEditEntry } from "@/lib/proposal-validators";
import { isTechnicalCutPlanShape } from "@/lib/proposal-validators";
import type { ProposalRecord } from "@/lib/proposal-repository";
import type { CuttingEvidenceSnapshot } from "@/lib/proposal-assembler";
import type { TechnicalCutPlan } from "@/lib/contracts";
import {
  HEAD_ZONES,
  type PreserveConstraintEntry,
  type TechnicalVisualMapPayload,
  type ZoneIntentEntry,
} from "@/lib/technical-visual-map-validators";

// Technical Visual Map, Stage 2 -- the missing PURE step between a CONFIRMED
// AnalysisProposal and a DRAFT TechnicalVisualMap. Mirrors
// proposal-assembler.ts's own purity contract exactly: no database read or
// write, no network call, no AI/provider call, no clock read beyond what the
// caller already fixed, no mutation of the argument. Same input Analysis
// Proposal therefore always produces the same output.

export const TECHNICAL_VISUAL_MAP_SCHEMA_VERSION = "1.0.0";
export const TECHNICAL_VISUAL_MAP_GENERATOR_VERSION = "1.0.0-tvm1";

const EDITABLE_TECHNIQUE_FIELDS = [
  "structuralTechnique",
  "cuttingTechnique",
  "texturizingTechnique",
  "sectioning",
  "elevation",
  "distribution",
  "guideline",
] as const;
type EditableTechniqueField = (typeof EDITABLE_TECHNIQUE_FIELDS)[number];

// Small, local, backend-appropriate re-derivation of the same "last matching
// edit wins" merge already proven client-side by Stage 4's
// computeEffectiveCuttingFields/buildEffectivePlan (proposed-look-logic.ts,
// under src/app/.../proposed-look/) -- that file lives in a page directory
// and must not be imported from src/lib (wrong architectural layer; src/lib
// must not depend on a route's own colocated logic). This is a small,
// self-contained restatement of the identical algorithm, operating on the
// same shared ProposalEditEntry/TechnicalCutPlan types, not a divergent
// reimplementation of the rule itself.
function computeEffectiveTechnicalCutPlan(payload: TechnicalCutPlan, edits: ProposalEditEntry[]): TechnicalCutPlan {
  const effective: TechnicalCutPlan = { ...payload };
  for (const field of EDITABLE_TECHNIQUE_FIELDS) {
    let latestValue: unknown;
    let found = false;
    for (const edit of edits) {
      if (edit.field === field) {
        latestValue = edit.newValue;
        found = true;
      }
    }
    if (found) {
      (effective as unknown as Record<EditableTechniqueField, unknown>)[field] = latestValue;
    }
  }
  return effective;
}

export class TechnicalVisualMapAssemblyError extends Error {
  constructor(
    readonly code:
      | "TECHNICAL_VISUAL_MAP_ASSEMBLY_UNSUPPORTED_VERTICAL"
      | "TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED"
      | "TECHNICAL_VISUAL_MAP_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN",
    message: string,
  ) {
    super(message);
    this.name = "TechnicalVisualMapAssemblyError";
  }
}

// The assembler only ever reads this subset of a ProposalRecord -- narrowed
// deliberately so callers (the repository) never need to fabricate
// irrelevant fields (consideredMemory, promotedConsultationSources, ...)
// just to satisfy the parameter type.
export type TechnicalVisualMapAssemblerInput = Pick<
  ProposalRecord,
  "id" | "vertical" | "status" | "payload" | "edits" | "evidenceSnapshot" | "sourceImageAssetId" | "sourceImageAnalysisId"
>;

export interface TechnicalVisualMapCreationInput {
  payload: TechnicalVisualMapPayload;
  schemaVersion: string;
  generatorVersion: string;
  sourceImageAssetId: string | null;
  sourceImageAnalysisId: string | null;
}

// Only "cutting" is supported in Stage 2 -- an unsupported vertical fails
// safely before any zone/constraint logic runs.
export function assembleCuttingTechnicalVisualMap(proposal: TechnicalVisualMapAssemblerInput): TechnicalVisualMapCreationInput {
  if (proposal.vertical !== "cutting") {
    throw new TechnicalVisualMapAssemblyError(
      "TECHNICAL_VISUAL_MAP_ASSEMBLY_UNSUPPORTED_VERTICAL",
      `Proposal ${proposal.id} has vertical "${proposal.vertical}"; Technical Visual Map Stage 2 only supports "cutting".`,
    );
  }

  // Input authority is a CONFIRMED proposal only (Decision Lock, Lock 2) --
  // DRAFT/REJECTED/SUPERSEDED never assemble into a new map.
  if (proposal.status !== "CONFIRMED") {
    throw new TechnicalVisualMapAssemblyError(
      "TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED",
      `Proposal ${proposal.id} is ${proposal.status}; a Technical Visual Map can only be assembled from a CONFIRMED proposal.`,
    );
  }

  // The EFFECTIVE plan (baseline + edits merged), never the raw frozen
  // baseline alone -- what was actually approved is what the professional
  // sees today, edits included.
  const effectivePlan = computeEffectiveTechnicalCutPlan(proposal.payload, proposal.edits);

  // Re-validated defensively even though proposal.payload was already valid
  // by construction -- the effective plan is a NEW derived object and must
  // be proven structurally sound before anything is built from it, mirroring
  // proposal-assembler.ts's own "fail safely rather than persist malformed
  // data" philosophy. Reuses the existing shared validator -- never a second
  // copy of TechnicalCutPlan validation logic.
  if (!isTechnicalCutPlanShape(effectivePlan)) {
    throw new TechnicalVisualMapAssemblyError(
      "TECHNICAL_VISUAL_MAP_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN",
      `Proposal ${proposal.id}'s effective technical cut plan failed structural validation; refusing to assemble a map from malformed data.`,
    );
  }

  // (1) Global intent -- copied ONCE, here, from the effective plan's own
  // technique fields. Never smeared into all 6 zones (the CRITICAL rule this
  // whole domain exists to satisfy) -- a zone only gets an override when
  // something genuinely zone-specific justifies one, which nothing in the
  // current confirmed-proposal data model ever does (see (2) below).
  const globalIntent: TechnicalVisualMapPayload["globalIntent"] = {
    structuralTechnique: effectivePlan.structuralTechnique,
    cuttingTechnique: effectivePlan.cuttingTechnique,
    ...(effectivePlan.texturizingTechnique ? { texturizingTechnique: effectivePlan.texturizingTechnique } : {}),
    sectioning: effectivePlan.sectioning,
    elevation: effectivePlan.elevation,
    distribution: effectivePlan.distribution,
    guideline: effectivePlan.guideline,
  };

  // (2) The six-zone semantic skeleton. NO GUESSED ANATOMY: nothing in the
  // current confirmed proposal, its evidence, or its edits ever localizes a
  // length, weight, elevation, distribution, texturizing, or density fact to
  // one specific head zone over another -- every field elevationAngle on
  // every cuttingStep already repeats the SAME single global elevation value
  // (see cutting-plan-engine.ts's own generateTechnicalCutPlan), and no
  // evidence field carries per-zone information at all. An honest, sparse,
  // fully-unspecified skeleton is therefore the ONLY deterministically
  // correct output here -- fabricating per-zone detail that the confirmed
  // data cannot support would be exactly the "fabricated rich map" failure
  // mode this stage is required to prove it never produces. Every field is
  // explicitly attributed "global_default": not a guess, but the honest,
  // stated absence of any zone-specific claim.
  const zones: ZoneIntentEntry[] = HEAD_ZONES.map((zone) => ({
    zone,
    lengthIntent: "unspecified",
    lengthIntentSource: "global_default",
    weightIntent: "unspecified",
    weightIntentSource: "global_default",
    densitySensitive: false,
    densitySensitiveSource: "global_default",
    preserve: false,
    preserveSource: "global_default",
  }));

  // (3) Preserve constraints -- the ONE constraint type the assembler can
  // populate with genuine, mechanical completeness: a 1:1 copy of the
  // already-frozen contraindications from the proposal's own evidence
  // snapshot. Every other locked constraint type (preserve_identity,
  // preserve_face_proportions, preserve_hairline, preserve_density_
  // sensitive_area, preserve_perimeter_weight, do_not_modify_unrelated_
  // appearance) is a VALID type in the vocabulary but is deliberately NEVER
  // emitted here:
  //   - preserve_identity / preserve_face_proportions / do_not_modify_
  //     unrelated_appearance are downstream Photo/Video generation
  //     invariants, not something derivable from a cutting proposal's own
  //     confirmed data -- adding them here would be exactly the "Photo-
  //     specific constraint added merely because it will eventually be
  //     useful" this stage is instructed not to do.
  //   - preserve_hairline / preserve_density_sensitive_area both require a
  //     genuine, explicit zone-scoped preservation decision (a professional
  //     marking a specific zone's `preserve`/`densitySensitive` flag) --
  //     nothing in a fresh confirmed proposal states this yet; these only
  //     ever appear after a real professional adjustment.
  const evidence = proposal.evidenceSnapshot as unknown as CuttingEvidenceSnapshot;
  const contraindications = evidence?.derivedSafety?.contraindications ?? [];
  const preserveConstraints: PreserveConstraintEntry[] = contraindications.map((reference) => ({
    type: "respect_contraindication",
    reference,
    source: "deterministic_evidence",
  }));

  const payload: TechnicalVisualMapPayload = {
    globalIntent,
    zones,
    relationships: [],
    preserveConstraints,
  };

  return {
    payload,
    schemaVersion: TECHNICAL_VISUAL_MAP_SCHEMA_VERSION,
    generatorVersion: TECHNICAL_VISUAL_MAP_GENERATOR_VERSION,
    sourceImageAssetId: proposal.sourceImageAssetId,
    sourceImageAnalysisId: proposal.sourceImageAnalysisId,
  };
}
