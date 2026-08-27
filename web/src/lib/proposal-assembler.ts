import type { TechnicalCutPlan } from "@/lib/contracts";
import type { AnalysisState } from "@/lib/milestone2-types";
import { isTechnicalCutPlanShape } from "@/lib/proposal-validators";

// AI Proposed Look (Phase 2) -- the missing PURE step between an already-loaded
// Analysis row and createProposalForOwner in proposal-repository.ts.
//
// createProposalForOwner requires the caller to already hand it `payload`,
// `evidenceSnapshot`, and `engineVersion`; nothing in the codebase currently
// derives those three from an Analysis. This module is exactly that derivation,
// and nothing more.
//
// PURITY CONTRACT -- this function performs NO I/O of any kind:
//   * no database read or write (it only ever touches its `analysis` argument),
//   * no network call,
//   * no AI / provider call (it imports no Gemini / OpenAI / Claude / provider
//     module, and no cutting-plan-engine.ts),
//   * no clock read, no randomness, no mutation of the argument.
// The same input Analysis therefore always produces the same output. Any future
// edit that adds a `source`/provenance lookup, regenerates the plan, or reaches
// for the AnalysisCorrection table would break this contract -- see the inline
// notes below for why each was deliberately left out.
//
// Phase 2 scope is vertical = "cutting" ONLY. There is deliberately no generic
// multi-vertical dispatcher or registry here -- that is unbuilt speculative
// scope beyond what exists today.

export interface CuttingEvidenceSnapshot {
  observations: {
    hairType: AnalysisState["hairType"];
    density: AnalysisState["density"];
    porosity: AnalysisState["porosity"];
    hairCondition: AnalysisState["hairCondition"] | null;
    hairTexture: AnalysisState["hairTexture"] | null;
    hairLength: AnalysisState["hairLength"] | null;
    growthPattern: AnalysisState["growthPattern"] | null;
    faceShape: AnalysisState["faceShape"] | null;
    headShape: AnalysisState["headShape"] | null;
  };
  derivedSafety: {
    safetyNotes: string[];
    contraindications: string[];
  };
}

export interface ProposalCreationInput {
  payload: TechnicalCutPlan;
  evidenceSnapshot: CuttingEvidenceSnapshot;
  engineVersion: string;
  sourceImageAssetId: string | null;
  sourceImageAnalysisId: string | null;
}

// Typed failure. Thrown BEFORE any repository call is ever made, so
// createProposalForOwner is never reached with malformed data -- "fail safely
// rather than persist a malformed proposal". Shape convention matches
// ProposalValidationError in proposal-repository.ts: code first, then message.
export class ProposalAssemblyError extends Error {
  constructor(
    readonly code: "PROPOSAL_ASSEMBLY_MISSING_PLAN" | "PROPOSAL_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN",
    message: string,
  ) {
    super(message);
    this.name = "ProposalAssemblyError";
  }
}

export function assembleCuttingProposalCreationInput(analysis: AnalysisState): ProposalCreationInput {
  // The persisted plan is the single source of truth. It is read as `unknown`
  // and re-checked at runtime on purpose: persisted JSON can drift from the
  // compile-time AnalysisState shape, and a malformed persisted plan must never
  // reach proposal creation.
  const persistedPlan: unknown = analysis.technicalCutPlan;

  // (1) No plan at all -> there is nothing to turn into a cutting proposal.
  if (persistedPlan === undefined || persistedPlan === null) {
    throw new ProposalAssemblyError(
      "PROPOSAL_ASSEMBLY_MISSING_PLAN",
      `Analysis ${analysis.id} has no technicalCutPlan; a cutting proposal cannot be created from it.`,
    );
  }

  // (2) A plan that is not structurally a TechnicalCutPlan is malformed
  // persisted data. Reuse the one shared validator -- do NOT re-implement the
  // shape check here.
  if (!isTechnicalCutPlanShape(persistedPlan)) {
    throw new ProposalAssemblyError(
      "PROPOSAL_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN",
      `Analysis ${analysis.id}'s persisted technicalCutPlan failed structural validation; refusing to create a proposal from malformed data.`,
    );
  }

  // (3) The payload IS the persisted plan, reused verbatim -- same object, not a
  // copy and not a regeneration. It is never recomputed via cutting-plan-engine.ts
  // and never fetched from an AI provider (this module imports neither).
  const payload: TechnicalCutPlan = persistedPlan;

  // (4) The engine version is the plan's OWN existing version string -- never a
  // new or invented versioning scheme.
  const engineVersion: string = persistedPlan.version;

  // (5) Raw observed Analysis evidence only. `hairType` / `density` / `porosity`
  // are always defined on AnalysisState and are copied directly. The remaining
  // six are optional: when the Analysis value is `undefined` an explicit `null`
  // is stored (the key is never omitted and a value is never fabricated); when
  // defined, the real value is copied. `hairLength` is included even though the
  // current cutting engine does not branch on it -- it is still real
  // professional evidence and must stay historically explainable.
  //
  // (9) NO per-field `source` / provenance attribution (e.g. AnalysisFieldSource)
  // is attached to any observation value. The live Analysis row has no per-field
  // source column anywhere in the schema -- only the separate, DB-backed
  // AnalysisCorrection audit trail carries a `source`, and reading that would
  // require additional database I/O this pure function must never perform.
  // Inventing source attribution here would fabricate provenance the repository
  // does not actually have. Do not "helpfully" add it back.
  const observations: CuttingEvidenceSnapshot["observations"] = {
    hairType: analysis.hairType,
    density: analysis.density,
    porosity: analysis.porosity,
    hairCondition: analysis.hairCondition ?? null,
    hairTexture: analysis.hairTexture ?? null,
    hairLength: analysis.hairLength ?? null,
    growthPattern: analysis.growthPattern ?? null,
    faceShape: analysis.faceShape ?? null,
    headShape: analysis.headShape ?? null,
  };

  // (6) `derivedSafety` is a SEPARATE structure, never merged into
  // `observations`, because `technicalCutPlan.contraindications` is deterministic
  // ENGINE OUTPUT (derived), not raw observed Analysis evidence -- keeping it out
  // of `observations` keeps it traceable as engine-derived rather than
  // misrepresented as an observed fact. `safetyNotes` is raw Analysis evidence.
  // Both are copied here, not referenced.
  const derivedSafety: CuttingEvidenceSnapshot["derivedSafety"] = {
    safetyNotes: [...analysis.safetyNotes],
    contraindications: [...persistedPlan.contraindications],
  };

  // (7) Intentionally NOT snapshotted into evidence: targetShape,
  // cuttingTechnique / structuralTechnique, elevation, distribution /
  // overdirection, sectioning, texturizingTechnique, cuttingSteps,
  // professionalReason / stylistExplanation / clientExplanation, confidence, and
  // recommendations. All of that is proposal intent / engine narrative and lives
  // only in the frozen `payload`, never duplicated into evidence.

  // (8) The soft image pointers come ONLY from the already-loaded Analysis row;
  // there is no request-input parameter for either.
  return {
    payload,
    evidenceSnapshot: { observations, derivedSafety },
    engineVersion,
    sourceImageAssetId: analysis.imageAssetId ?? null,
    sourceImageAnalysisId: analysis.imageAnalysisId ?? null,
  };
}
