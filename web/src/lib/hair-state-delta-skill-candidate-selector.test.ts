import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry, type HairStateSnapshotPayload } from "@/lib/hair-state-snapshot-validators";
import type { HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";
import { selectCandidateSkillsForDelta } from "@/lib/hair-state-delta-skill-candidate-selector";
import type { SkillDefinition, SkillParameterDefinition, SkillProcedureStep } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import { ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL } from "@/lib/cutting-skill-establish-central-nape-guide";
import { OCCIPITAL_TRANSITION_SKILL } from "@/lib/cutting-skill-occipital-transition";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";
import { isValidSkillDefinition } from "@/lib/professional-skill-contracts";

// Professional Skill Engine, Stage 4 -- DETERMINISTIC CANDIDATE SELECTOR
// pure tests. No I/O, no AI, no database (the selector takes a plain
// in-memory registry array). Synthetic fixtures are clearly labeled;
// the "first proof of brain" scenario uses ONLY the 3 real, already-
// authorized skills.

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";

function basePayload(): HairStateSnapshotPayload {
  return { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map((zone) => buildUnassessedZoneEntry(zone)) };
}

function withZone(payload: HairStateSnapshotPayload, zone: string, overrides: Partial<HairStateSnapshotPayload["zones"][number]>): HairStateSnapshotPayload {
  return { ...payload, zones: payload.zones.map((z) => (z.zone === zone ? { ...z, ...overrides } : z)) };
}

function snap(id: string, version: number, payload: HairStateSnapshotPayload): HairStateSnapshotDeltaInput {
  return { id, snapshotVersion: version, payload };
}

let syntheticCounter = 0;
function syntheticProcedure(): SkillProcedureStep[] {
  return [
    { order: 1, instruction: "SYNTHETIC -- step one.", referencedParameters: [] },
    { order: 2, instruction: "SYNTHETIC -- step two.", referencedParameters: [] },
  ];
}
function syntheticParameter(): SkillParameterDefinition {
  return { name: "syntheticParam", valueKind: "boolean", description: SYNTHETIC };
}

function syntheticSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  syntheticCounter += 1;
  return {
    skillId: overrides.skillId ?? `synthetic.selector-test.${syntheticCounter}`,
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC TEST FIXTURE -- Selector test skill",
    description: SYNTHETIC,
    status: "ACTIVE",
    authorityType: "PROFESSIONALLY_AUTHORED",
    rationale: SYNTHETIC,
    parameters: [syntheticParameter()],
    procedure: syntheticProcedure(),
    createdAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

function asRecord(skill: SkillDefinition, idOverride?: string): ProfessionalSkillDefinitionRecord {
  return {
    id: idOverride ?? `record-${skill.skillId}-v${skill.version}`,
    skillId: skill.skillId,
    version: skill.version,
    vertical: skill.vertical,
    name: skill.name,
    status: skill.status,
    authorityType: skill.authorityType,
    payload: skill,
    reviewedByUserId: skill.reviewedByUserId ?? null,
    reviewedAt: skill.reviewedAt ?? null,
    supersededBySkillDefinitionId: skill.status === "RETIRED" ? "some-successor-id" : null,
    createdAt: skill.createdAt,
    updatedAt: skill.createdAt,
  };
}

describe("selectCandidateSkillsForDelta (pure)", () => {
  // 9. structured skill capability round-trip
  it("9. a skill's declared capability round-trips into the candidate match's own matchedCapability field", () => {
    const skill = syntheticSkill({ capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }] });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, basePayload()), snap("t", 1, target), [asRecord(skill)]);
    expect(result.candidateMatches).toHaveLength(1);
    expect(result.candidateMatches[0].matchedCapability).toBe("REDUCE_WEIGHT");
    expect(result.candidateMatches[0].skillKey).toBe(skill.skillId);
    expect(result.candidateMatches[0].skillVersion).toBe(1);
  });

  // 10. capability matching works without free-text search
  it("10. a skill whose NAME/DESCRIPTION mentions the exact matching words, but declares NO capability, is never a candidate", () => {
    const skill = syntheticSkill({
      name: "SYNTHETIC -- Reduce Weight In The Crown Specialist",
      description: "SYNTHETIC -- this skill reduces weight and builds movement in the crown zone.",
      capabilities: undefined,
    });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, basePayload()), snap("t", 1, target), [asRecord(skill)]);
    expect(result.candidateMatches).toHaveLength(0);
    expect(result.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent")).toBe(true);
  });

  // 11. applicable skill becomes candidate
  it("11. a skill with a matching capability and a vacuously-true (undeclared) applicabilityCondition becomes a candidate", () => {
    const skill = syntheticSkill({ capabilities: [{ kind: "PRESERVE_PERIMETER", zones: ["nape"] }] });
    const target = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "professional_input" } });
    const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, current), snap("t", 1, target), [asRecord(skill)]);
    expect(result.candidateMatches).toHaveLength(1);
    expect(result.candidateMatches[0].applicabilityResult).toBe("APPLICABLE");
  });

  // 12. inapplicable skill is rejected
  it("12. a skill whose applicabilityCondition evaluates FALSE against real facts is rejected, never a candidate", () => {
    const skill = syntheticSkill({
      capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }],
      applicabilityCondition: { op: "equals", fact: "current.crown.condition", value: "virgin_healthy" },
    });
    const current = withZone(basePayload(), "crown", { condition: { value: "fragile_breakage", source: "observed" } });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, current), snap("t", 1, target), [asRecord(skill)]);
    expect(result.candidateMatches).toHaveLength(0);
    expect(result.rejectedMatches).toHaveLength(1);
    expect(result.rejectedMatches[0].applicabilityResult).toBe("INAPPLICABLE");
    expect(result.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent")).toBe(true);
  });

  // 13. unknown required precondition does NOT become applicable
  it("13. a skill whose applicabilityCondition references a fact this selector cannot derive is UNKNOWN, never silently APPLICABLE", () => {
    const skill = syntheticSkill({
      capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }],
      applicabilityCondition: { op: "equals", fact: "scalpSensitivityLabTestResult", value: "normal" },
    });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, basePayload()), snap("t", 1, target), [asRecord(skill)]);
    expect(result.candidateMatches).toHaveLength(0);
    expect(result.rejectedMatches).toHaveLength(1);
    expect(result.rejectedMatches[0].applicabilityResult).toBe("UNKNOWN");
  });

  // 14. one skill can match multiple compatible deltas
  it("14. one skill with multiple capabilities matches multiple, distinct delta entries", () => {
    const skill = syntheticSkill({
      capabilities: [
        { kind: "REDUCE_WEIGHT", zones: ["crown"] },
        { kind: "PRESERVE_PERIMETER", zones: ["nape"] },
      ],
    });
    const target = withZone(
      withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } }),
      "nape",
      { perimeterRelationship: { value: "at_perimeter", source: "professional_input" } },
    );
    const current = withZone(basePayload(), "nape", { perimeterRelationship: { value: "at_perimeter", source: "observed" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, current), snap("t", 1, target), [asRecord(skill)]);
    const matchedFields = result.candidateMatches.map((m) => `${m.deltaEntry.scope}.${m.deltaEntry.field}`).sort();
    expect(matchedFields).toEqual(["crown.weightIntent", "nape.perimeterRelationship"]);
  });

  // 15. one delta can expose multiple candidate skills
  it("15. one delta entry can be matched by multiple different skills", () => {
    const skillA = syntheticSkill({ capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }] });
    const skillB = syntheticSkill({ capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }] });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, basePayload()), snap("t", 1, target), [asRecord(skillA), asRecord(skillB)]);
    expect(result.candidateMatches).toHaveLength(2);
    expect(new Set(result.candidateMatches.map((m) => m.skillKey))).toEqual(new Set([skillA.skillId, skillB.skillId]));
  });

  // 16. unsupported delta becomes UNRESOLVED
  it("16. an actionable delta with no matching capability anywhere in the registry becomes UNRESOLVED, never invented", () => {
    const skill = syntheticSkill({ capabilities: [{ kind: "PRESERVE_PERIMETER", zones: ["nape"] }] });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "build", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, basePayload()), snap("t", 1, target), [asRecord(skill)]);
    expect(result.candidateMatches).toHaveLength(0);
    expect(result.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent" && e.transformation === "INCREASED")).toBe(true);
  });

  // 17. no haircut-name matching exists
  it("17. neither the selector nor the delta module ever references a haircut name/template", () => {
    const selectorSource = readFileSync(join(process.cwd(), "src", "lib", "hair-state-delta-skill-candidate-selector.ts"), "utf8");
    const deltaSource = readFileSync(join(process.cwd(), "src", "lib", "hair-state-delta.ts"), "utf8");
    const forbidden = /butterfly|bobskill|pixieskill|wolfcut|haircuttemplate/i;
    expect(forbidden.test(selectorSource)).toBe(false);
    expect(forbidden.test(deltaSource)).toBe(false);
  });

  // 18. old skill versions remain deterministically selectable by version rules
  it("18. a RETIRED version is excluded from candidates; the ACTIVE successor version is selected -- version rules, not free-text", () => {
    const skillId = "synthetic.selector-test.versioned";
    const retiredV1 = syntheticSkill({ skillId, version: 1, status: "RETIRED", capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }] });
    const activeV2 = syntheticSkill({ skillId, version: 2, status: "ACTIVE", capabilities: [{ kind: "REDUCE_WEIGHT", zones: ["crown"] }] });
    const target = withZone(basePayload(), "crown", { weightIntent: { value: "reduce", source: "professional_input" } });
    const result = selectCandidateSkillsForDelta(snap("c", 1, basePayload()), snap("t", 1, target), [asRecord(retiredV1), asRecord(activeV2)]);
    expect(result.candidateMatches).toHaveLength(1);
    expect(result.candidateMatches[0].skillVersion).toBe(2);
  });

  // 19. existing three migrated skills remain semantically intact
  it("19. the 3 real skills' own structural validity is unaffected by their new capabilities field", () => {
    for (const real of [ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL, OCCIPITAL_TRANSITION_SKILL, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL]) {
      expect(isValidSkillDefinition(real, (v): v is string => typeof v === "string")).toBe(true);
    }
  });

  // 20. selector requires ZERO AI/provider calls
  it("20. neither the selector, the delta module, nor the condition evaluator import any AI/vision/video provider client", () => {
    for (const file of ["hair-state-delta-skill-candidate-selector.ts", "hair-state-delta.ts", "skill-condition-evaluator.ts"]) {
      const source = readFileSync(join(process.cwd(), "src", "lib", file), "utf8");
      expect(/gemini|openai|anthropic|veo-|claude-api|@google\/generative-ai/i.test(source)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // FIRST PROOF OF BRAIN -- the 3 real, already-authorized skills only.
  // -------------------------------------------------------------------------

  it("PROOF: CURRENT -> TARGET -> DELTA -> candidate skill(s), using only the 3 real registered skills, plus one honestly UNRESOLVED delta", () => {
    // CURRENT: a client whose nape has real, observed length -- no guide
    // has ever been established yet (lengthIntent/perimeterRelationship
    // are honestly unassessed, exactly like every real, auto-assembled
    // CURRENT snapshot in this system today).
    const current = withZone(basePayload(), "nape", { relativeLength: { value: "long", source: "observed" }, density: { value: "high", source: "observed" } });

    // TARGET: the professional wants (a) the nape's straight, one-length
    // guide reference preserved/established (matches Establish Central
    // Nape Guide + Continue Central Nape Construction), (b) that same
    // preserved relationship carried through the occipital zone (matches
    // Occipital Transition's own CONNECT_ZONES/PRESERVE_LENGTH capability),
    // and (c) the crown's weight REDUCED -- a texturizing/point-cutting
    // outcome NONE of the 3 real, 0-degree-blunt-only skills declare.
    const target = withZone(
      withZone(
        withZone(basePayload(), "nape", { lengthIntent: { value: "preserve", source: "professional_input" } }),
        "occipital",
        { lengthIntent: { value: "preserve", source: "professional_input" } },
      ),
      "crown",
      { weightIntent: { value: "reduce", source: "professional_input" } },
    );

    const registry: ProfessionalSkillDefinitionRecord[] = [
      asRecord(ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL),
      asRecord(OCCIPITAL_TRANSITION_SKILL),
      asRecord(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL),
    ];

    const result = selectCandidateSkillsForDelta(snap("current-real", 1, current), snap("target-real", 1, target), registry);

    // The delta itself: exact source snapshots traceable.
    expect(result.delta.sourceCurrentSnapshotId).toBe("current-real");
    expect(result.delta.sourceTargetSnapshotId).toBe("target-real");

    // nape.lengthIntent=preserve -> matched by the real registry.
    const napeMatches = result.candidateMatches.filter((m) => m.deltaEntry.scope === "nape" && m.deltaEntry.field === "lengthIntent");
    expect(napeMatches.length).toBeGreaterThan(0);
    expect(napeMatches.some((m) => m.skillKey === ESTABLISH_CENTRAL_NAPE_GUIDE_SKILL.skillId)).toBe(true);
    expect(napeMatches.some((m) => m.skillKey === CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId)).toBe(true);
    expect(napeMatches.every((m) => m.applicabilityResult === "APPLICABLE")).toBe(true);
    expect(napeMatches.every((m) => typeof m.deterministicReason === "string" && m.deterministicReason.length > 0)).toBe(true);

    // occipital.lengthIntent=preserve -> matched by Occipital Transition.
    const occipitalMatches = result.candidateMatches.filter((m) => m.deltaEntry.scope === "occipital" && m.deltaEntry.field === "lengthIntent");
    expect(occipitalMatches.some((m) => m.skillKey === OCCIPITAL_TRANSITION_SKILL.skillId)).toBe(true);

    // crown.weightIntent=reduce -> the tiny registry has no REDUCE_WEIGHT
    // capability anywhere. This MUST be UNRESOLVED, never an invented
    // technique.
    expect(result.candidateMatches.some((m) => m.deltaEntry.scope === "crown" && m.deltaEntry.field === "weightIntent")).toBe(false);
    expect(result.unresolvedDeltas.some((e) => e.scope === "crown" && e.field === "weightIntent" && e.transformation === "REDUCED")).toBe(true);
  });
});
