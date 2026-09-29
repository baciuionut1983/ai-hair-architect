import { describe, expect, it } from "vitest";

import { isHairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";

import {
  COLOR_EVALUATION_GATE_SKILL_KEY,
  UNSPECIFIED_COLOR_FACTS,
  UNSPECIFIED_GLOBAL_CUT_FACTS,
  buildCurrentStatePayload,
  buildTargetStatePayload,
  describeUnresolvedDelta,
  getCandidateDomain,
  getExpectedConfirmedSnapshotId,
  getSnapshotStatusBadgeVariant,
  getSnapshotStatusLabel,
  getTransformationBadgeVariant,
  getTransformationLabel,
  groupCandidateMatchesBySkill,
  hasColorCandidate,
  isIntentDerivedField,
  mapProfessionalBrainApiError,
  pbTranslate,
  resolveClientDomainIntent,
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
    const payload = buildCurrentStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, ["cut", "color"]);
    expect(isHairStateSnapshotPayload(payload)).toBe(true);
    expect(payload.globalState.relativeLength).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    expect(payload.colorState).toEqual({ level: { value: "unspecified", source: "not_yet_assessed" }, tone: { value: "unspecified", source: "not_yet_assessed" } });
    expect(payload.zones.every((z) => z.lengthIntent.source === "not_yet_assessed")).toBe(true);
  });

  it("a real global CUT fact and a real color fact are tagged professional_input, never fabricated as observed", () => {
    const payload = buildCurrentStatePayload({ ...UNSPECIFIED_GLOBAL_CUT_FACTS, density: "high" }, { level: "level_6", tone: "neutral" }, ["cut", "color"]);
    expect(payload.globalState.density).toEqual({ value: "high", source: "professional_input" });
    expect(payload.colorState).toEqual({ level: { value: "level_6", source: "professional_input" }, tone: { value: "neutral", source: "professional_input" } });
  });

  it("embeds the chosen domains as evaluationDomainIntent, validly, for any real combination", () => {
    expect(buildCurrentStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, ["cut"]).evaluationDomainIntent).toEqual({ domains: ["cut"] });
    expect(buildCurrentStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, ["color"]).evaluationDomainIntent).toEqual({ domains: ["color"] });
    const withStyling = buildCurrentStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, ["cut", "color", "styling"]);
    expect(withStyling.evaluationDomainIntent).toEqual({ domains: ["cut", "color", "styling"] });
    expect(isHairStateSnapshotPayload(withStyling)).toBe(true);
  });

  it("buildTargetStatePayload sets lengthIntent/weightIntent/perimeterRelationship ONLY on the chosen zone -- every other zone stays honestly unassessed", () => {
    const payload = buildTargetStatePayload(UNSPECIFIED_GLOBAL_CUT_FACTS, UNSPECIFIED_COLOR_FACTS, {
      zone: "nape",
      lengthIntent: "preserve",
      weightIntent: "unspecified",
      perimeterRelationship: "at_perimeter",
    });
    expect(isHairStateSnapshotPayload(payload)).toBe(true);
    const nape = payload.zones.find((z) => z.zone === "nape")!;
    expect(nape.lengthIntent).toEqual({ value: "preserve", source: "professional_input" });
    expect(nape.weightIntent).toEqual({ value: "unspecified", source: "not_yet_assessed" });
    expect(nape.perimeterRelationship).toEqual({ value: "at_perimeter", source: "professional_input" });
    const others = payload.zones.filter((z) => z.zone !== "nape");
    expect(others.every((z) => z.lengthIntent.source === "not_yet_assessed" && z.weightIntent.source === "not_yet_assessed" && z.perimeterRelationship.source === "not_yet_assessed")).toBe(true);
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

// B2.2 -- live production finding: "Preserved" was labeled identically
// whether it came from a stated intent (unknown baseline) or a genuinely
// confirmed, both-sides-known continuity. This distinguishes them.
describe("isIntentDerivedField / getTransformationLabel with field", () => {
  it("lengthIntent/weightIntent are intent-derived; descriptive fields (including color) are not", () => {
    expect(isIntentDerivedField("lengthIntent")).toBe(true);
    expect(isIntentDerivedField("weightIntent")).toBe(true);
    expect(isIntentDerivedField("colorTone")).toBe(false);
    expect(isIntentDerivedField("relativeLength")).toBe(false);
  });

  it("PRESERVED reads differently for an intent field vs a descriptive field -- the live-caught semantic gap", () => {
    expect(getTransformationLabel("PRESERVED", "weightIntent")).toBe("Preserved (stated intent)");
    expect(getTransformationLabel("PRESERVED", "colorTone")).toBe("Preserved (confirmed)");
    expect(getTransformationLabel("PRESERVED")).toBe("Preserved (confirmed)");
  });
});

// B2.2 -- live production finding: two rows for the same skill (a real
// color-level change and an unchanged-but-still-required color tone)
// read as two separate findings. Grouping must never drop or merge real
// matches, only present them under one card per skill.
describe("groupCandidateMatchesBySkill", () => {
  it("groups two matches for the SAME skill into one entry with two listed reasons -- reproduces the live 'two rows, one skill' report exactly", () => {
    const colorMatch = (field: string, transformation: string) =>
      ({
        deltaEntry: { scope: "global", field, transformation, current: { value: "x", source: "observed" }, target: { value: "y", source: "professional_input" } },
        skillDefinitionId: "registry-skill-color-global-single-process-evaluation-gate-v1",
        skillKey: COLOR_EVALUATION_GATE_SKILL_KEY,
        skillVersion: 1,
        matchedCapability: "EVALUATE_COLOR_SERVICE",
        applicabilityResult: "APPLICABLE",
        deterministicReason: `reason for ${field}`,
      }) as never;

    const grouped = groupCandidateMatchesBySkill([colorMatch("colorLevel", "INCREASED"), colorMatch("colorTone", "PRESERVED")]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].skillKey).toBe(COLOR_EVALUATION_GATE_SKILL_KEY);
    expect(grouped[0].domain).toBe("color");
    expect(grouped[0].entries).toHaveLength(2);
    expect(grouped[0].entries.map((e) => e.deltaEntry.field)).toEqual(["colorLevel", "colorTone"]);
  });

  it("different skills produce different groups", () => {
    const grouped = groupCandidateMatchesBySkill([
      { skillDefinitionId: "a", skillKey: "skill-cutting-a", skillVersion: 1, matchedCapability: "PRESERVE_LENGTH", deltaEntry: {}, applicabilityResult: "APPLICABLE", deterministicReason: "r" } as never,
      { skillDefinitionId: "b", skillKey: "skill-cutting-b", skillVersion: 1, matchedCapability: "ESTABLISH_GUIDE", deltaEntry: {}, applicabilityResult: "APPLICABLE", deterministicReason: "r" } as never,
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe("describeUnresolvedDelta", () => {
  it("names the scope/field/target/transformation honestly, in both languages, without inventing a capability name", () => {
    const entry = { scope: "nape", field: "lengthIntent", transformation: "REDUCED", target: { value: "shorten", source: "professional_input" } } as const;
    const en = describeUnresolvedDelta(entry, "en");
    const ro = describeUnresolvedDelta(entry, "ro");
    expect(en).toContain("nape");
    expect(en).toContain("lengthIntent");
    expect(en).toContain("shorten");
    expect(en).not.toMatch(/REDUCE_LENGTH|PRESERVE_WEIGHT|capability/i);
    expect(ro).toContain("nape");
    expect(ro).toContain("lengthIntent");
    expect(ro).toContain("shorten");
    expect(en).not.toBe(ro);
  });
});

describe("pbTranslate", () => {
  it("Romanian output is genuinely different real text, not an English fallback, for representative keys", () => {
    const keys = ["pageTitle", "flowStopsTitle", "colorMissingChemicalHistory", "vocabularyExecution", "confirmCurrentButton"] as const;
    for (const key of keys) {
      const en = pbTranslate("en", key);
      const ro = pbTranslate("ro", key);
      expect(en.length).toBeGreaterThan(0);
      expect(ro.length).toBeGreaterThan(0);
      expect(ro).not.toBe(en);
    }
  });

  it("a non-Romanian language falls back to English", () => {
    expect(pbTranslate("fr", "pageTitle")).toBe(pbTranslate("en", "pageTitle"));
  });

  // "CORECȚIE B2.2 ÎNAINTE DE RELEASE", requirement 3 -- the audit proved
  // perimeterRelationship="at_perimeter" never independently contributes
  // to any match, and "shorten + preserve weight" remains unresolved
  // regardless. The corrected copy must never call the perimeter+preserve
  // combination an "identified" haircut, must never promise a CUT skill
  // for the perimeter aspect, and must say it is currently unmatched --
  // in both languages.
  it("oneLengthHint never overclaims what Perimeter relationship contributes -- no 'identified' haircut, no promised match, honestly describes the current gap", () => {
    for (const lang of ["en", "ro"] as const) {
      const hint = pbTranslate(lang, "oneLengthHint");
      expect(hint.toLowerCase()).not.toMatch(/identified/);
      expect(hint.toLowerCase()).not.toMatch(/identificat/);
      expect(hint).toMatch(/does not yet match|nu se potrivește încă/);
    }
  });
});

describe("resolveClientDomainIntent", () => {
  it("no CURRENT snapshot yet -> defaults to cut+color", () => {
    expect(resolveClientDomainIntent(null)).toEqual(["cut", "color"]);
  });

  it("a snapshot with no evaluationDomainIntent (legacy) -> defaults to cut+color", () => {
    const snapshot = { payload: { globalState: {}, zones: [] } } as unknown as Parameters<typeof resolveClientDomainIntent>[0];
    expect(resolveClientDomainIntent(snapshot)).toEqual(["cut", "color"]);
  });

  it("a snapshot with a real evaluationDomainIntent -> returns exactly what was recorded", () => {
    const snapshot = { payload: { globalState: {}, zones: [], evaluationDomainIntent: { domains: ["color"] } } } as unknown as Parameters<typeof resolveClientDomainIntent>[0];
    expect(resolveClientDomainIntent(snapshot)).toEqual(["color"]);
  });
});
