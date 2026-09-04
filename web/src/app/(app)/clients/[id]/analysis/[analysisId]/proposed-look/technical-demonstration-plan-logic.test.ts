import { describe, expect, it } from "vitest";

import type { TechnicalDemonstrationPlanRecord, TechnicalDemonstrationStepRecord } from "@/lib/technical-demonstration-contracts";

import {
  CUTTING_STEP_FIELD_EDITORS,
  findExistingDraftPlan,
  isProvenanceNotApplicable,
  isProvenancePopulated,
  mapTechnicalDemonstrationPlanApiError,
  resolveCuttingStepFieldEditor,
  resolveStepConstraints,
  resolveStepFieldRows,
  resolveTechnicalDemonstrationPlanLoadStatus,
  shouldShowTechnicalDemonstrationConfirmConflictMessage,
  technicalDemonstrationProvenanceLabel,
  zoneOptionsForEditor,
} from "./technical-demonstration-plan-logic";
import { CUTTING_STEP_OVERRIDE_FIELD_NAMES } from "@/lib/technical-demonstration-cutting-overrides";
import { getTechnicalDemonstrationPlanStatusBadgeVariant, getTechnicalDemonstrationPlanStatusLabel } from "./technical-demonstration-plan-status-badge";
import { getTechnicalDemonstrationProvenanceBadgeVariant } from "./technical-demonstration-provenance-badge";
import type { TechnicalDemonstrationPlanActionOutcome } from "./use-technical-demonstration-plan";

// Technical Demonstration, Stage 2 -- pure logic tests. No I/O, no
// rendering environment, mirrors technical-visual-map-logic.test.ts's own
// established convention.

