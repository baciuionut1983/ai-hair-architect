import { describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import type { ProposalEditEntry } from "@/lib/proposal-validators";
import type { ProposalRecord } from "@/lib/proposal-repository";
import {
  assembleCuttingTechnicalVisualMap,
  TECHNICAL_VISUAL_MAP_GENERATOR_VERSION,
  TECHNICAL_VISUAL_MAP_SCHEMA_VERSION,
  TechnicalVisualMapAssemblyError,
} from "./technical-visual-map-assembler";
import { HEAD_ZONES } from "./technical-visual-map-validators";

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
        zone: "Baseline guideline",
        action: "Establish the perimeter guideline",
        elevationAngle: "45_deg_graduation",
        toolRequired: "shears",
      },
    ],
    stylistExplanation: "x",
    clientExplanation: "x",
    professionalReason: "x",
    warnings: ["Wavy texture springs up roughly 1cm once dry."],
    contraindications: ["Client reports mild scalp sensitivity in the occipital area."],
    assumptions: ["Hair assessed dry, in natural fall."],
    missingData: [],
    confidence: 0.82,
    stylistValidationDisclaimer: "x",
    version: "1.0.0-m8",
    ...overrides,
  };
}

function edit(overrides: Partial<ProposalEditEntry> = {}): ProposalEditEntry {
  return {
    field: "elevation",
    previousValue: "45_deg_graduation",
    newValue: "90_deg_uniform_layer",
    source: "stylist_confirmed",
    ...overrides,
  };
}

