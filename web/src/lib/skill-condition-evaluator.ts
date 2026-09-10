import type { SkillCondition } from "@/lib/professional-skill-contracts";

// AI Hair Architect, Professional Skill Engine Stage 4 -- SKILL CONDITION
// EVALUATOR. Pure, deterministic, no I/O, no AI. The FIRST evaluator for
// professional-skill-contracts.ts's own SkillCondition<TFact> tree (that
// file only ever validated the tree's STRUCTURE -- isValidSkillCondition --
// never resolved it against real facts; professional-skill-instance-
// contracts.ts's own SkillInstanceApplicabilityResolution explicitly
// records an evaluation OUTCOME while stating "this file never performs
// the evaluation"). Stage 4 is the first stage that actually needs to run
// one, to decide whether a skill's own applicabilityCondition holds
// against the real state the candidate selector has -- reuses the EXACT
// existing condition tree/operator set (equals/in/and/or/not), never a
// second, parallel condition language.
//
// THREE-VALUED (Kleene) LOGIC, not boolean -- the task's own explicit
// rule: "UNKNOWN precondition must not become TRUE... missing required
// state must produce unresolved/needs-information semantics, never a
// silent downgrade of uncertainty into approval." A referenced fact this
// evaluator has no trustworthy value for is UNKNOWN, not `false` and not
// a fabricated `true`:
//   equals/in on an UNKNOWN fact           -> UNKNOWN
//   AND: any FALSE branch                  -> FALSE (short-circuits, even
//                                              past other UNKNOWNs)
//        else any UNKNOWN branch           -> UNKNOWN
//        else (all TRUE)                   -> TRUE
//   OR:  any TRUE branch                   -> TRUE (short-circuits)
//        else any UNKNOWN branch           -> UNKNOWN
//        else (all FALSE)                  -> FALSE
//   NOT: flips TRUE/FALSE, UNKNOWN stays UNKNOWN
// This is standard Kleene K3 logic -- the smallest correct semantics for
// "we don't know" that never lets not-knowing masquerade as permission.

export const SKILL_CONDITION_EVALUATION_RESULTS = ["TRUE", "FALSE", "UNKNOWN"] as const;
export type SkillConditionEvaluationResult = (typeof SKILL_CONDITION_EVALUATION_RESULTS)[number];

// A fact input this evaluator can consult. `known: false` means "no
// trustworthy value exists for this fact" -- structurally distinct from
// merely having a value, so a caller can never accidentally supply a
// placeholder that gets read as a real, confirmed fact.
export interface SkillConditionFactInput {
  value: string | boolean;
  known: boolean;
}

export type SkillConditionFacts<TFact extends string> = ReadonlyMap<TFact, SkillConditionFactInput>;

function lookupFact<TFact extends string>(facts: SkillConditionFacts<TFact>, fact: TFact): SkillConditionFactInput {
  return facts.get(fact) ?? { value: "", known: false };
}

export function evaluateSkillCondition<TFact extends string>(
  condition: SkillCondition<TFact>,
  facts: SkillConditionFacts<TFact>,
): SkillConditionEvaluationResult {
  switch (condition.op) {
    case "equals": {
      const input = lookupFact(facts, condition.fact);
      if (!input.known) return "UNKNOWN";
      return input.value === condition.value ? "TRUE" : "FALSE";
    }
    case "in": {
      const input = lookupFact(facts, condition.fact);
      if (!input.known) return "UNKNOWN";
      return condition.values.includes(input.value) ? "TRUE" : "FALSE";
    }
    case "and": {
      const results = condition.conditions.map((c) => evaluateSkillCondition(c, facts));
      if (results.includes("FALSE")) return "FALSE";
      if (results.includes("UNKNOWN")) return "UNKNOWN";
      return "TRUE";
    }
    case "or": {
      const results = condition.conditions.map((c) => evaluateSkillCondition(c, facts));
      if (results.includes("TRUE")) return "TRUE";
      if (results.includes("UNKNOWN")) return "UNKNOWN";
      return "FALSE";
    }
    case "not": {
      const inner = evaluateSkillCondition(condition.condition, facts);
      if (inner === "UNKNOWN") return "UNKNOWN";
      return inner === "TRUE" ? "FALSE" : "TRUE";
    }
  }
}
