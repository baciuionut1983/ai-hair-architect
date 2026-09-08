import { isValidAtomicAction, type AtomicAction } from "@/lib/professional-skill-atomic-action-contracts";
import { isExecutionUnitConsistentWithSourceSkillInstance, isValidExecutionUnit, type ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import { isValidSkillInstance, type SkillInstance } from "@/lib/professional-skill-instance-contracts";
import {
  deduplicateDemonstrationRequirements,
  type DemonstrationRequirement,
  type DemonstrationRequirementCategory,
} from "@/lib/professional-skill-demonstration-requirement-contracts";

// AI Hair Architect, Stage 2.5.i.10 -- CUTTING SKILL DEMONSTRATION
// REQUIREMENT DERIVER. A small, pure, deterministic function that
// translates one already-compiled, real Atomic Action (Stage 2.5.i.8,
// real content from Stage 2.5.i.6/i.7) into zero or more Demonstration
// Requirements (Stage 2.5.i.10, professional-skill-demonstration-
// requirement-contracts.ts) -- ZERO camera policy, ZERO VideoInstruction,
// ZERO provider call, ZERO DB, ZERO wiring into any runtime path. Calling
// this function has ZERO effect anywhere in the application today.
//
// CUTTING-SPECIFIC, not universal -- named accordingly (mirrors cutting-
// skill-atomic-action-compiler.ts exactly): DERIVATION_RULES below is
// keyed by cutting-domain parameter names real to the two existing
// cutting Skills. A Color/Treatment deriver would need its own,
// differently-keyed rule table -- never forced through this one. The
// UNIVERSAL category vocabulary these rules map INTO lives one file over,
// in professional-skill-demonstration-requirement-contracts.ts, and
// contains no cutting vocabulary at all.
//
// RULE JUSTIFICATION -- every rule below is justified by an ACTUAL,
// already-authorized structured fact in Stage 2.5.i.6/i.7's real content,
// per Stage 2.5.i.9's own explicit rule list (its "REAL DERIVATION RULES"
// section). No speculative rule for a fact neither real Skill uses is
// included. `structuralTechnique`/`cuttingTechnique` remain unpromoted --
// neither audit (i.9 or i.18) ever named them as an independent
// visibility trigger, and no real Provider-facing gap was ever found for
// them; they continue to ride along only as REQUIRED gating parameters on
// the EXECUTE template (Stage 2.5.i.8), never as their own requirement.
//
// VALUE REACHABILITY CORRECTION (Stage 2.5.i.18 audit, Stage 2.5.i.19):
// this file previously treated `hairState`, `shearOrientation`,
// `guideStrandDirection`, and `distribution` as either absent entirely or
// as mere SUPPORTING NAMES on another rule -- meaning their own resolved
// VALUE was never captured anywhere (only referenced by name in
// `subjectParameterNames`; see i.18's own precise trace). All four are
// REAL, already-bound, already-authorized facts on the two real Skills
// (fixedBinding present for each) -- promoting them to their own PRIMARY
// rule below is not new professional authority, only a fix to this
// file's own translation reachability, using the exact same mechanism
// `cuttingLineShape`/`clientHeadPosition` already prove correct. Their
// EXISTING supporting-name placement (below) is left byte-unchanged --
// this is purely additive: each promoted fact now ALSO produces its own
// independent requirement, alongside (never replacing) its prior
// supporting-name reference.
//
// hairState specifically also required a Stage 2.5.i.8 companion fix
// (added to EXECUTE's own optionalParams) -- previously `hairState` could
// never bind onto the EXECUTE action at all, meaning even a promoted rule
// here would never have fired on the one action where visibly-wet hair
// matters most (the cutting itself). See cutting-skill-atomic-action-
// compiler.ts's own updated header for that half of the fix.
//
// GATING: a rule only ever fires for a parameter name that is actually
// present in THIS SPECIFIC Atomic Action's own `boundParameterNames` --
// never merely because the fact is resolvable somewhere in the source
// Skill Instance/Execution Unit. This is exactly why a CONTROL action
// (boundParameterNames including "controlMethod") derives a TOOL_TO_
// SUBJECT_RELATIONSHIP requirement while an EXECUTE action from the same
// Execution Unit (which never binds "controlMethod") does not -- the
// scoping Stage 2.5.i.8's own compiler already did is reused, never
// re-decided here.
//
// FAIL-CLOSED, NEVER INVENTED: if a bound parameter name has no resolved
// structured value anywhere (Execution-Unit-level REQUIRED_FIXED rule,
// else Skill-Instance-level FIXED_FROM_AUTHORITY binding), NO requirement
// is produced for it -- never guessed, never defaulted. A zero-length
// result for a given Atomic Action is an honest, valid outcome (e.g. a
// PREPARE-kind action with no visually-relevant bound fact), never itself
// an error.
//
// AUTHORITY BOUNDARY: this function does NOT re-check source-Skill
// eligibility (PROFESSIONALLY_AUTHORED/ACTIVE) -- it has no SkillDefinition
// input to check, by design (Stage 2.5.i.10's own task never asked for
// one). Eligibility is already enforced one layer upstream: Stage
// 2.5.i.8's own compileExecutionUnitToAtomicActions refuses to produce an
// AtomicAction from ineligible authority in the first place, so any
// AtomicAction this function is ever handed is already trustworthy by
// construction. This function only ever ECHOES what its structurally-
// valid input already contains -- it cannot add new certainty, and
// therefore cannot "launder" untrusted content into trusted visibility
// authority (see the test file's own dedicated proof).
//
// ANATOMICAL CONTEXT is derived differently from every other rule: from
// the source Execution Unit's own `zoneId` directly (an Execution-Unit-
// level field, not a Skill-declared parameter), not gated by
// `boundParameterNames` -- every Atomic Action compiled from one
// Execution Unit shares the same anatomical context by definition (that
// is what "stable context" means), so every one of them independently
// deriving the identical ANATOMICAL_CONTEXT requirement, each correctly
// scoped to its own sourceAtomicActionId, is honest repetition, not a
// bug. Its own `applicabilityCondition` (if present) rides along verbatim
// as this requirement's `condition` -- never re-evaluated.
//
// NO CAMERA, NO TIMING, NO PROVIDER DETAIL: nothing in this file ever
// selects a viewpoint, a shot type, a duration, or any provider-specific
// value -- there is no field anywhere in this file's own logic capable of
// representing one (Stage 2.5.i.10's own explicit boundary).

function isParameterLiteral(value: unknown): value is string | boolean | number {
  return typeof value === "string" || typeof value === "boolean" || typeof value === "number";
}

// Mirrors resolveEffectiveParameterValue from Stage 2.5.i.8's own compiler
// (cutting-skill-atomic-action-compiler.ts) exactly -- not imported, to
// keep that already-tested, already-released file completely byte-
// unchanged, per this stage's own non-regression requirement. Same small,
// deliberate duplication precedent already used for isParameterLiteral
// across three sibling contract files this session.
function resolveEffectiveParameterValue<TFact extends string>(
  parameterName: string,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
): string | boolean | number | null {
  const euRule = executionUnit.parameterRules?.find((r) => r.parameterName === parameterName);
  if (euRule) {
    if (euRule.semantic === "REQUIRED_FIXED" && euRule.fixedValue !== undefined && isParameterLiteral(euRule.fixedValue)) {
      return euRule.fixedValue;
    }
    return null;
  }
  const binding = skillInstance.parameterBindings.find((b) => b.parameterName === parameterName);
  if (binding && binding.bindingState !== "UNRESOLVED" && binding.value !== undefined && isParameterLiteral(binding.value)) {
    return binding.value;
  }
  return null;
}

interface DerivationRule {
  parameterName: string;
  category: DemonstrationRequirementCategory;
  supportingParameterNames: readonly string[];
}

const DERIVATION_RULES: readonly DerivationRule[] = [
  { parameterName: "controlMethod", category: "TOOL_TO_SUBJECT_RELATIONSHIP", supportingParameterNames: ["guideStrandDirection", "distribution"] },
  { parameterName: "elevation", category: "SUBJECT_TO_REFERENCE_GEOMETRY", supportingParameterNames: ["distribution"] },
  { parameterName: "tool", category: "TOOL_TO_SUBJECT_RELATIONSHIP", supportingParameterNames: ["shearOrientation"] },
  { parameterName: "cuttingLineShape", category: "RESULTING_LINE_OR_FORM", supportingParameterNames: [] },
  { parameterName: "clientHeadPosition", category: "SUBJECT_POSITION_STATE", supportingParameterNames: [] },
  // Stage 2.5.i.19 -- value-reachability promotions (see file header).
  // Each is additive: it produces its own independent requirement (a
  // distinct category+value dedup key, never colliding with the rules
  // above) alongside, never instead of, its existing supporting-name
  // reference.
  { parameterName: "hairState", category: "SUBJECT_CONDITION_STATE", supportingParameterNames: [] },
  { parameterName: "shearOrientation", category: "TOOL_TO_SUBJECT_RELATIONSHIP", supportingParameterNames: [] },
  { parameterName: "guideStrandDirection", category: "TOOL_TO_SUBJECT_RELATIONSHIP", supportingParameterNames: [] },
  { parameterName: "distribution", category: "SUBJECT_TO_REFERENCE_GEOMETRY", supportingParameterNames: [] },
];

export type DemonstrationRequirementDerivationResult<TFact extends string = string> =
  | { status: "DERIVED"; requirements: readonly DemonstrationRequirement<TFact>[] }
  | { status: "NON_DERIVABLE"; reason: string };

export function deriveDemonstrationRequirementsFromAtomicAction<TFact extends string>(
  atomicAction: AtomicAction<TFact>,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
  isValidFact: (candidate: unknown) => candidate is TFact,
  derivedAt: string,
): DemonstrationRequirementDerivationResult<TFact> {
  if (!isValidAtomicAction(atomicAction, isValidFact)) {
    return { status: "NON_DERIVABLE", reason: "source Atomic Action failed structural validation" };
  }
  if (!isValidSkillInstance(skillInstance, isValidFact)) {
    return { status: "NON_DERIVABLE", reason: "source Skill Instance failed structural validation" };
  }
  if (!isValidExecutionUnit(executionUnit, isValidFact)) {
    return { status: "NON_DERIVABLE", reason: "source Execution Unit failed structural validation" };
  }
  if (atomicAction.sourceExecutionUnitId !== executionUnit.executionUnitId) {
    return { status: "NON_DERIVABLE", reason: "Atomic Action does not reference the given Execution Unit" };
  }
  if (!isExecutionUnitConsistentWithSourceSkillInstance(executionUnit, skillInstance)) {
    return { status: "NON_DERIVABLE", reason: "Execution Unit does not reference the given Skill Instance" };
  }

  const boundNames = new Set(atomicAction.boundParameterNames ?? []);
  const requirements: DemonstrationRequirement<TFact>[] = [];
  let counter = 1;

  for (const rule of DERIVATION_RULES) {
    if (!boundNames.has(rule.parameterName)) continue;
    const value = resolveEffectiveParameterValue(rule.parameterName, skillInstance, executionUnit);
    if (value === null) continue;

    const supportingNames = rule.supportingParameterNames.filter(
      (name) => boundNames.has(name) && resolveEffectiveParameterValue(name, skillInstance, executionUnit) !== null,
    );

    requirements.push({
      demonstrationRequirementId: `${atomicAction.atomicActionId}#requirement-${counter++}`,
      vertical: executionUnit.vertical,
      category: rule.category,
      subjectParameterNames: [rule.parameterName, ...supportingNames],
      subjectValue: value,
      sourceAtomicActionId: atomicAction.atomicActionId,
      presentationSummary: `Demonstrate: ${rule.category} (${rule.parameterName} = ${String(value)})`,
      derivedAt,
    });
  }

  if (executionUnit.zoneId) {
    requirements.push({
      demonstrationRequirementId: `${atomicAction.atomicActionId}#requirement-${counter++}`,
      vertical: executionUnit.vertical,
      category: "ANATOMICAL_CONTEXT",
      // `zoneId` is an Execution-Unit-level structured field, not a
      // Skill-declared parameter -- named here for the same traceability
      // purpose, not implying it is a bound-parameter reference.
      subjectParameterNames: ["zoneId"],
      subjectValue: executionUnit.zoneId,
      sourceAtomicActionId: atomicAction.atomicActionId,
      condition: executionUnit.applicabilityCondition,
      presentationSummary: `Demonstrate: ANATOMICAL_CONTEXT (zoneId = ${executionUnit.zoneId})`,
      derivedAt,
    });
  }

  return { status: "DERIVED", requirements: deduplicateDemonstrationRequirements(requirements) };
}