function proposalRecord(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "proposal-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisId: "analysis-1",
    vertical: "cutting",
    status: "CONFIRMED",
    analysisSnapshotAt: "2026-01-01T00:00:00.000Z",
    sourceImageAssetId: "asset-1",
    sourceImageAnalysisId: "image-analysis-1",
    engineVersion: "1.0.0-m8",
    evidenceSnapshot: {
      observations: {
        hairType: "medium",
        density: "medium",
        porosity: "medium",
        hairCondition: null,
        hairTexture: "wavy",
        hairLength: "long",
        growthPattern: null,
        faceShape: "oval",
        headShape: "flat_occipital",
      },
      derivedSafety: {
        safetyNotes: ["Perform a strand test before any chemical service."],
        contraindications: ["Client reports mild scalp sensitivity in the occipital area."],
      },
    },
    payload: cuttingPlan(),
    edits: [],
    consideredMemory: [],
    primaryConsultationMessageId: null,
    promotedConsultationSources: [],
    supersededByProposalId: null,
    confirmedByUserId: "owner-1",
    confirmedAt: "2026-01-02T00:00:00.000Z",
    rejectedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("assembleCuttingTechnicalVisualMap", () => {
  it("11. a CONFIRMED cutting proposal assembles deterministically", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    expect(result.payload.globalIntent.structuralTechnique).toBe("graduation");
    expect(result.schemaVersion).toBe(TECHNICAL_VISUAL_MAP_SCHEMA_VERSION);
    expect(result.generatorVersion).toBe(TECHNICAL_VISUAL_MAP_GENERATOR_VERSION);
  });

  it("12. the same input produces a deep-equivalent output on repeated calls", () => {
    const proposal = proposalRecord();
    const first = assembleCuttingTechnicalVisualMap(proposal);
    const second = assembleCuttingTechnicalVisualMap(proposal);
    expect(second).toEqual(first);
  });

  it("13. a DRAFT proposal is rejected", () => {
    const error = catchError(() => assembleCuttingTechnicalVisualMap(proposalRecord({ status: "DRAFT" })));
    expect(error).toBeInstanceOf(TechnicalVisualMapAssemblyError);
    expect((error as TechnicalVisualMapAssemblyError).code).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED");
  });

  it("14. a SUPERSEDED proposal is rejected (and REJECTED, for completeness)", () => {
    for (const status of ["SUPERSEDED", "REJECTED"] as const) {
      const error = catchError(() => assembleCuttingTechnicalVisualMap(proposalRecord({ status })));
      expect(error).toBeInstanceOf(TechnicalVisualMapAssemblyError);
      expect((error as TechnicalVisualMapAssemblyError).code).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_PROPOSAL_NOT_CONFIRMED");
    }
  });

  it("15. an unsupported vertical is rejected", () => {
    const error = catchError(() => assembleCuttingTechnicalVisualMap(proposalRecord({ vertical: "color" as never })));
    expect(error).toBeInstanceOf(TechnicalVisualMapAssemblyError);
    expect((error as TechnicalVisualMapAssemblyError).code).toBe("TECHNICAL_VISUAL_MAP_ASSEMBLY_UNSUPPORTED_VERTICAL");
  });

  it("16. a malformed effective payload (an edit producing an invalid enum value) is rejected", () => {
    const proposal = proposalRecord({
      edits: [edit({ field: "elevation", newValue: "not_a_real_elevation" })],
    });
    const error = catchError(() => assembleCuttingTechnicalVisualMap(proposal));
    expect(error).toBeInstanceOf(TechnicalVisualMapAssemblyError);
    expect((error as TechnicalVisualMapAssemblyError).code).toBe(
      "TECHNICAL_VISUAL_MAP_ASSEMBLY_INVALID_TECHNICAL_CUT_PLAN",
    );
  });

  it("17. produces exactly the six-zone skeleton, each zone appearing once", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    expect(result.payload.zones).toHaveLength(6);
    expect(result.payload.zones.map((z) => z.zone).sort()).toEqual([...HEAD_ZONES].sort());
  });

  it("18. never invents a zone length (every zone's lengthIntent is 'unspecified')", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    for (const zone of result.payload.zones) {
      expect(zone.lengthIntent).toBe("unspecified");
      expect(zone.lengthIntentSource).toBe("global_default");
    }
  });

  it("19. never invents a zone relationship (relationships is always empty at assembly time)", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    expect(result.payload.relationships).toEqual([]);
  });

  it("20. never invents a density-sensitive zone, even when global evidence suggests fragility", () => {
    const proposal = proposalRecord({
      evidenceSnapshot: {
        observations: { hairCondition: "fragile_breakage" },
        derivedSafety: { safetyNotes: [], contraindications: [] },
      },
    });
    const result = assembleCuttingTechnicalVisualMap(proposal);
    for (const zone of result.payload.zones) {
      expect(zone.densitySensitive).toBe(false);
      expect(zone.densitySensitiveSource).toBe("global_default");
    }
  });

  it("21. never invents zone-specific elevation, distribution, or texturizing overrides", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    for (const zone of result.payload.zones) {
      expect(zone.elevationOverride).toBeUndefined();
      expect(zone.distributionOverride).toBeUndefined();
      expect(zone.texturizingApplicable).toBeUndefined();
      expect(zone.preserve).toBe(false);
    }
  });

  it("22. legitimate global intent is preserved globally, reflecting the EFFECTIVE plan (edits included), never smeared into zones", () => {
    const proposal = proposalRecord({
      edits: [edit({ field: "elevation", newValue: "90_deg_uniform_layer" })],
    });
    const result = assembleCuttingTechnicalVisualMap(proposal);
    expect(result.payload.globalIntent.elevation).toBe("90_deg_uniform_layer");
    // Not smeared into zones -- no zone carries an elevationOverride merely
    // because the global value changed.
    for (const zone of result.payload.zones) {
      expect(zone.elevationOverride).toBeUndefined();
    }
  });

  it("23. only legitimate, mechanically-derived constraints are produced -- respect_contraindication, one per frozen contraindication, nothing else", () => {
    const proposal = proposalRecord({
      evidenceSnapshot: {
        observations: {},
        derivedSafety: {
          safetyNotes: [],
          contraindications: ["Do not execute aggressive thinning on high-frizz curl patterns.", "Avoid razor-based carving on fragile hair."],
        },
      },
    });
    const result = assembleCuttingTechnicalVisualMap(proposal);
    expect(result.payload.preserveConstraints).toHaveLength(2);
    for (const constraint of result.payload.preserveConstraints) {
      expect(constraint.type).toBe("respect_contraindication");
      expect(constraint.source).toBe("deterministic_evidence");
    }
    const types = new Set(result.payload.preserveConstraints.map((c) => c.type));
    expect(types.has("preserve_identity")).toBe(false);
    expect(types.has("preserve_face_proportions")).toBe(false);
    expect(types.has("preserve_hairline")).toBe(false);
    expect(types.has("preserve_density_sensitive_area")).toBe(false);
    expect(types.has("preserve_perimeter_weight")).toBe(false);
    expect(types.has("do_not_modify_unrelated_appearance")).toBe(false);
  });

  it("23b. produces zero constraints when the proposal has no contraindications", () => {
    const proposal = proposalRecord({
      evidenceSnapshot: { observations: {}, derivedSafety: { safetyNotes: [], contraindications: [] } },
    });
    const result = assembleCuttingTechnicalVisualMap(proposal);
    expect(result.payload.preserveConstraints).toEqual([]);
  });

  it("24. source image references are inherited from the proposal, including when absent (null)", () => {
    const withImages = assembleCuttingTechnicalVisualMap(proposalRecord());
    expect(withImages.sourceImageAssetId).toBe("asset-1");
    expect(withImages.sourceImageAnalysisId).toBe("image-analysis-1");

    const withoutImages = assembleCuttingTechnicalVisualMap(
      proposalRecord({ sourceImageAssetId: null, sourceImageAnalysisId: null }),
    );
    expect(withoutImages.sourceImageAssetId).toBeNull();
    expect(withoutImages.sourceImageAnalysisId).toBeNull();
  });

  it("25. schemaVersion is frozen to the assembler's own constant", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    expect(result.schemaVersion).toBe("1.0.0");
  });

  it("26. generatorVersion is frozen to the assembler's own constant", () => {
    const result = assembleCuttingTechnicalVisualMap(proposalRecord());
    expect(result.generatorVersion).toBe("1.0.0-tvm1");
  });

  it("27. performs zero AI/provider calls -- returns synchronously, never a Promise, and never mutates its argument", () => {
    const proposal = proposalRecord();
    const before = JSON.stringify(proposal);

    const result = assembleCuttingTechnicalVisualMap(proposal);

    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof (result as unknown as { then?: unknown }).then).not.toBe("function");
    expect(assembleCuttingTechnicalVisualMap.constructor.name).toBe("Function");
    expect(JSON.stringify(proposal)).toBe(before);
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}
