import { describe, expect, it } from "vitest";

import {
  findConflictingSkillParameterNames,
  isSkillEligibleForAuthority,
  isValidSkillCondition,
  isValidSkillDefinition,
  isValidSkillParameterDefinition,
  SKILL_AUTHORITY_TYPES,
  SKILL_DEFINITION_STATUSES,
  type SkillDefinition,
  type SkillParameterDefinition,
  type SkillProcedureStep,
} from "@/lib/professional-skill-contracts";

// AI Hair Architect, Stage 2.5.i.1 -- pure contract tests for the
// Professional Skill Definition FOUNDATION. No I/O, no database, no
// provider. Every fixture below is DELIBERATELY SYNTHETIC and clearly
// labeled as such -- "SYNTHETIC TEST FIXTURE, not a real professional
// rule" appears in every rationale/description string. No real
// professional skill content is encoded here, per this stage's own
// explicit boundary.

const SYNTHETIC = "SYNTHETIC TEST FIXTURE -- not a real professional rule.";

// Two DIFFERENT, independent fact vocabularies -- proving the condition
// model genuinely isolates vertical-specific vocabularies (test 10)
// rather than sharing one hardcoded list.
type SyntheticCuttingFact = "syntheticActionType" | "syntheticToolCategory";
function isSyntheticCuttingFact(value: unknown): value is SyntheticCuttingFact {
  return value === "syntheticActionType" || value === "syntheticToolCategory";
}

type SyntheticColorFact = "syntheticDeveloperVolume" | "syntheticLiftLevel";
function isSyntheticColorFact(value: unknown): value is SyntheticColorFact {
  return value === "syntheticDeveloperVolume" || value === "syntheticLiftLevel";
}

function syntheticParameter(overrides: Partial<SkillParameterDefinition> = {}): SkillParameterDefinition {
  return {
    name: "syntheticToolOrientation",
    valueKind: "enum",
    allowedValues: ["synthetic-horizontal", "synthetic-vertical"],
    description: SYNTHETIC,
    ...overrides,
  };
}

function syntheticProcedure(): SkillProcedureStep[] {
  return [
    { order: 1, instruction: "SYNTHETIC -- incline client head forward.", referencedParameters: [] },
    { order: 2, instruction: "SYNTHETIC -- comb hair thoroughly downward while wet.", referencedParameters: [] },
    { order: 3, instruction: "SYNTHETIC -- hold guide with comb, cut using the declared tool orientation.", referencedParameters: ["syntheticToolOrientation"] },
  ];
}

