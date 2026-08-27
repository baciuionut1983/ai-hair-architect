import { describe, expect, it } from "vitest";

import { buildProposalEditEntries } from "./proposed-look-edit-form-logic";
import { EDITABLE_CUTTING_FIELDS, type EditableCuttingField, type EffectiveCuttingFieldValue } from "./proposed-look-logic";

// A pristine effective-fields list: every field's effectiveValue equals its
// baseline and nothing has been edited yet.
function baseEffective(): EffectiveCuttingFieldValue[] {
  return [
    { field: "structuralTechnique", baselineValue: "graduation", effectiveValue: "graduation", wasEdited: false },
    { field: "cuttingTechnique", baselineValue: "slice_cutting", effectiveValue: "slice_cutting", wasEdited: false },
    { field: "texturizingTechnique", baselineValue: "point_cutting", effectiveValue: "point_cutting", wasEdited: false },
    { field: "sectioning", baselineValue: "diagonal_back", effectiveValue: "diagonal_back", wasEdited: false },
    { field: "elevation", baselineValue: "45_deg_graduation", effectiveValue: "45_deg_graduation", wasEdited: false },
    { field: "distribution", baselineValue: "overdirected_back", effectiveValue: "overdirected_back", wasEdited: false },
    { field: "guideline", baselineValue: "traveling", effectiveValue: "traveling", wasEdited: false },
  ];
}

function formFrom(
  effective: EffectiveCuttingFieldValue[],
  overrides: Partial<Record<EditableCuttingField, string>> = {},
): Record<EditableCuttingField, string> {
  const values = {} as Record<EditableCuttingField, string>;
  for (const entry of effective) {
    values[entry.field] = entry.effectiveValue;
  }
  return { ...values, ...overrides };
}

describe("buildProposalEditEntries", () => {
  it("returns [] when no field differs from its current effective value", () => {
    const effective = baseEffective();
    expect(buildProposalEditEntries(effective, formFrom(effective), "stylist_confirmed", undefined)).toEqual([]);
  });

  it("returns one entry with the correct previousValue/newValue/source for a single changed field", () => {
    const effective = baseEffective();
    const form = formFrom(effective, { elevation: "90_deg_uniform_layer" });

    const entries = buildProposalEditEntries(effective, form, "stylist_confirmed", undefined);

    expect(entries).toEqual([
      {
        field: "elevation",
        previousValue: "45_deg_graduation",
        newValue: "90_deg_uniform_layer",
        source: "stylist_confirmed",
      },
    ]);
  });

  it("returns multiple entries in EDITABLE_CUTTING_FIELDS order", () => {
    const effective = baseEffective();
    const form = formFrom(effective, {
      guideline: "stationary",
      structuralTechnique: "one_length",
      elevation: "0_deg_blunt",
    });

    const entries = buildProposalEditEntries(effective, form, "stylist_confirmed", undefined);

    expect(entries.map((entry) => entry.field)).toEqual(["structuralTechnique", "elevation", "guideline"]);
    // and that ordering is exactly EDITABLE_CUTTING_FIELDS' relative order
    const order = EDITABLE_CUTTING_FIELDS.filter((field) =>
      ["structuralTechnique", "elevation", "guideline"].includes(field),
    );
    expect(entries.map((entry) => entry.field)).toEqual(order);
  });

  it("includes a provided reason on every emitted entry", () => {
    const effective = baseEffective();
    const form = formFrom(effective, { elevation: "90_deg_uniform_layer", guideline: "stationary" });

    const entries = buildProposalEditEntries(effective, form, "stylist_confirmed", "client wants softer layers");

    expect(entries).toEqual([
      {
        field: "elevation",
        previousValue: "45_deg_graduation",
        newValue: "90_deg_uniform_layer",
        source: "stylist_confirmed",
        reason: "client wants softer layers",
      },
      {
        field: "guideline",
        previousValue: "traveling",
        newValue: "stationary",
        source: "stylist_confirmed",
        reason: "client wants softer layers",
      },
    ]);
  });

  it("omits the reason key entirely when no reason is provided (not reason: undefined)", () => {
    const effective = baseEffective();
    const form = formFrom(effective, { elevation: "90_deg_uniform_layer" });

    const [entry] = buildProposalEditEntries(effective, form, "stylist_confirmed", undefined);

    expect("reason" in entry).toBe(false);
  });

  it("omits the reason key entirely when the reason is an empty or whitespace-only string", () => {
    const effective = baseEffective();
    const form = formFrom(effective, { elevation: "90_deg_uniform_layer" });

    const [emptyEntry] = buildProposalEditEntries(effective, form, "stylist_confirmed", "");
    const [blankEntry] = buildProposalEditEntries(effective, form, "stylist_confirmed", "   ");

    expect("reason" in emptyEntry).toBe(false);
    expect("reason" in blankEntry).toBe(false);
  });

  it("compares against an ALREADY-EDITED currentEffective, not the original baseline", () => {
    // elevation was edited in a PRIOR save: baseline 45deg, current effective 90deg.
    const effective = baseEffective().map((entry) =>
      entry.field === "elevation"
        ? { ...entry, effectiveValue: "90_deg_uniform_layer", wasEdited: true, editReason: "prior save" }
        : entry,
    );

    // The form still shows the already-edited value -> no no-op duplicate entry.
    const unchangedForm = formFrom(effective);
    expect(buildProposalEditEntries(effective, unchangedForm, "stylist_confirmed", undefined)).toEqual([]);

    // Re-changing it -> previousValue is the CURRENT effective value, not the baseline.
    const changedForm = formFrom(effective, { elevation: "135_deg_long_layer" });
    const [entry] = buildProposalEditEntries(effective, changedForm, "stylist_confirmed", undefined);
    expect(entry.previousValue).toBe("90_deg_uniform_layer");
    expect(entry.newValue).toBe("135_deg_long_layer");
  });
});
