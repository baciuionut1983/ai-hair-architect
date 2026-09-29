import type { SkillDefinition } from "@/lib/professional-skill-contracts";
import type { SkillInstance, SkillInstanceParameterBinding } from "@/lib/professional-skill-instance-contracts";
import type { ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";

// AI Hair Architect, Professional Skill Engine, B1 -- PROFESSIONAL BRAIN
// CUT+COLOR SLICE, first real color-vertical Skill content. Authored under
// the SAME Stage 2.5.i.1/i.3/i.5 contract stack the real cutting Skills
// use (professional-skill-contracts.ts / professional-skill-instance-
// contracts.ts / professional-skill-execution-unit-contracts.ts), proving
// the contract stack is genuinely reusable across a second vertical
// without any change to those three files' own shape.
//
// PILOT SKILL: "Global Single-Process Color -- Evaluation Gate". SCOPE,
// deliberately narrow and safety-first: this Skill NEVER executes a
// chemical operation, NEVER proposes a formula, developer volume, or
// processing time, and NEVER asserts that a given base can be safely
// opened/lightened. Its entire real content is a professional EVALUATION
// GATE -- confirm chemical history, confirm a strand test, record a
// professional's own determination comparing the structurally captured
// CURRENT/TARGET color state -- exactly matching this stage's own explicit
// instruction: mark the work as needing professional evaluation, never
// generate executable chemical instructions. A future, separately
// authorized Skill that models real color EXECUTION (formula/developer/
// technique) is out of this pilot's scope entirely, and would need its own
// separate capability kind (see professional-skill-contracts.ts's own
// EVALUATE_COLOR_SERVICE header).
//
// RELATIONSHIP TO color-plan-engine.ts (M27): that engine is the live,
// separate Hair Recommendation Engine feeding the Analysis flow's own
// AnalysisProposal/ColorPlan -- it is NEVER imported here, and this Skill
// never reads or writes anything it produces. This Skill's own
// HairStateSnapshot-rooted level/tone facts and color-plan-engine.ts's own
// desiredColorResult/liftLevels facts are two independent, non-competing
// representations answering two different questions (Professional Brain's
// "what does this Skill Engine plan do" vs. Analysis's own "what does a
// deterministic rule engine propose for this profile") -- never merged,
// never cross-read, by design (see the B1 architecture audit).
//
// GLOBAL ONLY, no zone: color state in this slice
// (HairStateSnapshotPayload.colorState) is global, not per-zone -- this
// Skill declares no applicableZones and its own EVALUATE_COLOR_SERVICE
// capability declares no zones, matching hair-state-color-delta-skill-
// candidate-selector.ts's own "unconstrained == global" matching rule.
//
// AUTHORITY MARKING: status "ACTIVE" + authorityType
// "PROFESSIONALLY_AUTHORED" -- isSkillEligibleForAuthority(
// COLOR_GLOBAL_EVALUATION_GATE_SKILL) is true, same governance as every
// real cutting Skill.
//
// NO CONDITIONS: like the Central Nape Guide pilot, this Skill uses no
// applicabilityCondition. Rather than reusing cutting's own
// ExecutionRuleConditionFact (semantically misleading for a color-vertical
// Skill, even though technically inert), a small, honestly-unused
// color-scoped fact type is declared below instead.
//
// NO PREREQUISITE DECLARED: this Skill's own Execution Unit declares no
// prerequisiteExecutionUnitIds -- a general-purpose evaluation gate has no
// universal truth about which specific cutting Skill, if any, must precede
// it (that depends on the real client's own proposal). Precedence-
// enforcement itself is proven with a SYNTHETIC test fixture in this
// Skill's own test file (color-skill-global-single-process-evaluation-
// gate.test.ts) and in professional-execution-plan-compiler.test.ts,
// never by hardcoding a scenario-specific dependency into this Skill's own
// authored content.

const COLOR_EVALUATION_GATE_VERTICAL = "color";
const COLOR_EVALUATION_GATE_AUTHORITY_SOURCE = "B1 Professional Brain CUT+COLOR slice -- professional evaluation-gate authorization (2026-09-29).";

export type ColorSkillConditionFact = "not_used";
export function isColorSkillConditionFact(value: unknown): value is ColorSkillConditionFact {
  return value === "not_used";
}

export const COLOR_GLOBAL_EVALUATION_GATE_SKILL: SkillDefinition<ColorSkillConditionFact> = {
  skillId: "skill-color-global-single-process-evaluation-gate",
  version: 1,
  vertical: COLOR_EVALUATION_GATE_VERTICAL,
  name: "Global Single-Process Color -- Evaluation Gate",
  description:
    "Professional evaluation gate for a global single-process color service request: confirms chemical history and a strand test, and records a professional's own determination comparing the structurally captured CURRENT/TARGET color state. Never executes a chemical operation, never proposes a formula.",
  status: "ACTIVE",
  authorityType: "PROFESSIONALLY_AUTHORED",
  rationale:
    "Professionally authorized evaluation gate bounding Stage 4/5 color candidate selection to a real declared capability, while structurally forbidding any formula/developer/technique output -- see professional-skill-contracts.ts's own EVALUATE_COLOR_SERVICE header for why this capability is deliberately never state-changing.",
  parameters: [
    {
      name: "chemicalHistoryStatus",
      valueKind: "enum",
      allowedValues: ["known", "unknown"],
      description: "Whether the client's chemical history (previous color services, relaxers, known allergies) has been confirmed and documented before any color evaluation proceeds.",
    },
    {
      name: "strandTestStatus",
      valueKind: "enum",
      allowedValues: ["performed", "not_performed"],
      description: "Whether a strand test evaluation appropriate to the determined service has been performed before any client-facing chemical application.",
    },
    {
      name: "professionalDeterminationRecorded",
      valueKind: "boolean",
      description: "Whether a professional has recorded their own determination of the base condition and color service direction, comparing the structurally captured CURRENT and TARGET color state.",
    },
  ],
  procedure: [
    {
      order: 1,
      instruction: "Confirm and document the client's known chemical history before evaluating any color service; if unknown, this must be explicitly recorded as unknown, never assumed.",
      referencedParameters: ["chemicalHistoryStatus"],
    },
    {
      order: 2,
      instruction:
        "Compare the CURRENT and TARGET color state (level and tone) as structurally captured, and record a professional's own determination of the base condition and color service direction. This Skill never derives, proposes, or executes a formula on its own.",
      referencedParameters: ["professionalDeterminationRecorded"],
    },
    {
      order: 3,
      instruction:
        "Perform a strand test evaluation before any client-facing chemical application; if not yet performed, this Skill's own output must be marked as requiring professional evaluation, never treated as execution-ready.",
      referencedParameters: ["strandTestStatus"],
    },
  ],
  capabilities: [{ kind: "EVALUATE_COLOR_SERVICE" }],
  createdAt: "2026-09-29T00:00:00.000Z",
};

function fixedBinding(parameterName: string, value: string | boolean | number): SkillInstanceParameterBinding<ColorSkillConditionFact> {
  return {
    parameterName,
    bindingState: "FIXED_FROM_AUTHORITY",
    value,
    sourceReference: COLOR_EVALUATION_GATE_AUTHORITY_SOURCE,
  };
}

// The canonical, production SkillInstance -- chemical history KNOWN and
// strand test PERFORMED (the "sufficient data" case). The "insufficient
// data" case (UNRESOLVED bindings, proving the gate blocks chemical
// execution when data is missing) is a SYNTHETIC test-only variant built
// in this Skill's own test file, never a second production instance.
export const COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE: SkillInstance<ColorSkillConditionFact> = {
  skillInstanceId: "skillinstance-color-global-single-process-evaluation-gate-pilot",
  vertical: COLOR_EVALUATION_GATE_VERTICAL,
  sourceSkillId: COLOR_GLOBAL_EVALUATION_GATE_SKILL.skillId,
  sourceSkillVersion: COLOR_GLOBAL_EVALUATION_GATE_SKILL.version,
  compositionId: "composition-color-global-single-process-pilot-placeholder",
  order: 1,
  parameterBindings: [fixedBinding("chemicalHistoryStatus", "known"), fixedBinding("strandTestStatus", "performed"), fixedBinding("professionalDeterminationRecorded", true)],
  createdAt: "2026-09-29T00:00:00.000Z",
};

// EXECUTION UNIT COUNT: exactly ONE -- every fact this Skill binds (all
// three parameters) is stable across the Skill's entire, narrow evaluation
// scope; no zone/side/sub-phase/condition transition ever occurs within
// it, mirroring the Central Nape Guide pilot's own identical reasoning.
export const COLOR_GLOBAL_EVALUATION_GATE_EXECUTION_UNITS: readonly ExecutionUnit<ColorSkillConditionFact>[] = [
  {
    executionUnitId: "executionunit-color-global-single-process-evaluation-gate-1",
    vertical: COLOR_EVALUATION_GATE_VERTICAL,
    order: 1,
    label: "Global Single-Process Color -- Evaluation Gate",
    description: "The single stable-context evaluation scope: chemical history confirmation, professional determination, and strand test confirmation -- no chemical execution.",
    laterality: "NOT_APPLICABLE",
    sourceSkillInstanceId: COLOR_GLOBAL_EVALUATION_GATE_SKILL_INSTANCE.skillInstanceId,
    createdAt: "2026-09-29T00:00:00.000Z",
  },
];
