import { describe, expect, it } from "vitest";

import type { TechnicalCutPlan } from "@/lib/contracts";
import type { ProposalEditEntry } from "@/lib/proposal-validators";
import type { ProposalRecord } from "@/lib/proposal-repository";

import {
  computeEffectiveCuttingFields,
  EDITABLE_CUTTING_FIELDS,
  findExistingDraft,
  isConfirmedProposalPotentiallyStale,
  mapProposedLookApiError,
  resolveProposedLookLoadStatus,
} from "./proposed-look-logic";

function cuttingPlan(overrides: Partial<TechnicalCutPlan> = {}): TechnicalCutPlan {
  return {
    structuralTechnique: "graduation",
    cuttingTechnique: "slice_cutting",
    texturizingTechnique: "point_cutting",
    sectioning: "diagonal_back",
    elevation: "45_deg_graduation",
    distribution: "overdirected_back",
    guideline: "traveling",
    cuttingSteps: [],
    stylistExplanation: "x",
    clientExplanation: "x",
    professionalReason: "x",
    warnings: [],
    contraindications: [],
    assumptions: [],
    missingData: [],
    confidence: 0.8,
    stylistValidationDisclaimer: "x",
    version: "cut-engine-2.3.1",
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

function proposal(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "proposal-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisId: "analysis-1",
    vertical: "cutting",
    status: "DRAFT",
    analysisSnapshotAt: "2026-01-01T00:00:00.000Z",
    sourceImageAssetId: null,
    sourceImageAnalysisId: null,
    engineVersion: "cut-engine-2.3.1",
    evidenceSnapshot: {},
    payload: cuttingPlan(),
    edits: [],
    consideredMemory: [],
    primaryConsultationMessageId: null,
    promotedConsultationSources: [],
    supersededByProposalId: null,
    confirmedByUserId: null,
    confirmedAt: null,
    rejectedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveProposedLookLoadStatus", () => {
  it("returns ready for an ok response", () => {
    expect(resolveProposedLookLoadStatus({ ok: true, status: 200 })).toBe("ready");
  });

  it("returns error for a 404", () => {
    expect(resolveProposedLookLoadStatus({ ok: false, status: 404 })).toBe("error");
  });

  it("returns error for a 500", () => {
    expect(resolveProposedLookLoadStatus({ ok: false, status: 500 })).toBe("error");
  });

  it("returns error for a 503", () => {
    expect(resolveProposedLookLoadStatus({ ok: false, status: 503 })).toBe("error");
  });
});

describe("computeEffectiveCuttingFields", () => {
  it("with no edits, every field's effectiveValue equals baselineValue and wasEdited is false", () => {
    const plan = cuttingPlan();
    const result = computeEffectiveCuttingFields(plan, []);

    expect(result).toHaveLength(EDITABLE_CUTTING_FIELDS.length);
    for (const entry of result) {
      expect(entry.effectiveValue).toBe(entry.baselineValue);
      expect(entry.wasEdited).toBe(false);
      expect(entry.editReason).toBeUndefined();
    }
  });

  it("with edits on some but not all fields, only touched fields show wasEdited true", () => {
    const plan = cuttingPlan();
    const edits = [edit({ field: "elevation", newValue: "90_deg_uniform_layer" })];

    const result = computeEffectiveCuttingFields(plan, edits);

    const elevationEntry = result.find((r) => r.field === "elevation")!;
    expect(elevationEntry.wasEdited).toBe(true);
    expect(elevationEntry.effectiveValue).toBe("90_deg_uniform_layer");
    expect(elevationEntry.baselineValue).toBe("45_deg_graduation");

    for (const entry of result) {
      if (entry.field !== "elevation") {
        expect(entry.wasEdited).toBe(false);
        expect(entry.effectiveValue).toBe(entry.baselineValue);
      }
    }
  });

  it("with multiple edits on the SAME field, the LAST one in array order wins", () => {
    const plan = cuttingPlan();
    const edits = [
      edit({ field: "elevation", newValue: "90_deg_uniform_layer" }),
      edit({ field: "elevation", newValue: "135_deg_long_layer", reason: "client asked for softer perimeter" }),
    ];

    const result = computeEffectiveCuttingFields(plan, edits);
    const elevationEntry = result.find((r) => r.field === "elevation")!;

    expect(elevationEntry.effectiveValue).toBe("135_deg_long_layer");
    expect(elevationEntry.editReason).toBe("client asked for softer perimeter");
  });

  it("when texturizingTechnique is undefined on the payload and no edit touches it, baseline/effective are both empty string", () => {
    const plan = cuttingPlan({ texturizingTechnique: undefined });

    const result = computeEffectiveCuttingFields(plan, []);
    const texturizingEntry = result.find((r) => r.field === "texturizingTechnique")!;

    expect(texturizingEntry.baselineValue).toBe("");
    expect(texturizingEntry.effectiveValue).toBe("");
    expect(texturizingEntry.wasEdited).toBe(false);
  });

  it("does not mutate its inputs", () => {
    const plan = cuttingPlan();
    const edits = [edit()];
    const planBefore = JSON.stringify(plan);
    const editsBefore = JSON.stringify(edits);

    computeEffectiveCuttingFields(plan, edits);

    expect(JSON.stringify(plan)).toBe(planBefore);
    expect(JSON.stringify(edits)).toBe(editsBefore);
  });
});

describe("isConfirmedProposalPotentiallyStale", () => {
  it("same analysis corrected after the proposal snapshotted it -> true", () => {
    const snapshotAt = "2026-01-01T00:00:00.000Z";
    const correctedAt = "2026-01-05T00:00:00.000Z";
    expect(isConfirmedProposalPotentiallyStale(correctedAt, snapshotAt)).toBe(true);
  });

  it("viewing a genuinely newer analysis than the confirmed proposal's source -> true", () => {
    const oldSnapshotAt = "2026-01-01T00:00:00.000Z";
    const newAnalysisUpdatedAt = "2026-03-01T00:00:00.000Z";
    expect(isConfirmedProposalPotentiallyStale(newAnalysisUpdatedAt, oldSnapshotAt)).toBe(true);
  });

  it("viewing an older analysis than what already backs a newer confirmed proposal -> false", () => {
    const oldAnalysisUpdatedAt = "2026-01-01T00:00:00.000Z";
    const newerSnapshotAt = "2026-03-01T00:00:00.000Z";
    expect(isConfirmedProposalPotentiallyStale(oldAnalysisUpdatedAt, newerSnapshotAt)).toBe(false);
  });

  it("equal timestamps -> false", () => {
    const t = "2026-01-01T00:00:00.000Z";
    expect(isConfirmedProposalPotentiallyStale(t, t)).toBe(false);
  });
});

describe("mapProposedLookApiError", () => {
  it("401 -> sign-in message", () => {
    expect(mapProposedLookApiError(401)).toBe("Please sign in again.");
  });

  it("404 -> no-longer-available message", () => {
    expect(mapProposedLookApiError(404)).toBe("This proposal is no longer available.");
  });

  it("409 ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT -> the conflict-specific message", () => {
    expect(mapProposedLookApiError(409, "ANALYSIS_PROPOSAL_CONFIRMATION_CONFLICT")).toBe(
      "Another proposal was confirmed while this draft was open. Review the current confirmed look, then try again if you still want to replace it.",
    );
  });

  it("409 PROPOSAL_ILLEGAL_STATE_TRANSITION -> the not-a-draft message", () => {
    expect(mapProposedLookApiError(409, "PROPOSAL_ILLEGAL_STATE_TRANSITION")).toBe(
      "This proposal is no longer a draft, so it can't be changed.",
    );
  });

  it("400 -> the review-and-retry message", () => {
    expect(mapProposedLookApiError(400)).toBe(
      "This request could not be completed with the current data. Please review and try again.",
    );
  });

  it("422 -> the review-and-retry message", () => {
    expect(mapProposedLookApiError(422)).toBe(
      "This request could not be completed with the current data. Please review and try again.",
    );
  });

  it("503 -> the temporarily-unavailable message", () => {
    expect(mapProposedLookApiError(503)).toBe("The proposal service is temporarily unavailable. Please try again shortly.");
  });

  it("an unmapped status -> the generic fallback message", () => {
    expect(mapProposedLookApiError(418)).toBe("Something went wrong. Please try again.");
  });
});

describe("findExistingDraft", () => {
  it("returns the DRAFT proposal when one is present", () => {
    const draft = proposal({ id: "p-draft", status: "DRAFT" });
    const history = [proposal({ id: "p-confirmed", status: "CONFIRMED" }), draft];

    expect(findExistingDraft(history)).toEqual(draft);
  });

  it("returns null when only CONFIRMED/REJECTED/SUPERSEDED proposals exist", () => {
    const history = [
      proposal({ id: "p1", status: "CONFIRMED" }),
      proposal({ id: "p2", status: "REJECTED" }),
      proposal({ id: "p3", status: "SUPERSEDED" }),
    ];

    expect(findExistingDraft(history)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(findExistingDraft([])).toBeNull();
  });
});
