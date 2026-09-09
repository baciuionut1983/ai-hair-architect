import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import {
  buildUnassessedGlobalEntry,
  buildUnassessedZoneEntry,
  diffHairStateSnapshots,
  HAIR_STATE_SNAPSHOT_ROLES,
  HAIR_STATE_SNAPSHOT_STATUSES,
  HAIR_STATE_VALUE_SOURCES,
  isHairStateGlobalEntry,
  isHairStateSnapshotPayload,
  isHairStateSnapshotRole,
  isHairStateSnapshotStatus,
  isHairStateValueSource,
  isHairZoneStateArray,
  isHairZoneStateEntry,
  type HairStateSnapshotPayload,
} from "@/lib/hair-state-snapshot-validators";

// Professional Skill Engine, Stage 2 -- HAIR STATE SNAPSHOT contract tests.
// Pure, no I/O, mirrors technical-visual-map-validators.test.ts's own
// conventions.

function realPayload(): HairStateSnapshotPayload {
  return {
    globalState: {
      relativeLength: { value: "long", source: "observed" },
      fiberThickness: { value: "medium", source: "observed" },
      density: { value: "medium", source: "observed" },
      texture: { value: "wavy", source: "observed" },
      condition: { value: "virgin_healthy", source: "observed" },
    },
    zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)),
  };
}

describe("hair-state-snapshot-validators (pure contract)", () => {
  it("recognizes exactly 3 roles and 3 statuses", () => {
    expect(HAIR_STATE_SNAPSHOT_ROLES).toEqual(["CURRENT", "TARGET", "RESULT"]);
    expect(HAIR_STATE_SNAPSHOT_STATUSES).toEqual(["DRAFT", "CONFIRMED", "SUPERSEDED"]);
    for (const role of HAIR_STATE_SNAPSHOT_ROLES) expect(isHairStateSnapshotRole(role)).toBe(true);
    for (const status of HAIR_STATE_SNAPSHOT_STATUSES) expect(isHairStateSnapshotStatus(status)).toBe(true);
    expect(isHairStateSnapshotRole("BEFORE")).toBe(false);
    expect(isHairStateSnapshotStatus("REJECTED")).toBe(false);
  });

  it("recognizes exactly 6 value sources, and CONFIRMED is deliberately not one of them", () => {
    expect(HAIR_STATE_VALUE_SOURCES).toEqual(["not_yet_assessed", "observed", "inferred", "professional_input", "ai_proposed", "client_reported"]);
    for (const source of HAIR_STATE_VALUE_SOURCES) expect(isHairStateValueSource(source)).toBe(true);
    expect(isHairStateValueSource("confirmed")).toBe(false);
    expect(isHairStateValueSource("CONFIRMED")).toBe(false);
  });

  it("a real, fully-specified payload validates", () => {
    expect(isHairStateSnapshotPayload(realPayload())).toBe(true);
  });

  it("an unassessed global entry and unassessed zone entry both validate -- 'unspecified' is a first-class, honest value", () => {
    expect(isHairStateGlobalEntry(buildUnassessedGlobalEntry())).toBe(true);
    expect(isHairZoneStateEntry(buildUnassessedZoneEntry("crown"))).toBe(true);
  });

  it("exactly the 6 real HeadZones, each once -- never more, never fewer, never an unknown zone", () => {
    const zones = HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone));
    expect(isHairZoneStateArray(zones)).toBe(true);
    expect(isHairZoneStateArray(zones.slice(0, 5))).toBe(false); // missing a zone
    expect(isHairZoneStateArray([...zones, buildUnassessedZoneEntry("crown")])).toBe(false); // duplicate
    expect(isHairZoneStateArray([...zones.slice(1), { ...buildUnassessedZoneEntry("crown"), zone: "unknown_zone" }])).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Fail-closed on invalid/unknown vocabulary -- never silently coerced.
  // ---------------------------------------------------------------------------

  it("fails closed on an invalid relativeLength value (never coerced to 'unspecified')", () => {
    const mangled = realPayload();
    mangled.globalState.relativeLength = { value: "gigantic" as never, source: "observed" };
    expect(isHairStateSnapshotPayload(mangled)).toBe(false);
  });

  it("fails closed on an invalid value source", () => {
    const mangled = realPayload();
    mangled.globalState.density = { value: "medium", source: "confirmed" as never };
    expect(isHairStateSnapshotPayload(mangled)).toBe(false);
  });

  it("fails closed on an invalid TARGET-relevant lengthIntent/weightIntent value", () => {
    const zones = HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone));
    zones[0] = { ...zones[0], lengthIntent: { value: "double" as never, source: "professional_input" } };
    expect(isHairZoneStateArray(zones)).toBe(false);
  });

  it("fails closed on an invalid perimeterRelationship value", () => {
    const zones = HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone));
    zones[0] = { ...zones[0], perimeterRelationship: { value: "way_shorter" as never, source: "observed" } };
    expect(isHairZoneStateArray(zones)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Structural diff -- deterministic, no AI.
  // ---------------------------------------------------------------------------

  it("diffHairStateSnapshots identifies changed vs preserved global facts", () => {
    const before = realPayload();
    const after = realPayload();
    after.globalState.relativeLength = { value: "medium", source: "professional_input" };

    const diffs = diffHairStateSnapshots(before, after);
    const lengthDiff = diffs.find((d) => d.scope === "global" && d.field === "relativeLength");
    const densityDiff = diffs.find((d) => d.scope === "global" && d.field === "density");

    expect(lengthDiff?.changed).toBe(true);
    expect(lengthDiff?.fromValue).toBe("long");
    expect(lengthDiff?.toValue).toBe("medium");
    expect(densityDiff?.changed).toBe(false);
  });

  it("diffHairStateSnapshots identifies changed vs preserved per-zone facts, scoped to the correct zone", () => {
    const before = realPayload();
    const after = realPayload();
    after.zones = after.zones.map((z) => (z.zone === "nape" ? { ...z, lengthIntent: { value: "shorten", source: "professional_input" } } : z));

    const diffs = diffHairStateSnapshots(before, after);
    const napeLengthIntentDiff = diffs.find((d) => d.scope === "nape" && d.field === "lengthIntent");
    const crownLengthIntentDiff = diffs.find((d) => d.scope === "crown" && d.field === "lengthIntent");

    expect(napeLengthIntentDiff?.changed).toBe(true);
    expect(crownLengthIntentDiff?.changed).toBe(false);
  });

  it("diffHairStateSnapshots on two identical payloads reports zero changes -- deterministic, no false positives", () => {
    const payload = realPayload();
    const diffs = diffHairStateSnapshots(payload, realPayload());
    expect(diffs.every((d) => !d.changed)).toBe(true);
  });
});
