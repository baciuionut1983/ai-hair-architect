import { describe, expect, it } from "vitest";

import type { SkillCondition } from "@/lib/professional-skill-contracts";
import { evaluateSkillCondition, type SkillConditionFacts } from "@/lib/skill-condition-evaluator";

// Professional Skill Engine, Stage 4 -- SKILL CONDITION EVALUATOR pure
// tests. Three-valued (Kleene) logic; no I/O, no AI. Every fixture is
// deliberately synthetic.

type Fact = "hairDamage" | "clientConsent" | "zoneAccessible";

function facts(entries: Record<string, { value: string | boolean; known: boolean }>): SkillConditionFacts<Fact> {
  return new Map(Object.entries(entries)) as SkillConditionFacts<Fact>;
}

describe("evaluateSkillCondition (three-valued Kleene logic)", () => {
  it("equals: TRUE when the known fact matches", () => {
    const condition: SkillCondition<Fact> = { op: "equals", fact: "hairDamage", value: false };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: true } }))).toBe("TRUE");
  });

  it("equals: FALSE when the known fact does not match", () => {
    const condition: SkillCondition<Fact> = { op: "equals", fact: "hairDamage", value: false };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: true, known: true } }))).toBe("FALSE");
  });

  it("equals: UNKNOWN when the fact is not known -- never silently FALSE or TRUE", () => {
    const condition: SkillCondition<Fact> = { op: "equals", fact: "hairDamage", value: false };
    expect(evaluateSkillCondition(condition, facts({}))).toBe("UNKNOWN");
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: false } }))).toBe("UNKNOWN");
  });

  it("in: TRUE/FALSE/UNKNOWN mirror equals's own semantics over a value set", () => {
    const condition: SkillCondition<Fact> = { op: "in", fact: "zoneAccessible", values: ["nape", "occipital"] };
    expect(evaluateSkillCondition(condition, facts({ zoneAccessible: { value: "nape", known: true } }))).toBe("TRUE");
    expect(evaluateSkillCondition(condition, facts({ zoneAccessible: { value: "crown", known: true } }))).toBe("FALSE");
    expect(evaluateSkillCondition(condition, facts({ zoneAccessible: { value: "nape", known: false } }))).toBe("UNKNOWN");
  });

  it("and: FALSE short-circuits even past an UNKNOWN branch", () => {
    const condition: SkillCondition<Fact> = {
      op: "and",
      conditions: [
        { op: "equals", fact: "hairDamage", value: true },
        { op: "equals", fact: "clientConsent", value: true }, // unknown
      ],
    };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: true } }))).toBe("FALSE");
  });

  it("and: UNKNOWN when no branch is FALSE but at least one is UNKNOWN -- never becomes TRUE", () => {
    const condition: SkillCondition<Fact> = {
      op: "and",
      conditions: [
        { op: "equals", fact: "hairDamage", value: false },
        { op: "equals", fact: "clientConsent", value: true },
      ],
    };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: true } }))).toBe("UNKNOWN");
  });

  it("and: TRUE only when every branch is TRUE", () => {
    const condition: SkillCondition<Fact> = {
      op: "and",
      conditions: [
        { op: "equals", fact: "hairDamage", value: false },
        { op: "equals", fact: "clientConsent", value: true },
      ],
    };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: true }, clientConsent: { value: true, known: true } }))).toBe("TRUE");
  });

  it("or: TRUE short-circuits even past an UNKNOWN branch", () => {
    const condition: SkillCondition<Fact> = {
      op: "or",
      conditions: [
        { op: "equals", fact: "hairDamage", value: true },
        { op: "equals", fact: "clientConsent", value: true }, // unknown
      ],
    };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: true, known: true } }))).toBe("TRUE");
  });

  it("or: UNKNOWN when no branch is TRUE but at least one is UNKNOWN", () => {
    const condition: SkillCondition<Fact> = {
      op: "or",
      conditions: [
        { op: "equals", fact: "hairDamage", value: true },
        { op: "equals", fact: "clientConsent", value: true },
      ],
    };
    expect(evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: true } }))).toBe("UNKNOWN");
  });

  it("or: FALSE only when every branch is FALSE", () => {
    const condition: SkillCondition<Fact> = {
      op: "or",
      conditions: [
        { op: "equals", fact: "hairDamage", value: true },
        { op: "equals", fact: "clientConsent", value: true },
      ],
    };
    expect(
      evaluateSkillCondition(condition, facts({ hairDamage: { value: false, known: true }, clientConsent: { value: false, known: true } })),
    ).toBe("FALSE");
  });

  it("not: flips TRUE/FALSE, but UNKNOWN stays UNKNOWN (never resolved by negation)", () => {
    const trueCondition: SkillCondition<Fact> = { op: "not", condition: { op: "equals", fact: "hairDamage", value: false } };
    expect(evaluateSkillCondition(trueCondition, facts({ hairDamage: { value: false, known: true } }))).toBe("FALSE");

    const falseCondition: SkillCondition<Fact> = { op: "not", condition: { op: "equals", fact: "hairDamage", value: true } };
    expect(evaluateSkillCondition(falseCondition, facts({ hairDamage: { value: false, known: true } }))).toBe("TRUE");

    const unknownCondition: SkillCondition<Fact> = { op: "not", condition: { op: "equals", fact: "hairDamage", value: true } };
    expect(evaluateSkillCondition(unknownCondition, facts({}))).toBe("UNKNOWN");
  });

  it("deeply nested conditions resolve deterministically", () => {
    const condition: SkillCondition<Fact> = {
      op: "and",
      conditions: [
        { op: "not", condition: { op: "equals", fact: "hairDamage", value: true } },
        { op: "or", conditions: [{ op: "equals", fact: "clientConsent", value: true }, { op: "equals", fact: "zoneAccessible", value: "nape" }] },
      ],
    };
    expect(
      evaluateSkillCondition(
        condition,
        facts({ hairDamage: { value: false, known: true }, clientConsent: { value: false, known: true }, zoneAccessible: { value: "nape", known: true } }),
      ),
    ).toBe("TRUE");
  });
});
