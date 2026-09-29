import { isSkillEligibleForAuthority, isValidSkillDefinition, type SkillDefinition } from "@/lib/professional-skill-contracts";
import { isValidSkillInstance, type SkillInstance } from "@/lib/professional-skill-instance-contracts";
import { isExecutionUnitConsistentWithSourceSkillInstance, isValidExecutionUnit, type ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import type { AtomicAction, AtomicActionKind } from "@/lib/professional-skill-atomic-action-contracts";

// AI Hair Architect, Professional Skill Engine, B1 (Professional Brain
// CUT+COLOR slice) -- COLOR SKILL ATOMIC ACTION COMPILER. The color-
// vertical sibling of cutting-skill-atomic-action-compiler.ts, existing
// precisely because that file's own header already anticipates and
// requires this: "CUTTING-SPECIFIC, not universal... A Color/Treatment
// compiler would need its own, differently-keyed template table -- never
// forced through this one." This file reproduces that file's small,
// generic compilation shell (structural validation, resolveEffective
// ParameterValue, template-driven action loop) with its OWN
// COLOR_ACTION_TEMPLATES, keyed to this vertical's real parameter names
// (chemicalHistoryStatus/strandTestStatus) -- cutting-skill-atomic-action-
// compiler.ts itself is never imported or modified here, and its own real
// CUT behavior is unaffected by this file's existence.
//
// SAFETY: deliberately NO template ever produces an EXECUTE-kind action.
// This vertical's real content (color-skill-global-single-process-
// evaluation-gate.ts) never asserts a chemical operation happened -- only
// PREPARE (chemical-history confirmation) and CONTROL (strand-test
// confirmation) kinds, matching this stage's own explicit "never generate
// executable chemical instructions" instruction. A future, separately
// authorized stage that models real color EXECUTION would need its own,
// separately-reviewed template additions here -- never silently added by
// widening this file's scope.

const COLOR_ACTION_TEMPLATES: readonly { kind: AtomicActionKind; requiredParams: readonly string[]; optionalParams: readonly string[] }[] = [
  { kind: "PREPARE", requiredParams: ["chemicalHistoryStatus"], optionalParams: ["professionalDeterminationRecorded"] },
  { kind: "CONTROL", requiredParams: ["strandTestStatus"], optionalParams: [] },
];

export interface ColorAtomicActionCompilationSuccess<TFact extends string = string> {
  status: "COMPILED";
  actions: readonly AtomicAction<TFact>[];
}

export interface ColorAtomicActionCompilationFailure {
  status: "UNRESOLVED";
  reason: string;
  missingParameterNames?: readonly string[];
}

export type ColorAtomicActionCompilationResult<TFact extends string = string> = ColorAtomicActionCompilationSuccess<TFact> | ColorAtomicActionCompilationFailure;

// Byte-identical resolution precedence to cutting-skill-atomic-action-
// compiler.ts's own resolveEffectiveParameterValue (Execution-Unit rule
// wins over Skill-Instance binding; only a REQUIRED_FIXED rule or a
// resolved, non-UNRESOLVED binding ever yields a concrete value) --
// duplicated rather than imported/exported-and-shared because that
// function is private to its own file and this compiler's own "no shared
// dependency with the cutting compiler" boundary is deliberate (see file
// header).
function resolveEffectiveParameterValue<TFact extends string>(
  parameterName: string,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
): { value: string | boolean | number } | null {
  const euRule = executionUnit.parameterRules?.find((r) => r.parameterName === parameterName);
  if (euRule) {
    if (euRule.semantic === "REQUIRED_FIXED" && euRule.fixedValue !== undefined) {
      return { value: euRule.fixedValue };
    }
    return null;
  }
  const binding = skillInstance.parameterBindings.find((b) => b.parameterName === parameterName);
  if (binding && binding.bindingState !== "UNRESOLVED" && binding.value !== undefined) {
    return { value: binding.value };
  }
  return null;
}

export function compileColorExecutionUnitToAtomicActions<TFact extends string>(
  skillDefinition: SkillDefinition<TFact>,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
  isValidFact: (candidate: unknown) => candidate is TFact,
  compiledAt: string,
): ColorAtomicActionCompilationResult<TFact> {
  if (!isValidSkillDefinition(skillDefinition, isValidFact)) {
    return { status: "UNRESOLVED", reason: "source Skill Definition failed structural validation" };
  }
  if (!isValidSkillInstance(skillInstance, isValidFact)) {
    return { status: "UNRESOLVED", reason: "source Skill Instance failed structural validation" };
  }
  if (!isValidExecutionUnit(executionUnit, isValidFact)) {
    return { status: "UNRESOLVED", reason: "source Execution Unit failed structural validation" };
  }
  if (skillInstance.sourceSkillId !== skillDefinition.skillId || skillInstance.sourceSkillVersion !== skillDefinition.version) {
    return { status: "UNRESOLVED", reason: "Skill Instance does not reference the given Skill Definition/version" };
  }
  if (!isExecutionUnitConsistentWithSourceSkillInstance(executionUnit, skillInstance)) {
    return { status: "UNRESOLVED", reason: "Execution Unit does not reference the given Skill Instance" };
  }
  if (!isSkillEligibleForAuthority(skillDefinition)) {
    return { status: "UNRESOLVED", reason: "source Skill Definition is not eligible professional authority" };
  }

  const resolved = new Map<string, string | boolean | number>();
  const missing: string[] = [];
  for (const parameter of skillDefinition.parameters) {
    const result = resolveEffectiveParameterValue(parameter.name, skillInstance, executionUnit);
    if (result === null) {
      missing.push(parameter.name);
    } else {
      resolved.set(parameter.name, result.value);
    }
  }
  if (missing.length > 0) {
    return {
      status: "UNRESOLVED",
      reason: "one or more Skill-declared parameters have no resolved structured value in the given Skill Instance/Execution Unit -- this color evaluation gate blocks compilation rather than assuming sufficient data",
      missingParameterNames: missing,
    };
  }

  const actions: AtomicAction<TFact>[] = [];
  let order = 1;
  for (const template of COLOR_ACTION_TEMPLATES) {
    if (!template.requiredParams.every((p) => resolved.has(p))) continue;
    const boundParameterNames = [...template.requiredParams, ...template.optionalParams.filter((p) => resolved.has(p))];
    actions.push({
      atomicActionId: `${executionUnit.executionUnitId}#${template.kind.toLowerCase()}`,
      vertical: executionUnit.vertical,
      order: order++,
      actionKind: template.kind,
      sourceExecutionUnitId: executionUnit.executionUnitId,
      sourceSkillId: skillInstance.sourceSkillId,
      sourceSkillVersion: skillInstance.sourceSkillVersion,
      boundParameterNames,
      precondition: executionUnit.applicabilityCondition,
      presentationSummary: `Compiled ${template.kind} action for ${executionUnit.label}`,
      compiledAt,
    });
  }

  if (actions.length === 0) {
    return { status: "UNRESOLVED", reason: "no action template's required parameters resolved -- nothing compilable for this Execution Unit" };
  }

  return { status: "COMPILED", actions };
}
