import { describe, expect, it } from "vitest";

import { isHairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";

import {
  COLOR_EVALUATION_GATE_SKILL_KEY,
  UNSPECIFIED_COLOR_FACTS,
  UNSPECIFIED_GLOBAL_CUT_FACTS,
  buildCurrentStatePayload,
  buildTargetStatePayload,
  getCandidateDomain,
  getExpectedConfirmedSnapshotId,
  getSnapshotStatusBadgeVariant,
  getSnapshotStatusLabel,
  getTransformationBadgeVariant,
  getTransformationLabel,
  hasColorCandidate,
  mapProfessionalBrainApiError,
} from "./professional-brain-logic";

describe("getSnapshotStatusBadgeVariant / getSnapshotStatusLabel", () => {
  it.each([
    ["DRAFT", "neutral", "Draft"],
    ["CONFIRMED", "success", "Confirmed"],
    ["SUPERSEDED", "warning", "Superseded"],
  ])("%s -> %s / %s", (status, variant, label) => {
    expect(getSnapshotStatusBadgeVariant(status)).toBe(variant);
    expect(getSnapshotStatusLabel(status)).toBe(label);
  });
});

describe("getTransformationBadgeVariant / getTransformationLabel", () => {
  it.each([
    ["PRESERVED", "success"],
    ["CHANGED", "warning"],
    ["REDUCED", "warning"],
    ["INCREASED", "warning"],
    ["ADDED", "neutral"],
    ["UNKNOWN", "neutral"],
  ])("%s -> %s", (transformation, variant) => {
    expect(getTransformationBadgeVariant(transformation)).toBe(variant);
    expect(getTransformationLabel(transformation)).not.toBe("");
  });
});

describe("getCandidateDomain", () => {
  it("EVALUATE_COLOR_SERVICE is color, every other real capability is cut", () => {
    expect(getCandidateDomain("EVALUATE_COLOR_SERVICE")).toBe("color");
    expect(getCandidateDomain("ESTABLISH_GUIDE")).toBe("cut");
    expect(getCandidateDomain("REDUCE_LENGTH")).toBe("cut");
    expect(getCandidateDomain("PRESERVE_WEIGHT")).toBe("cut");
  });
});

describe("mapProfessionalBrainApiError", () => {
  it("never leaks a raw internal message, and the concurrency case is specifically actionable", () => {
    expect(mapProfessionalBrainApiError(401)).toBe("Please sign in again.");
    expect(mapProfessionalBrainApiError(404)).toMatch(/no longer available/);
    expect(mapProfessionalBrainApiError(409, "HAIR_STATE_SNAPSHOT_CONCURRENCY_CONFLICT")).toMatch(/changed since you loaded/);
    expect(mapProfessionalBrainApiError(409, "SOMETHING_ELSE")).toMatch(/state changed/);
    expect(mapProfessionalBrainApiError(400)).toMatch(/missing/);
    expect(mapProfessionalBrainApiError(503)).toMatch(/temporarily unavailable/);
    expect(mapProfessionalBrainApiError(500)).toBe("Something went wrong. Please try again.");
  });
});

describe("buildCurrentStatePayload / buildTargetStatePayload (pure)", () => {
  it("with everything unspecified, produces a structurally valid payload where every fact is honestly not_yet_assessed", () => {
    const payload = buildCurrentStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS);
    expect(isHairStateSnapshotPayload(payload)).toBe(true);
    expect(payload.globalState.relativeLength).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    expect(payload.colorState).toEqual({ level: { value: "unspecified", source: "not_yet_assessed" }, tone: { value: "unspecified", source: "not_yet_assessed" } });
    expect(payload.zones.every((z) => z.lengthIntent.source === "not_yet_assessed")).toBe(true);
  });

  it("a real global CUT fact and a real color fact are tagged professional_input, never fabricated as observed", () => {
    const payload = buildCurrentStatePayload({ ...UNSPECIFIED_GLOBAL_CUT_FACTS, density: "high" }, { level: "level_6", tone: "neutral" });
    expect(payload.globalState.density).toEqual({ value: "high", source: "professional_input" });
    expect(payload.colorState).toEqual({ level: { value: "level_6", source: "professional_input" }, tone: { value: "neutral", source: "professional_input" } });
  });

  it("buildTargetStatePayload sets lengthIntent/weightIntent ONLY on the chosen zone -- every other zone stays honestly unassessed", () => {
    const payload = buildTargetStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, { zone: "nape", lengthIntent: "preserve", weightIntent: "unspecified" });
    expect(isHairStateSnapshotPayload(payload)).toBe(true);
    const nape = payload.zones.find((z) => z.zone === "nape")!;
    expect(nape.lengthIntent).toEqual({ value: "preserve", source: "professional_input" });
    expect(nape.weightIntent).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    const others = payload.zones.filter((z) => z.zone !== "nape");
    expect(others.every((z) => z.lengthIntent.source === "not_yet_assessed" && z.weightIntent.source === "not_yet_assessed")).toBe(true);
  });

  it("buildTargetStatePayload with zoneIntent null leaves ALL zones unassessed", () => {
    const payload = buildTargetStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, null);
    expect(payload.zones.every((z) => z.lengthIntent.source === "not_yet_assessed" && z.weightIntent.source === "not_yet_assessed")).toBe(true);
  });
});

// B2.1 -- the real bug this stage fixes: the page previously hardcoded
// `expectedCurrentConfirmedSnapshotId: null` on every confirm call,
// which is only correct for a client's very first confirmation of a
// role. Once a snapshot is already CONFIRMED, pickSnapshot always
// returns THAT row (never a newer draft) -- so the expected id for
// confirming a round-2 draft must be the already-confirmed row's own
// id, never null (a stale null would either wrongly 409 a legitimate
// second round, or -- the real risk -- let a confirm silently target
// the wrong baseline).
describe("getExpectedConfirmedSnapshotId", () => {
  it("null snapshot (nothing exists yet) -> null", () => {
    expect(getExpectedConfirmedSnapshotId(null)).toBeNull();
  });

  it("a DRAFT snapshot (first-ever draft, nothing confirmed yet) -> null", () => {
    expect(getExpectedConfirmedSnapshotId({ id: "s1", status: "DRAFT" } as never)).toBeNull();
  });

  it("a CONFIRMED snapshot (round 2 must supersede exactly this one) -> its own id", () => {
    expect(getExpectedConfirmedSnapshotId({ id: "s1", status: "CONFIRMED" } as never)).toBe("s1");
  });

  it("a SUPERSEDED snapshot -> null (it is no longer the live confirmed baseline)", () => {
    expect(getExpectedConfirmedSnapshotId({ id: "s1", status: "SUPERSEDED" } as never)).toBeNull();
  });
});

describe("hasColorCandidate", () => {
  it("true only when the real color evaluation-gate skill key is present", () => {
    expect(hasColorCandidate([{ skillKey: COLOR_EVALUATION_GATE_SKILL_KEY } as never])).toBe(true);
    expect(hasColorCandidate([{ skillKey: "skill-cutting-establish-central-nape-guide" } as never])).toBe(false);
    expect(hasColorCandidate([])).toBe(false);
  });
});
