import { describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import type { AnalysisState } from "@/lib/milestone2-types";
import {
  ProposalAssemblyError,
  assembleCuttingProposalCreationInput,
  type ProposalCreationInput,
} from "@/lib/proposal-assembler";

// Pure-function tests. assembleCuttingProposalCreationInput does no I/O of any
// kind, so every case here is a plain constructed-fixture -> output assertion:
// no database, no mocks, no provider stubs -- there is nothing to stub.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function cuttingPlan(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "traveling",
    cuttingSteps: [
      {
        stepNumber: 1,
        zone: "nape",
        action: "Establish the perimeter guideline",
        elevationAngle: "0_deg_blunt",
        toolRequired: "shears",
      },
      {
        stepNumber: 2,
        zone: "crown",
        action: "Cross-check the interior against the travelled guide",
        elevationAngle: "90_deg_uniform_layer",
        toolRequired: "shears",
      },
    ],
    stylistExplanation: "Radial sectioning through the crown; keep tension even.",
    clientExplanation: "Soft layers that keep length while removing bulk.",
    professionalReason: "Graduation controls corner weight for this face shape.",
    warnings: ["Wavy texture springs up roughly 1cm once dry."],
    contraindications: ["Client reports scalp psoriasis flare in the occipital area."],
    assumptions: ["Hair assessed dry, in natural fall."],
    missingData: [],
    confidence: 0.77,
    notes: ["Allow a 20-minute detailing window."],
    stylistValidationDisclaimer: "Stylist must validate on-body before cutting.",
    version: "cut-engine-2.3.1",
    ...overrides,
  };
}

function baseAnalysis(overrides: Partial<AnalysisState> = {}): AnalysisState {
  return {
    id: "an_fixture_001",
    clientId: "cl_fixture_001",
    createdByUserId: "usr_fixture_001",
    goal: "reshape",
    hairType: "coarse",
    density: "high",
    porosity: "medium",
    phase: "ready",
    clarificationRound: 0,
    confidenceScore: 0.82,
    uncertaintyReasons: [],
    followUpQuestions: [],
    recommendations: ["Re-book in eight weeks for a shape refresh."],
    safetyNotes: [
      "Perform a strand test before any chemical service.",
      "Check for prior keratin treatment at the mid-lengths.",
    ],
    clarificationAnswers: [],
    faceShape: "oval",
    headShape: "flat_occipital",
    hairLength: "long",
    hairTexture: "wavy",
    hairCondition: "chemically_treated",
    growthPattern: "double_crown",
    targetShape: "graduated_bob",
    technicalCutPlan: cuttingPlan(),
    imageAssetId: "ia_asset_fixture_001",
    imageAnalysisId: "ia_analysis_fixture_001",
    createdAt: "2026-02-01T09:00:00.000Z",
    updatedAt: "2026-02-03T14:30:00.000Z",
    ...overrides,
  };
}

// A structurally invalid plan: one required field removed entirely.
function planMissing(field: keyof TechnicalCutPlan): TechnicalCutPlan {
  const entries = Object.entries(cuttingPlan()).filter(([key]) => key !== field);
  return Object.fromEntries(entries) as unknown as TechnicalCutPlan;
}

// Recursively collect every object key reachable inside `value`.
function collectKeys(value: unknown, acc: Set<string> = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, acc);
  } else if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      acc.add(key);
      collectKeys((value as Record<string, unknown>)[key], acc);
    }
  }
  return acc;
}

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

const OBSERVATION_KEYS = [
  "hairType",
  "density",
  "porosity",
  "hairCondition",
  "hairTexture",
  "hairLength",
  "growthPattern",
  "faceShape",
  "headShape",
] as const;

