import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import { actionableDeltaEntries, computeHairStateDelta, HAIR_STATE_DELTA_TRANSFORMATIONS, isHairStateDeltaTransformation, type HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";

// Professional Skill Engine, Stage 4 -- HAIR STATE DELTA pure contract
// tests. No I/O, no AI, mirrors hair-state-snapshot-validators.test.ts's
// own conventions.

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}

function snapshot(id: string, snapshotVersion: number, payload: HairStateSnapshotPayload): HairStateSnapshotDeltaInput {
  return { id, snapshotVersion, payload };
}

function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}

describe("computeHairStateDelta (pure)", () => {
  // 1. identical CURRENT/TARGET -> PRESERVED/no-change semantics
  it("1. identical CURRENT and TARGET payloads produce PRESERVED (or UNKNOWN, never a fabricated change) for every field", () => {
    const payload = basePayload();
    const delta = computeHairStateDelta(snapshot("c1", 1, payload), snapshot("t1", 1, payload));
    expect(delta.entries.every((e) => e.transformation === "PRESERVED" || e.transformation === "UNKNOWN")).toBe(true);
    // Every unassessed field (the base fixture) is honestly UNKNOWN, not
    // silently PRESERVED -- nothing here was ever actually stated.
    expect(delta.entries.every((e) => e.transformation === "UNKNOWN")).toBe(true);
  });

  it("1b. a real, matching CURRENT/TARGET value on both sides produces PRESERVED", () => {
    const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
    const target = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "professional_input" } });
    const delta = computeHairStateDelta(snapshot("c1", 1, current), snapshot("t1", 1, target));
    const entry = delta.entries.find((e) => e.scope === "nape" && e.field === "perimeterRelationship");
    expect(entry?.transformation).toBe("PRESERVED");
  });

  // 2. changed categorical state -> deterministic delta
  it("2. a real, ordered categorical change (density low -> high) is deterministically REDUCED/INCREASED, never CHANGED", () => {
    const current = { ...basePayload(), globalState: { ...basePayload().globalState, density: { value: "low" as const, source: "observed" as const } } };
    const target = { ...basePayload(), globalState: { ...basePayload().globalState, density: { value: "high" as const, source: "professional_input" as const } } };
    const delta = computeHairStateDelta(snapshot("c1", 1, current), snapshot("t1", 1, target));
    const entry = delta.entries.find((e) => e.scope === "global" && e.field === "density");
    expect(entry?.transformation).toBe("INCREASED");
  });

  it("2b. an unordered categorical change (texture straight -> curly) is CHANGED, never a fabricated direction", () => {
    const current = { ...basePayload(), globalState: { ...basePayload().globalState, texture: { value: "straight" as const, source: "observed" as const } } };
    const target = { ...basePayload(), globalState: { ...basePayload().globalState, texture: { value: "curly" as const, source: "professional_input" as const } } };
    const delta = computeHairStateDelta(snapshot("c1", 1, current), snapshot("t1", 1, target));
    const entry = delta.entries.find((e) => e.scope === "global" && e.field === "texture");
    expect(entry?.transformation).toBe("CHANGED");
  });

  it("2c. deterministic: the same two payloads always produce the same delta entries (excluding computedAt)", () => {
    const current = withZone(basePayload(), "crown", { density: { value: "high", source: "observed" } });
    const target = withZone(basePayload(), "crown", { density: { value: "low", source: "professional_input" } });
    const d1 = computeHairStateDelta(snapshot("c1", 1, current), snapshot("t1", 1, target));
    const d2 = computeHairStateDelta(snapshot("c1", 1, current), snapshot("t1", 1, target));
    expect(d1.entries).toEqual(d2.entries);
  });

  // 3. preserve/maintain intent represented correctly
  it("3. TARGET lengthIntent 'shorten' is REDUCED; 'preserve'/'maintain' are PRESERVED", () => {
    const target = withZone(basePayload(), "nape", { lengthIntent: { value: "shorten", source: "professional_input" } });
    const deltaShorten = computeHairStateDelta(snapshot("c1", 1, basePayload()), snapshot("t1", 1, target));
    expect(deltaShorten.entries.find((e) => e.scope === "nape" && e.field === "lengthIntent")?.transformation).toBe("REDUCED");

    const targetPreserve = withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } });
    const deltaPreserve = computeHairStateDelta(snapshot("c1", 1, basePayload()), snapshot("t1", 1, targetPreserve));
    expect(deltaPreserve.entries.find((e) => e.scope === "nape" && e.field === "lengthIntent")?.transformation).toBe("PRESERVED");

    const targetMaintain = withZone(basePayload(), "nape", { lengthIntent: { value: "maintain", source: "professional_input" } });
    const deltaMaintain = computeHairStateDelta(snapshot("c1", 1, basePayload()), snapshot("t1", 1, targetMaintain));
    expect(deltaMaintain.entries.find((e) => e.scope === "nape" && e.field === "lengthIntent")?.transformation).toBe("PRESERVED");
  });

  it("3b. TARGET weightIntent 'reduce'/'build'/'preserve' map to REDUCED/INCREASED/PRESERVED", () => {
    const reduce = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    expect(computeHairStateDelta(snapshot("c", 1, basePayload()), snapshot("t", 1, reduce)).entries.find((e) => e.scope === "crown" && e.field === "weightIntent")?.transformation).toBe(
      "REDUCED",
    );
    const build = withZone(basePayload(), "crown", { weightIntent: { value: "build", source: "professional_input" } });
    expect(computeHairStateDelta(snapshot("c", 1, basePayload()), snapshot("t", 1, build)).entries.find((e) => e.scope === "crown" && e.field === "weightIntent")?.transformation).toBe(
      "INCREASED",
    );
    const preserve = withZone(basePayload(), "crown", { weightIntent: { value: "preserve", source: "professional_input" } });
    expect(computeHairStateDelta(snapshot("c", 1, basePayload()), snapshot("t", 1, preserve)).entries.find((e) => e.scope === "crown" && e.field === "weightIntent")?.transformation).toBe(
      "PRESERVED",
    );
  });

  // 4. unknown CURRENT does not create an invented delta
  it("4. an unassessed CURRENT descriptive fact with a real TARGET value produces ADDED, never a guessed direction", () => {
    const target = withZone(basePayload(), "nape", { relativeLength: { value: "short", source: "professional_input" } });
    const delta = computeHairStateDelta(snapshot("c1", 1, basePayload()), snapshot("t1", 1, target));
    const entry = delta.entries.find((e) => e.scope === "nape" && e.field === "relativeLength");
    expect(entry?.transformation).toBe("ADDED");
  });

  // 5. unknown TARGET does not create an invented target
  it("5. a real CURRENT value with an unassessed TARGET produces UNKNOWN, never silently PRESERVED", () => {
    const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
    const delta = computeHairStateDelta(snapshot("c1", 1, current), snapshot("t1", 1, basePayload()));
    const entry = delta.entries.find((e) => e.scope === "nape" && e.field === "perimeterRelationship");
    expect(entry?.transformation).toBe("UNKNOWN");
  });

  it("5b. both sides unassessed is UNKNOWN, not PRESERVED", () => {
    const delta = computeHairStateDelta(snapshot("c1", 1, basePayload()), snapshot("t1", 1, basePayload()));
    const entry = delta.entries.find((e) => e.scope === "nape" && e.field === "relativeLength");
    expect(entry?.transformation).toBe("UNKNOWN");
  });

  // 6. exact source snapshot IDs/versions remain traceable
  it("6. the delta stamps the exact source snapshot ids and versions used to compute it", () => {
    const delta = computeHairStateDelta(snapshot("current-abc", 3, basePayload()), snapshot("target-xyz", 7, basePayload()));
    expect(delta.sourceCurrentSnapshotId).toBe("current-abc");
    expect(delta.sourceCurrentSnapshotVersion).toBe(3);
    expect(delta.sourceTargetSnapshotId).toBe("target-xyz");
    expect(delta.sourceTargetSnapshotVersion).toBe(7);
  });

  // 7. per-zone comparison uses canonical zone vocabulary
  it("7. every zone-scoped entry's scope is a real, canonical HeadZone -- never a re-declared vocabulary", () => {
    const delta = computeHairStateDelta(snapshot("c", 1, basePayload()), snapshot("t", 1, basePayload()));
    const zoneScopes = new Set(delta.entries.filter((e) => e.scope !== "global").map((e) => e.scope));
    for (const scope of zoneScopes) {
      expect((HEAD_ZONES as readonly string[]).includes(scope)).toBe(true);
    }
    // All 6 real zones are represented, none invented, none missing.
    expect([...zoneScopes].sort()).toEqual([...HEAD_ZONES].sort());
  });

  // 8. no second spatial taxonomy introduced
  it("8. HAIR_STATE_DELTA_TRANSFORMATIONS is exactly the 6 locked categories, never more", () => {
    expect(HAIR_STATE_DELTA_TRANSFORMATIONS).toEqual(["PRESERVED", "CHANGED", "ADDED", "REDUCED", "INCREASED", "UNKNOWN"]);
    for (const t of HAIR_STATE_DELTA_TRANSFORMATIONS) expect(isHairStateDeltaTransformation(t)).toBe(true);
    expect(isHairStateDeltaTransformation("MYSTERIOUS")).toBe(false);
  });

  it("actionableDeltaEntries excludes UNKNOWN only -- PRESERVED is kept (an active professional requirement, not 'nothing to do')", () => {
    const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
    const target = withZone(
      withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "professional_input" } }),
      "crown",
      { weightIntent: { value: "reduce", source: "professional_input" } },
    );
    const delta = computeHairStateDelta(snapshot("c", 1, current), snapshot("t", 1, target));
    const actionable = actionableDeltaEntries(delta);
    expect(actionable.some((e) => e.scope === "nape" && e.field === "perimeterRelationship" && e.transformation === "PRESERVED")).toBe(true);
    expect(actionable.some((e) => e.scope === "crown" && e.field === "weightIntent" && e.transformation === "REDUCED")).toBe(true);
    expect(actionable.every((e) => e.transformation !== "UNKNOWN")).toBe(true);
  });
});