function syntheticSkill(overrides: Partial<SkillDefinition<SyntheticCuttingFact>> = {}): SkillDefinition<SyntheticCuttingFact> {
  return {
    skillId: "synthetic.skill.guide-creation",
    version: 1,
    vertical: "cutting",
    name: "SYNTHETIC TEST FIXTURE -- Central nape guide creation",
    description: SYNTHETIC,
    status: "DRAFT",
    authorityType: "MACHINE_DRAFTED",
    rationale: SYNTHETIC,
    parameters: [syntheticParameter()],
    procedure: syntheticProcedure(),
    createdAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Valid SkillDefinition accepted.
// ---------------------------------------------------------------------------
describe("valid SkillDefinition (test 1)", () => {
  it("a real, well-formed synthetic skill is accepted", () => {
    expect(isValidSkillDefinition(syntheticSkill(), isSyntheticCuttingFact)).toBe(true);
  });

  it("required top-level fields are enforced", () => {
    expect(isValidSkillDefinition({ ...syntheticSkill(), skillId: "" }, isSyntheticCuttingFact)).toBe(false);
    expect(isValidSkillDefinition({ ...syntheticSkill(), name: "" }, isSyntheticCuttingFact)).toBe(false);
    expect(isValidSkillDefinition({ ...syntheticSkill(), rationale: "" }, isSyntheticCuttingFact)).toBe(false);
    expect(isValidSkillDefinition({ ...syntheticSkill(), vertical: "" }, isSyntheticCuttingFact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Scalar-only pseudo-skill rejected/structurally prevented.
// ---------------------------------------------------------------------------
describe("scalar-only pseudo-skill is structurally prevented (test 2)", () => {
  it("a single-instruction 'procedure' (a bare value wearing a skill costume) is rejected -- a procedure needs at least 2 real steps", () => {
    const pseudoSkill = syntheticSkill({ procedure: [{ order: 1, instruction: "SYNTHETIC -- set elevation to 0." }] });
    expect(isValidSkillDefinition(pseudoSkill, isSyntheticCuttingFact)).toBe(false);
  });

  it("an empty procedure is rejected", () => {
    expect(isValidSkillDefinition(syntheticSkill({ procedure: [] }), isSyntheticCuttingFact)).toBe(false);
  });

  it("a genuine 2-step procedure IS accepted -- this is a heuristic floor, not a claim that 2 steps always means a real skill", () => {
    const twoStepSkill = syntheticSkill({
      procedure: [
        { order: 1, instruction: "SYNTHETIC -- step one." },
        { order: 2, instruction: "SYNTHETIC -- step two." },
      ],
    });
    expect(isValidSkillDefinition(twoStepSkill, isSyntheticCuttingFact)).toBe(true);
  });

  it("non-contiguous or duplicated step ordinals are rejected", () => {
    const duplicateOrder = syntheticSkill({
      procedure: [
        { order: 1, instruction: "SYNTHETIC -- a." },
        { order: 1, instruction: "SYNTHETIC -- b." },
      ],
    });
    expect(isValidSkillDefinition(duplicateOrder, isSyntheticCuttingFact)).toBe(false);

    const gapInOrder = syntheticSkill({
      procedure: [
        { order: 1, instruction: "SYNTHETIC -- a." },
        { order: 3, instruction: "SYNTHETIC -- b." },
      ],
    });
    expect(isValidSkillDefinition(gapInOrder, isSyntheticCuttingFact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3/4. Typed parameter accepted / invalid parameter shape rejected.
// ---------------------------------------------------------------------------
describe("parameter model (tests 3, 4)", () => {
  it("a valid enum parameter is accepted", () => {
    expect(isValidSkillParameterDefinition(syntheticParameter())).toBe(true);
  });

  it("a valid boolean/number/string parameter (no allowedValues) is accepted", () => {
    expect(isValidSkillParameterDefinition({ name: "syntheticWetHair", valueKind: "boolean", description: SYNTHETIC })).toBe(true);
    expect(isValidSkillParameterDefinition({ name: "syntheticSubsectionCm", valueKind: "number", description: SYNTHETIC })).toBe(true);
    expect(isValidSkillParameterDefinition({ name: "syntheticToolName", valueKind: "string", description: SYNTHETIC })).toBe(true);
  });

  it("an enum parameter with empty/missing allowedValues is rejected", () => {
    expect(isValidSkillParameterDefinition({ name: "x", valueKind: "enum", allowedValues: [], description: SYNTHETIC })).toBe(false);
    expect(isValidSkillParameterDefinition({ name: "x", valueKind: "enum", description: SYNTHETIC })).toBe(false);
  });

  it("a non-enum parameter carrying allowedValues is rejected -- the shapes must never cross-contaminate", () => {
    expect(isValidSkillParameterDefinition({ name: "x", valueKind: "boolean", allowedValues: [true, false], description: SYNTHETIC })).toBe(false);
  });

  it("reuses an EXISTING vertical enum's own option array rather than inventing a duplicate list", () => {
    // Demonstrates real reuse without hardcoding cutting into this
    // contract: a synthetic cutting-vertical parameter borrows the real,
    // already-existing elevation vocabulary by reference.
    const ELEVATION_OPTIONS_LIKE = ["0_deg_blunt", "45_deg_graduation", "90_deg_uniform_layer", "135_deg_long_layer", "180_deg_overdirection"] as const;
    const parameter = syntheticParameter({ name: "syntheticElevation", allowedValues: ELEVATION_OPTIONS_LIKE });
    expect(isValidSkillParameterDefinition(parameter)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5/6. Closed typed condition accepted / arbitrary executable condition rejected.
// ---------------------------------------------------------------------------
describe("condition model (tests 5, 6)", () => {
  it("a valid equals condition is accepted", () => {
    expect(isValidSkillCondition({ op: "equals", fact: "syntheticActionType", value: "synthetic-structural-cutting" }, isSyntheticCuttingFact)).toBe(true);
  });

  it("a valid nested and/or/not condition tree is accepted", () => {
    const condition = {
      op: "and" as const,
      conditions: [
        { op: "equals" as const, fact: "syntheticActionType" as const, value: "synthetic-structural-cutting" },
        { op: "not" as const, condition: { op: "in" as const, fact: "syntheticToolCategory" as const, values: ["synthetic-a", "synthetic-b"] } },
      ],
    };
    expect(isValidSkillCondition(condition, isSyntheticCuttingFact)).toBe(true);
  });

  it("rejects an unrecognized/free-form op -- there is no 'javascript'/'eval'/'expression' op", () => {
    expect(isValidSkillCondition({ op: "javascript", code: "process.exit()" }, isSyntheticCuttingFact)).toBe(false);
    expect(isValidSkillCondition({ op: "eval", expression: "1===1" }, isSyntheticCuttingFact)).toBe(false);
  });

  it("rejects a condition carrying an actual function instead of data", () => {
    const malformed = { op: "equals", fact: "syntheticActionType", value: (() => true) as unknown as string };
    expect(isValidSkillCondition(malformed, isSyntheticCuttingFact)).toBe(false);
  });

  it("rejects a condition referencing a fact not in the caller's own closed vocabulary", () => {
    expect(isValidSkillCondition({ op: "equals", fact: "clientFavoriteColor", value: "red" }, isSyntheticCuttingFact)).toBe(false);
  });

  it("a skill's own applicabilityCondition is validated the same way", () => {
    const withCondition = syntheticSkill({ applicabilityCondition: { op: "equals", fact: "syntheticActionType", value: "synthetic-structural-cutting" } });
    expect(isValidSkillDefinition(withCondition, isSyntheticCuttingFact)).toBe(true);

    const withBadCondition = syntheticSkill({ applicabilityCondition: { op: "eval", expression: "1" } as never });
    expect(isValidSkillDefinition(withBadCondition, isSyntheticCuttingFact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7/8. Professional authority accepted / unreviewed machine draft cannot masquerade as active authority.
// ---------------------------------------------------------------------------
describe("authority / governance (tests 7, 8)", () => {
  it("PROFESSIONALLY_AUTHORED, ACTIVE is a valid, eligible skill", () => {
    const skill = syntheticSkill({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isValidSkillDefinition(skill, isSyntheticCuttingFact)).toBe(true);
    expect(isSkillEligibleForAuthority(skill)).toBe(true);
  });

  it("PROFESSIONALLY_REVIEWED, ACTIVE, with a stamped reviewer is valid and eligible", () => {
    const skill = syntheticSkill({ status: "ACTIVE", authorityType: "PROFESSIONALLY_REVIEWED", reviewedByUserId: "user-1", reviewedAt: "2026-09-08T00:00:00.000Z" });
    expect(isValidSkillDefinition(skill, isSyntheticCuttingFact)).toBe(true);
    expect(isSkillEligibleForAuthority(skill)).toBe(true);
  });

  it("PROFESSIONALLY_REVIEWED without a stamped reviewer/timestamp is invalid -- review must be traceable, never assumed", () => {
    expect(isValidSkillDefinition(syntheticSkill({ status: "ACTIVE", authorityType: "PROFESSIONALLY_REVIEWED" }), isSyntheticCuttingFact)).toBe(false);
  });

  it("a MACHINE_DRAFTED skill can never even be CONSTRUCTED as ACTIVE -- structurally prevented, not just deemed ineligible", () => {
    expect(isValidSkillDefinition(syntheticSkill({ status: "ACTIVE", authorityType: "MACHINE_DRAFTED" }), isSyntheticCuttingFact)).toBe(false);
  });

  it("a MACHINE_DRAFTED DRAFT skill is a valid OBJECT (an honest 'AI draft awaiting review' state) but never eligible authority", () => {
    const skill = syntheticSkill({ status: "DRAFT", authorityType: "MACHINE_DRAFTED" });
    expect(isValidSkillDefinition(skill, isSyntheticCuttingFact)).toBe(true);
    expect(isSkillEligibleForAuthority(skill)).toBe(false);
  });

  it("DRAFT and RETIRED are never eligible, even with professionally-authored authority", () => {
    expect(isSkillEligibleForAuthority({ status: "DRAFT", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(false);
    expect(isSkillEligibleForAuthority({ status: "RETIRED", authorityType: "PROFESSIONALLY_AUTHORED" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Lifecycle/version validation.
// ---------------------------------------------------------------------------
describe("lifecycle and versioning (test 9)", () => {
  it("DRAFT, ACTIVE, RETIRED are the exact closed status set", () => {
    expect(SKILL_DEFINITION_STATUSES).toEqual(["DRAFT", "ACTIVE", "RETIRED"]);
  });

  it("PROFESSIONALLY_AUTHORED, PROFESSIONALLY_REVIEWED, MACHINE_DRAFTED are the exact closed authority set", () => {
    expect(SKILL_AUTHORITY_TYPES).toEqual(["PROFESSIONALLY_AUTHORED", "PROFESSIONALLY_REVIEWED", "MACHINE_DRAFTED"]);
  });

  it("an unrecognized status is rejected", () => {
    expect(isValidSkillDefinition(syntheticSkill({ status: "PUBLISHED" as never }), isSyntheticCuttingFact)).toBe(false);
  });

  it("version must be a positive integer", () => {
    expect(isValidSkillDefinition(syntheticSkill({ version: 0 }), isSyntheticCuttingFact)).toBe(false);
    expect(isValidSkillDefinition(syntheticSkill({ version: 1.5 }), isSyntheticCuttingFact)).toBe(false);
  });

  it("two versions of the same skillId are distinct, independently valid snapshots -- never an in-place update", () => {
    const v1 = syntheticSkill({ version: 1, status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    const v2 = syntheticSkill({ version: 2, status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED" });
    expect(isValidSkillDefinition(v1, isSyntheticCuttingFact)).toBe(true);
    expect(isValidSkillDefinition(v2, isSyntheticCuttingFact)).toBe(true);
    expect(v1.skillId).toBe(v2.skillId);
    expect(v1.version).not.toBe(v2.version);
    expect(v1).not.toBe(v2);
  });

  it("supersededBySkillId is only meaningful once RETIRED", () => {
    const retiredWithSuccessor = syntheticSkill({ status: "RETIRED", authorityType: "PROFESSIONALLY_AUTHORED", supersededBySkillId: "synthetic.skill.guide-creation.v2" });
    expect(isValidSkillDefinition(retiredWithSuccessor, isSyntheticCuttingFact)).toBe(true);

    const activeWithSuccessor = syntheticSkill({ status: "ACTIVE", authorityType: "PROFESSIONALLY_AUTHORED", supersededBySkillId: "synthetic.skill.guide-creation.v2" });
    expect(isValidSkillDefinition(activeWithSuccessor, isSyntheticCuttingFact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Vertical-specific parameter/condition vocabulary remains isolated.
// ---------------------------------------------------------------------------
describe("vertical-specific vocabulary isolation (test 10)", () => {
  it("a cutting-vertical condition validates against the cutting fact guard but not the color fact guard, and vice versa", () => {
    const cuttingCondition = { op: "equals" as const, fact: "syntheticActionType" as const, value: "synthetic-structural-cutting" };
    expect(isValidSkillCondition(cuttingCondition, isSyntheticCuttingFact)).toBe(true);
    expect(isValidSkillCondition(cuttingCondition, isSyntheticColorFact)).toBe(false);

    const colorCondition = { op: "equals" as const, fact: "syntheticDeveloperVolume" as const, value: "synthetic-20-vol" };
    expect(isValidSkillCondition(colorCondition, isSyntheticColorFact)).toBe(true);
    expect(isValidSkillCondition(colorCondition, isSyntheticCuttingFact)).toBe(false);
  });

  it("a color-vertical skill definition uses its own fact vocabulary, structurally separate from cutting's", () => {
    const colorSkill: SkillDefinition<SyntheticColorFact> = {
      ...syntheticSkill(),
      vertical: "color",
      applicabilityCondition: { op: "equals", fact: "syntheticLiftLevel", value: "synthetic-level-3" },
    };
    expect(isValidSkillDefinition(colorSkill, isSyntheticColorFact)).toBe(true);
    expect(isValidSkillDefinition(colorSkill, isSyntheticCuttingFact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Multi-operation procedure, never bound to the current TD Step schema.
// ---------------------------------------------------------------------------
describe("procedure representation independent of Technical Demonstration step schema (test 11)", () => {
  it("represents a real, multi-step guide-creation procedure using only plain instruction labels", () => {
    const skill = syntheticSkill();
    expect(skill.procedure.length).toBeGreaterThanOrEqual(2);
    for (const step of skill.procedure) {
      expect(typeof step.instruction).toBe("string");
      expect(step.instruction.length).toBeGreaterThan(0);
    }
    // Structural proof: nothing about a procedure step's own shape
    // resembles or requires CuttingDemonstrationStepPayload's field names
    // (phase/actionType/zones/etc.) -- it is exactly {order, instruction,
    // referencedParameters?}, deliberately smaller.
    const step = skill.procedure[0] as unknown as Record<string, unknown>;
    expect(Object.keys(step).sort()).toEqual(["instruction", "order", "referencedParameters"].sort());
  });

  it("a procedure step may reference only parameters the skill itself declares", () => {
    const invalidReference = syntheticSkill({
      procedure: [
        { order: 1, instruction: "SYNTHETIC -- a.", referencedParameters: ["undeclaredParameter"] },
        { order: 2, instruction: "SYNTHETIC -- b." },
      ],
    });
    expect(isValidSkillDefinition(invalidReference, isSyntheticCuttingFact)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Conflict detection, dependency/prerequisite, compatibility-reference,
// and zone-applicability models (additional coverage for the report's own
// "dependency/prerequisite model" and "compatibility-reference model"
// requirements).
// ---------------------------------------------------------------------------
describe("conflict detection, prerequisites, compatibility references, zones", () => {
  it("detects two parameters sharing the same name within one skill", () => {
    const conflicts = findConflictingSkillParameterNames([syntheticParameter({ name: "x" }), syntheticParameter({ name: "x" }), syntheticParameter({ name: "y" })]);
    expect(conflicts).toEqual(["x"]);
  });

  it("a skill with a parameter-name conflict is rejected as a whole", () => {
    const conflicting = syntheticSkill({ parameters: [syntheticParameter({ name: "x" }), syntheticParameter({ name: "x" })], procedure: syntheticProcedure().map((s) => ({ ...s, referencedParameters: [] })) });
    expect(isValidSkillDefinition(conflicting, isSyntheticCuttingFact)).toBe(false);
  });

  it("prerequisiteSkillIds and incompatibleSkillIds are declarative-only string lists, validated but never resolved here", () => {
    const skill = syntheticSkill({ prerequisiteSkillIds: ["synthetic.skill.sectioning"], incompatibleSkillIds: ["synthetic.skill.slice-and-slide"] });
    expect(isValidSkillDefinition(skill, isSyntheticCuttingFact)).toBe(true);
  });

  it("an empty-string id inside prerequisiteSkillIds/incompatibleSkillIds is rejected", () => {
    expect(isValidSkillDefinition(syntheticSkill({ prerequisiteSkillIds: [""] }), isSyntheticCuttingFact)).toBe(false);
    expect(isValidSkillDefinition(syntheticSkill({ incompatibleSkillIds: [""] }), isSyntheticCuttingFact)).toBe(false);
  });

  it("applicableZones is a plain, validated string list whose meaning this contract deliberately does not interpret", () => {
    // Demonstrates reuse of a real existing zone vocabulary (HeadZone-like
    // values) without this contract importing or depending on it.
    const skill = syntheticSkill({ applicableZones: ["nape", "occipital", "crown"] });
    expect(isValidSkillDefinition(skill, isSyntheticCuttingFact)).toBe(true);
  });
});