function plan(overrides: Partial<TechnicalDemonstrationPlanRecord> = {}): TechnicalDemonstrationPlanRecord {
  return {
    id: "plan-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisProposalId: "proposal-1",
    analysisProposalConfirmedAt: "2026-01-01T00:00:00.000Z",
    vertical: "cutting",
    status: "DRAFT",
    planVersion: 1,
    schemaVersion: "1.0.0-td1",
    generatorVersion: "1.0.0-td1",
    requestFingerprint: "fp",
    professionalOverrides: [],
    supersededByPlanId: null,
    confirmedAt: null,
    supersededAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function step(payloadOverrides: Record<string, unknown> = {}, overrides: Partial<TechnicalDemonstrationStepRecord> = {}): TechnicalDemonstrationStepRecord {
  const basePayload = {
    zones: { value: null, provenance: "UNKNOWN" },
    sectioning: { value: null, provenance: "UNKNOWN" },
    guideType: { value: null, provenance: "UNKNOWN" },
    structuralTechnique: { value: null, provenance: "UNKNOWN" },
    cuttingTechnique: { value: null, provenance: "UNKNOWN" },
    texturizingTechnique: { value: null, provenance: "UNKNOWN" },
    combingDirection: { value: null, provenance: "UNKNOWN" },
    overdirection: { value: null, provenance: "UNKNOWN" },
    headBodyPositioning: { value: null, provenance: "UNKNOWN" },
    fingerPosition: { value: null, provenance: "UNKNOWN" },
    cuttingAngle: { value: null, provenance: "UNKNOWN" },
    cuttingLine: { value: null, provenance: "UNKNOWN" },
    subsectioning: { value: null, provenance: "UNKNOWN" },
    zoneConnection: { value: null, provenance: "UNKNOWN" },
    crossCheck: { value: null, provenance: "UNKNOWN" },
    styling: { value: null, provenance: "UNKNOWN" },
    tool: { value: null, provenance: "UNKNOWN" },
    constraints: [],
    ...payloadOverrides,
  };
  return {
    id: "step-1",
    ownerUserId: "owner-1",
    clientId: "client-1",
    planId: "plan-1",
    vertical: "cutting",
    stepNumber: 1,
    stepSchemaVersion: "1.0.0-td1",
    payload: basePayload,
    explanation: "Establish the guideline.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveTechnicalDemonstrationPlanLoadStatus", () => {
  it("maps ok responses to ready and non-ok to error", () => {
    expect(resolveTechnicalDemonstrationPlanLoadStatus({ ok: true, status: 200 })).toBe("ready");
    expect(resolveTechnicalDemonstrationPlanLoadStatus({ ok: false, status: 500 })).toBe("error");
  });
});

describe("findExistingDraftPlan", () => {
  it("finds the single DRAFT plan in a mixed history", () => {
    const draft = plan({ id: "plan-2", status: "DRAFT" });
    const history = [plan({ id: "plan-1", status: "SUPERSEDED" }), draft];
    expect(findExistingDraftPlan(history)).toBe(draft);
  });

  it("returns null when there is no draft", () => {
    expect(findExistingDraftPlan([plan({ status: "CONFIRMED" })])).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(findExistingDraftPlan([])).toBeNull();
  });
});

describe("mapTechnicalDemonstrationPlanApiError", () => {
  it("maps every documented status/code combination to a distinct, safe message", () => {
    expect(mapTechnicalDemonstrationPlanApiError(401)).toBe("Please sign in again.");
    expect(mapTechnicalDemonstrationPlanApiError(404)).toContain("no longer available");
    expect(mapTechnicalDemonstrationPlanApiError(409, "TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT")).toContain("Another Technical Demonstration Plan");
    expect(mapTechnicalDemonstrationPlanApiError(409, "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION")).toContain("no longer a draft");
    expect(mapTechnicalDemonstrationPlanApiError(422)).toContain("could not be completed");
    expect(mapTechnicalDemonstrationPlanApiError(503)).toContain("temporarily unavailable");
    expect(mapTechnicalDemonstrationPlanApiError(0)).toBe("Something went wrong. Please try again.");
  });
});

describe("shouldShowTechnicalDemonstrationConfirmConflictMessage", () => {
  it("returns the message only for the exact confirmation-conflict outcome", () => {
    const conflict: TechnicalDemonstrationPlanActionOutcome = {
      ok: false,
      status: 409,
      code: "TECHNICAL_DEMONSTRATION_CONFIRMATION_CONFLICT",
      message: "conflict message",
    };
    expect(shouldShowTechnicalDemonstrationConfirmConflictMessage(conflict)).toBe("conflict message");
  });

  it("returns null for a success outcome", () => {
    const success: TechnicalDemonstrationPlanActionOutcome = { ok: true, plan: plan(), steps: [], effectiveSteps: [] };
    expect(shouldShowTechnicalDemonstrationConfirmConflictMessage(success)).toBeNull();
  });

  it("returns null for a different 409 (a real error, not a recoverable race)", () => {
    const stateError: TechnicalDemonstrationPlanActionOutcome = {
      ok: false,
      status: 409,
      code: "TECHNICAL_DEMONSTRATION_ILLEGAL_STATE_TRANSITION",
      message: "state error",
    };
    expect(shouldShowTechnicalDemonstrationConfirmConflictMessage(stateError)).toBeNull();
  });
});

// Required tests 6-9: provenance display.
describe("provenance labels and badge variants", () => {
  it("6. OBSERVED displays with its own distinct label and a confident (success) badge variant", () => {
    expect(technicalDemonstrationProvenanceLabel("OBSERVED")).toBe("Observed");
    expect(getTechnicalDemonstrationProvenanceBadgeVariant("OBSERVED")).toBe("success");
  });

  it("7. INFERRED displays with its own distinct label and a neutral badge variant", () => {
    expect(technicalDemonstrationProvenanceLabel("INFERRED")).toBe("Inferred");
    expect(getTechnicalDemonstrationProvenanceBadgeVariant("INFERRED")).toBe("neutral");
  });

  it("8. UNKNOWN displays honestly -- 'Not yet available', never worded or styled as an error", () => {
    expect(technicalDemonstrationProvenanceLabel("UNKNOWN")).toBe("Not yet available");
    expect(technicalDemonstrationProvenanceLabel("UNKNOWN")).not.toMatch(/error|fail/i);
    expect(getTechnicalDemonstrationProvenanceBadgeVariant("UNKNOWN")).not.toBe("danger");
  });

  it("9. PROFESSIONAL_OVERRIDE displays distinctly from every other provenance, with its own warning badge variant", () => {
    expect(technicalDemonstrationProvenanceLabel("PROFESSIONAL_OVERRIDE")).toBe("Professional override");
    expect(getTechnicalDemonstrationProvenanceBadgeVariant("PROFESSIONAL_OVERRIDE")).toBe("warning");
    // Distinct from every other provenance's own variant.
    expect(getTechnicalDemonstrationProvenanceBadgeVariant("PROFESSIONAL_OVERRIDE")).not.toBe(getTechnicalDemonstrationProvenanceBadgeVariant("OBSERVED"));
    expect(getTechnicalDemonstrationProvenanceBadgeVariant("PROFESSIONAL_OVERRIDE")).not.toBe(getTechnicalDemonstrationProvenanceBadgeVariant("INFERRED"));
  });
});

describe("isProvenancePopulated", () => {
  it("is true for OBSERVED/INFERRED/PROFESSIONAL_OVERRIDE, false for UNKNOWN and for a missing entry", () => {
    expect(isProvenancePopulated({ provenance: "OBSERVED" })).toBe(true);
    expect(isProvenancePopulated({ provenance: "INFERRED" })).toBe(true);
    expect(isProvenancePopulated({ provenance: "PROFESSIONAL_OVERRIDE" })).toBe(true);
    expect(isProvenancePopulated({ provenance: "UNKNOWN" })).toBe(false);
    expect(isProvenancePopulated(null)).toBe(false);
    expect(isProvenancePopulated(undefined)).toBe(false);
  });
});

// Required test 5: ordered steps render from structured data.
describe("resolveStepFieldRows", () => {
  it("5. splits a step's payload into populated (with real values) and unknown (honest, empty) buckets", () => {
    const s = step({
      zones: { value: ["nape"], provenance: "OBSERVED" },
      sectioning: { value: "diagonal_back", provenance: "INFERRED" },
      structuralTechnique: { value: "one_length", provenance: "PROFESSIONAL_OVERRIDE" },
      overdirection: { value: true, provenance: "INFERRED" },
    });
    const { populated, unknown } = resolveStepFieldRows(s.payload);

    const zonesRow = populated.find((row) => row.key === "zones");
    expect(zonesRow).toEqual({ key: "zones", label: "Zone(s)", value: "Nape", provenance: "OBSERVED" });

    const sectioningRow = populated.find((row) => row.key === "sectioning");
    expect(sectioningRow?.value).toBe("Diagonal Back");
    expect(sectioningRow?.provenance).toBe("INFERRED");

    const structuralRow = populated.find((row) => row.key === "structuralTechnique");
    expect(structuralRow?.provenance).toBe("PROFESSIONAL_OVERRIDE");

    const overdirectionRow = populated.find((row) => row.key === "overdirection");
    expect(overdirectionRow?.value).toBe("Yes");

    // Every field never explicitly overridden above stays in the honest
    // "unknown" bucket -- never fabricated, never silently dropped.
    expect(unknown).toContain("Finger position");
    expect(unknown).toContain("Cutting angle");
    expect(unknown.length + populated.length).toBe(27); // the full Cutting V1 field count (CUTTING_STEP_FIELD_DESCRIPTORS, incl. Stage 2.5.a/b/c additions)
  });

  it("never dumps a raw field for an UNKNOWN entry -- unknown fields carry only their label, no value/provenance leakage", () => {
    const s = step();
    const { populated, unknown } = resolveStepFieldRows(s.payload);
    expect(populated).toEqual([]);
    expect(unknown.length).toBe(27);
    expect(unknown.every((label) => typeof label === "string")).toBe(true);
  });

  // Stage 2.5.b -- NOT_APPLICABLE bucket.
  it("splits a NOT_APPLICABLE field into its own honest bucket -- never counted as populated, never counted as unknown", () => {
    const s = step({ crossCheck: { value: null, provenance: "NOT_APPLICABLE" } });
    const { populated, notApplicable, unknown } = resolveStepFieldRows(s.payload);
    expect(populated.find((row) => row.key === "crossCheck")).toBeUndefined();
    expect(notApplicable).toContain("Cross-check");
    expect(unknown).not.toContain("Cross-check");
  });

  it("technicalDemonstrationProvenanceLabel renders NOT_APPLICABLE distinctly from UNKNOWN, never worded as an error", () => {
    expect(technicalDemonstrationProvenanceLabel("NOT_APPLICABLE")).toBe("Not applicable");
    expect(technicalDemonstrationProvenanceLabel("NOT_APPLICABLE")).not.toBe(technicalDemonstrationProvenanceLabel("UNKNOWN"));
    expect(technicalDemonstrationProvenanceLabel("NOT_APPLICABLE")).not.toMatch(/error|fail/i);
  });

  it("isProvenanceNotApplicable is true only for a real NOT_APPLICABLE entry", () => {
    expect(isProvenanceNotApplicable({ provenance: "NOT_APPLICABLE" })).toBe(true);
    expect(isProvenanceNotApplicable({ provenance: "UNKNOWN" })).toBe(false);
    expect(isProvenanceNotApplicable({ provenance: "OBSERVED" })).toBe(false);
    expect(isProvenanceNotApplicable(null)).toBe(false);
  });

  it("isProvenancePopulated is false for NOT_APPLICABLE, same as UNKNOWN", () => {
    expect(isProvenancePopulated({ provenance: "NOT_APPLICABLE" })).toBe(false);
  });
});

// Stage 2.5.b -- field editor descriptors.
describe("CUTTING_STEP_FIELD_EDITORS", () => {
  it("has exactly one editor descriptor per real, closed override field name -- never more, never fewer", () => {
    const editorKeys = CUTTING_STEP_FIELD_EDITORS.map((e) => e.key).sort();
    const overrideFieldNames = [...CUTTING_STEP_OVERRIDE_FIELD_NAMES].sort();
    expect(editorKeys).toEqual(overrideFieldNames);
  });

  it("never includes `phase` or `constraints` -- the two deliberately non-editable fields", () => {
    const editorKeys = CUTTING_STEP_FIELD_EDITORS.map((e) => e.key);
    expect(editorKeys).not.toContain("phase");
    expect(editorKeys).not.toContain("constraints");
  });

  it("every 'select' kind editor carries a real, non-empty options list", () => {
    for (const editor of CUTTING_STEP_FIELD_EDITORS) {
      if (editor.kind === "select") {
        expect(editor.options).toBeDefined();
        expect(editor.options!.length).toBeGreaterThan(0);
      }
    }
  });

  it("resolveCuttingStepFieldEditor returns the exact registered descriptor for a real field", () => {
    expect(resolveCuttingStepFieldEditor("elevation")).toEqual({ key: "elevation", kind: "select", options: expect.any(Array) });
    expect(resolveCuttingStepFieldEditor("stateBefore")).toEqual({ key: "stateBefore", kind: "text" });
    expect(resolveCuttingStepFieldEditor("overdirection")).toEqual({ key: "overdirection", kind: "boolean" });
    expect(resolveCuttingStepFieldEditor("zones")).toEqual({ key: "zones", kind: "zones" });
  });

  it("zoneOptionsForEditor returns the real, closed HeadZone vocabulary", () => {
    const zones = zoneOptionsForEditor();
    expect(zones).toContain("crown");
    expect(zones).toContain("nape");
    expect(zones.length).toBe(6);
  });
});

describe("resolveStepConstraints", () => {
  it("returns the real constraints array from the payload", () => {
    const s = step({ constraints: ["Perform a strand test."] });
    expect(resolveStepConstraints(s.payload)).toEqual(["Perform a strand test."]);
  });

  it("returns an empty array when constraints is missing/malformed, never throws", () => {
    expect(resolveStepConstraints({})).toEqual([]);
  });
});

describe("plan status badge -- 'TECHNICAL PLAN CONFIRMED' wording", () => {
  it("uses the exact emphatic wording only for CONFIRMED", () => {
    expect(getTechnicalDemonstrationPlanStatusLabel("CONFIRMED")).toBe("TECHNICAL PLAN CONFIRMED");
    expect(getTechnicalDemonstrationPlanStatusLabel("DRAFT")).toBe("Draft");
    expect(getTechnicalDemonstrationPlanStatusLabel("SUPERSEDED")).toBe("Superseded");
  });

  it("gives CONFIRMED a success variant and SUPERSEDED a distinct warning variant", () => {
    expect(getTechnicalDemonstrationPlanStatusBadgeVariant("CONFIRMED")).toBe("success");
    expect(getTechnicalDemonstrationPlanStatusBadgeVariant("SUPERSEDED")).toBe("warning");
    expect(getTechnicalDemonstrationPlanStatusBadgeVariant("DRAFT")).toBe("neutral");
  });
});