const OPTIONAL_OBSERVATION_KEYS = [
  "hairCondition",
  "hairTexture",
  "hairLength",
  "growthPattern",
  "faceShape",
  "headShape",
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("proposal-assembler (pure Analysis -> ProposalCreationInput derivation)", () => {
  it("1. a fully-populated cutting Analysis produces a fully-populated, deterministic ProposalCreationInput", () => {
    const analysis = baseAnalysis();

    const first = assembleCuttingProposalCreationInput(analysis);
    const second = assembleCuttingProposalCreationInput(analysis);

    // Identical input object -> deep-equal output, both times.
    expect(first).toEqual(second);

    // ...and it is genuinely fully populated.
    expect(first.payload).toBeDefined();
    expect(first.engineVersion).toBe("cut-engine-2.3.1");
    expect(first.sourceImageAssetId).toBe("ia_asset_fixture_001");
    expect(first.sourceImageAnalysisId).toBe("ia_analysis_fixture_001");
    const obs = first.evidenceSnapshot.observations;
    for (const key of OBSERVATION_KEYS) {
      expect(obs[key]).not.toBeNull();
      expect(obs[key]).not.toBeUndefined();
    }
    expect(first.evidenceSnapshot.derivedSafety.safetyNotes.length).toBeGreaterThan(0);
    expect(first.evidenceSnapshot.derivedSafety.contraindications.length).toBeGreaterThan(0);
  });

  it("2. the returned payload is the persisted technicalCutPlan reused verbatim, not regenerated", () => {
    const analysis = baseAnalysis();

    const result = assembleCuttingProposalCreationInput(analysis);

    // Same object reference: the plan is passed straight through. Nothing here
    // rebuilds it -- the module imports no engine and no AI/provider.
    expect(result.payload).toBe(analysis.technicalCutPlan);
    // ...and therefore it is deep-equal on every field.
    expect(result.payload).toEqual(cuttingPlan());
  });

  it("3. engineVersion equals analysis.technicalCutPlan.version exactly", () => {
    const analysis = baseAnalysis({
      technicalCutPlan: cuttingPlan({ version: "cut-engine-9.9.9-rc4" }),
    });

    const result = assembleCuttingProposalCreationInput(analysis);

    expect(result.engineVersion).toBe("cut-engine-9.9.9-rc4");
    expect(result.engineVersion).toBe(analysis.technicalCutPlan?.version);
  });

  it("4. all 9 locked observation fields are snapshotted with the exact values from the Analysis", () => {
    const analysis = baseAnalysis();

    const { observations } = assembleCuttingProposalCreationInput(analysis).evidenceSnapshot;

    expect(observations).toEqual({
      hairType: "coarse",
      density: "high",
      porosity: "medium",
      hairCondition: "chemically_treated",
      hairTexture: "wavy",
      hairLength: "long",
      growthPattern: "double_crown",
      faceShape: "oval",
      headShape: "flat_occipital",
    });
    expect(Object.keys(observations).sort()).toEqual([...OBSERVATION_KEYS].sort());
  });

  it("5. an Analysis missing every optional observation field yields explicit null (never omitted, never fabricated)", () => {
    const analysis = baseAnalysis({
      hairCondition: undefined,
      hairTexture: undefined,
      hairLength: undefined,
      growthPattern: undefined,
      faceShape: undefined,
      headShape: undefined,
    });

    const { observations } = assembleCuttingProposalCreationInput(analysis).evidenceSnapshot;

    for (const key of OPTIONAL_OBSERVATION_KEYS) {
      expect(key in observations).toBe(true); // key present, not omitted
      expect(observations[key]).toBeNull(); // explicit null
      expect(Object.is(observations[key], null)).toBe(true); // strictly null, not undefined
    }
    // The always-present fields are still copied verbatim.
    expect(observations.hairType).toBe("coarse");
    expect(observations.density).toBe("high");
    expect(observations.porosity).toBe("medium");
  });

  it("6. no per-field source/provenance attribution is attached to any observation value", () => {
    const analysis = baseAnalysis();

    const { observations } = assembleCuttingProposalCreationInput(analysis).evidenceSnapshot;

    const keys = collectKeys(observations);
    for (const forbidden of ["source", "sources", "provenance", "fieldSource", "attribution"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    // Every observation value is a bare primitive (string) or null -- never a
    // { value, source } wrapper object.
    for (const value of Object.values(observations)) {
      expect(value === null || typeof value === "string").toBe(true);
    }
  });

  it("7. derivedSafety holds copies of safetyNotes and the plan's contraindications, kept out of observations", () => {
    const analysis = baseAnalysis();

    const { observations, derivedSafety } = assembleCuttingProposalCreationInput(analysis).evidenceSnapshot;

    expect(derivedSafety.safetyNotes).toEqual(analysis.safetyNotes);
    expect(derivedSafety.safetyNotes).not.toBe(analysis.safetyNotes); // a copy, not the same array
    expect(derivedSafety.contraindications).toEqual(analysis.technicalCutPlan?.contraindications);
    expect(derivedSafety.contraindications).not.toBe(analysis.technicalCutPlan?.contraindications);

    // The separation is real, not merely typed: neither array is reachable
    // anywhere under observations.
    const observationKeys = collectKeys(observations);
    expect(observationKeys.has("safetyNotes")).toBe(false);
    expect(observationKeys.has("contraindications")).toBe(false);
    const observationJson = JSON.stringify(observations);
    for (const note of analysis.safetyNotes) {
      expect(observationJson).not.toContain(note);
    }
    for (const contraindication of analysis.technicalCutPlan?.contraindications ?? []) {
      expect(observationJson).not.toContain(contraindication);
    }
  });

  it("8. proposal-intent / engine-narrative fields never leak outside payload into evidenceSnapshot", () => {
    const analysis = baseAnalysis();

    const { evidenceSnapshot } = assembleCuttingProposalCreationInput(analysis);

    const forbiddenKeys = [
      "targetShape",
      "cuttingTechnique",
      "structuralTechnique",
      "elevation",
      "distribution",
      "sectioning",
      "texturizingTechnique",
      "cuttingSteps",
      "confidence",
      "stylistExplanation",
      "clientExplanation",
      "professionalReason",
      "guideline",
      "warnings",
      "assumptions",
      "missingData",
      "recommendations",
      "notes",
      "stylistValidationDisclaimer",
    ];
    const presentKeys = collectKeys(evidenceSnapshot);
    for (const key of forbiddenKeys) {
      expect(presentKeys.has(key)).toBe(false);
    }

    // Whole-structure serialization carries none of the engine-output values either.
    const json = JSON.stringify(evidenceSnapshot);
    for (const marker of [
      "targetShape",
      "graduated_bob",
      "slice_cutting",
      "structuralTechnique",
      "45_deg_graduation",
      "overdirected_back",
      "diagonal_back",
      "point_cutting",
      "Establish the perimeter guideline",
      "Radial sectioning through the crown",
      "Soft layers that keep length",
      "Graduation controls corner weight",
    ]) {
      expect(json).not.toContain(marker);
    }

    // evidenceSnapshot has exactly the two documented sub-structures.
    expect(Object.keys(evidenceSnapshot).sort()).toEqual(["derivedSafety", "observations"]);
  });

  it("9. sourceImageAssetId / sourceImageAnalysisId mirror the Analysis row, and are exactly null when absent", () => {
    const withImages = assembleCuttingProposalCreationInput(baseAnalysis());
    expect(withImages.sourceImageAssetId).toBe("ia_asset_fixture_001");
    expect(withImages.sourceImageAnalysisId).toBe("ia_analysis_fixture_001");

    const withoutImages = assembleCuttingProposalCreationInput(
      baseAnalysis({ imageAssetId: undefined, imageAnalysisId: undefined }),
    );
    expect(withoutImages.sourceImageAssetId).toBeNull();
    expect(withoutImages.sourceImageAnalysisId).toBeNull();
    expect(Object.is(withoutImages.sourceImageAssetId, null)).toBe(true);
    expect(Object.is(withoutImages.sourceImageAnalysisId, null)).toBe(true);
    expect(withoutImages.sourceImageAssetId).not.toBeUndefined();
    expect(withoutImages.sourceImageAnalysisId).not.toBeUndefined();
  });

  it("10. a malformed persisted plan throws INVALID_TECHNICAL_CUT_PLAN; a missing plan throws MISSING_PLAN", () => {
    // (a) required field present but out of range.
    const badConfidence = catchError(() =>
      assembleCuttingProposalCreationInput(baseAnalysis({ technicalCutPlan: cuttingPlan({ confidence: 1.5 }) })),
    );
    expect(badConfidence).toBeInstanceOf(ProposalAssemblyError);
    expect(badConfidence).toBeInstanceOf(Error);
    expect((badConfidence as ProposalAssemblyError).code).toBe("PROPOSAL_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN");

    // (b) required field dropped entirely.
    const missingSteps = catchError(() =>
      assembleCuttingProposalCreationInput(baseAnalysis({ technicalCutPlan: planMissing("cuttingSteps") })),
    );
    expect(missingSteps).toBeInstanceOf(ProposalAssemblyError);
    expect(missingSteps).toBeInstanceOf(Error);
    expect((missingSteps as ProposalAssemblyError).code).toBe("PROPOSAL_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN");

    // (c) no plan at all.
    const noPlanAnalysis = baseAnalysis({ technicalCutPlan: undefined });
    const missingPlan = catchError(() => assembleCuttingProposalCreationInput(noPlanAnalysis));
    expect(missingPlan).toBeInstanceOf(ProposalAssemblyError);
    expect(missingPlan).toBeInstanceOf(Error);
    expect((missingPlan as ProposalAssemblyError).code).toBe("PROPOSAL_ASSEMBLY_MISSING_PLAN");
    expect((missingPlan as Error).message).toContain(noPlanAnalysis.id);
  });

  it("11. the assembler does no I/O: it returns synchronously (never a Promise), is not async, and never mutates its argument", () => {
    const analysis = baseAnalysis();
    const before = JSON.stringify(analysis);

    const result: ProposalCreationInput = assembleCuttingProposalCreationInput(analysis);

    // A synchronous return value -- not a Promise, not a thenable. If the
    // function did any async work at all this would be a Promise.
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
    // An async function's constructor is AsyncFunction; a synchronous one's is Function.
    expect(assembleCuttingProposalCreationInput.constructor.name).toBe("Function");

    // Pure transform: the input Analysis is untouched.
    assembleCuttingProposalCreationInput(analysis);
    expect(JSON.stringify(analysis)).toBe(before);
  });
});
