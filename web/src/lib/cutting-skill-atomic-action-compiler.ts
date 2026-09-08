import { isSkillEligibleForAuthority, isValidSkillDefinition, type SkillDefinition } from "@/lib/professional-skill-contracts";
import { isValidSkillInstance, type SkillInstance } from "@/lib/professional-skill-instance-contracts";
import { isExecutionUnitConsistentWithSourceSkillInstance, isValidExecutionUnit, type ExecutionUnit } from "@/lib/professional-skill-execution-unit-contracts";
import { type AtomicAction, type AtomicActionKind } from "@/lib/professional-skill-atomic-action-contracts";

// AI Hair Architect, Stage 2.5.i.8 -- CUTTING SKILL ATOMIC ACTION COMPILER.
// The FIRST use of the Stage 2.5.i.4 Atomic Action contract with REAL
// professional authority: a small, pure, deterministic function that
// transforms one already-authorized Skill Definition + Skill Instance +
// Execution Unit (Stage 2.5.i.1/i.5/i.3, real content from Stage 2.5.i.6
// and Stage 2.5.i.7) into a compiled AtomicAction[] sequence. ZERO
// Composition Engine, ZERO Skill selection, ZERO DB/provider/AI calls,
// ZERO wiring into Technical Demonstration Plan/readiness/coherence/the
// generator, ZERO VideoInstruction -- calling this function has ZERO
// runtime effect anywhere in the application today.
//
// CUTTING-SPECIFIC, not universal -- named accordingly (mirrors the
// cutting-skill-*.ts naming family, deliberately NOT professional-skill-
// *-contracts.ts): the ACTION_TEMPLATES dispatch table below is keyed by
// cutting-domain parameter names (clientHeadPosition, controlMethod,
// elevation, ...) that are real for the two existing cutting Skills but
// have no claim to universality. A Color/Treatment compiler would need
// its own, differently-keyed template table -- never forced through this
// one.
//
// CORE PRINCIPLE (this stage's own explicit boundary): this compiler may
// ONLY transform already-authorized STRUCTURED truth. It NEVER reads
// `label`/`description`/`rationale`/`instruction` text to discover a
// technical fact -- only `SkillInstance.parameterBindings` and
// `ExecutionUnit.parameterRules` (both fully structured) are ever
// consulted for VALUES. `label` is reused only for the compiled action's
// OWN `presentationSummary` (presentation-to-presentation, never
// presentation-to-technical-authority). FAILS CLOSED: if a Skill-declared
// parameter has no resolved structured value anywhere in the given
// Instance/Execution Unit pair, the whole compilation is refused --
// never a partial, silently-incomplete Atomic Action set.
//
// RESOLUTION PRECEDENCE: an Execution Unit's own `parameterRules` (Stage
// 2.5.i.3, context-scoped) take precedence over the Skill Instance's own
// `parameterBindings` (Stage 2.5.i.5, instance-wide) for the same
// parameter name -- mirrors this domain's established "more specific
// context wins" discipline (e.g. professional overrides over baseline).
// Only `REQUIRED_FIXED` Execution-Unit rules resolve to a concrete value
// here; every other semantic (PROFESSIONAL_CHOICE, REQUIRED_CONDITIONAL,
// ...) represents a value this compile-time exercise cannot honestly
// resolve without further runtime/professional input, and is treated as
// unresolved -- fail-closed, never guessed.
//
// ACTION TEMPLATES -- a small, fixed, GENERIC structural dispatch (never
// per-Skill special-cased code): each template names a closed
// AtomicActionKind (reused verbatim from Stage 2.5.i.4 -- no new kind
// introduced) plus the parameter names that must resolve for it to fire.
// A template fires (emits one Atomic Action) only when ALL of its
// required parameter names resolve for the given Execution Unit; the
// SAME three templates are evaluated for every Execution Unit this
// compiler ever sees -- what varies is only which templates' required
// parameters happen to resolve, never the dispatch logic itself. This is
// why "Occipital Transition"'s two Execution Units naturally compile to
// DIFFERENT, distinguishable CONTROL actions (comb vs fingers) without
// any per-Skill branching in this file.
//
// PRECONDITION TRACEABILITY: a compiled action's own `precondition` is
// the source Execution Unit's `applicabilityCondition`, copied verbatim,
// never re-evaluated or re-interpreted -- if an action is only applicable
// under a condition, that stays structurally traceable on the action
// itself (this stage's own explicit requirement).
//
// DEMONSTRATION TARGET, never RUNTIME OBSERVATION: no template here
// produces an OBSERVE/VERIFY-kind action (nothing in Stage 2.5.i.6/i.7's
// real, authorized content calls for one) -- so no compiled action ever
// carries an `observationCriterion`, and in particular none can ever
// falsely claim `RUNTIME_PROFESSIONAL_OBSERVATION` (Stage 2.5.i.4's own
// evidence-status distinction). A future template that DID compile an
// observation action would be REQUIRED to tag it `DEMONSTRATED_TARGET`
// here, since this is a pure, offline compilation exercise with no live
// camera/professional input -- documented, not implemented, since no
// such template is needed for the real content this stage compiles.

// Stage 2.5.i.19: "hairState" added to EXECUTE's own optionalParams --
// the Stage 2.5.i.18 audit found that wet/dry hair state (real, already-
// bound authority on both real Skills) previously could never bind onto
// the EXECUTE action at all, even though EXECUTE is the one action where
// visibly-wet hair matters most (the cutting itself). Purely additive --
// EXECUTE's own requiredParams and every other template are unchanged,
// and this only ever resolves/derives a requirement where a real Skill
// Instance actually binds hairState (fail-closed, same as every other
// optional param here) -- never made globally required, since not every
// vertical/action has wet/dry semantics.
const ACTION_TEMPLATES: readonly { kind: AtomicActionKind; requiredParams: readonly string[]; optionalParams: readonly string[] }[] = [
  { kind: "POSITION", requiredParams: ["clientHeadPosition"], optionalParams: ["hairState"] },
  { kind: "CONTROL", requiredParams: ["controlMethod"], optionalParams: ["hairState", "guideStrandDirection", "distribution"] },
  { kind: "EXECUTE", requiredParams: ["elevation", "cuttingTechnique", "structuralTechnique"], optionalParams: ["hairState", "tool", "shearOrientation", "cuttingLineShape", "distribution", "overdirection"] },
];

export interface AtomicActionCompilationSuccess<TFact extends string = string> {
  status: "COMPILED";
  actions: readonly AtomicAction<TFact>[];
}

export interface AtomicActionCompilationFailure {
  status: "UNRESOLVED";
  reason: string;
  missingParameterNames?: readonly string[];
}

export type AtomicActionCompilationResult<TFact extends string = string> = AtomicActionCompilationSuccess<TFact> | AtomicActionCompilationFailure;

function resolveEffectiveParameterValue<TFact extends string>(
  parameterName: string,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
): { value: string | boolean | number } | null {
  // Execution-Unit-level rule takes precedence, and ONLY a REQUIRED_FIXED
  // rule with a real fixedValue is directly resolvable at compile time.
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

export function compileExecutionUnitToAtomicActions<TFact extends string>(
  skillDefinition: SkillDefinition<TFact>,
  skillInstance: SkillInstance<TFact>,
  executionUnit: ExecutionUnit<TFact>,
  isValidFact: (candidate: unknown) => candidate is TFact,
  compiledAt: string,
): AtomicActionCompilationResult<TFact> {
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
  // Unreviewed/AI-draft/non-ACTIVE authority can never compile as trusted
  // professional action -- same governance principle as every eligibility
  // check in this domain.
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
      reason: "one or more Skill-declared parameters have no resolved structured value in the given Skill Instance/Execution Unit",
      missingParameterNames: missing,
    };
  }

  const actions: AtomicAction<TFact>[] = [];
  let order = 1;
  for (const template of ACTION_TEMPLATES) {
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
      // Verbatim passthrough -- never re-evaluated, never re-interpreted.
      precondition: executionUnit.applicabilityCondition,
      // Presentation-to-presentation reuse only -- eu.label is itself
      // never technical authority, and neither is this.
      presentationSummary: `Compiled ${template.kind} action for ${executionUnit.label}`,
      compiledAt,
    });
  }

  if (actions.length === 0) {
    return { status: "UNRESOLVED", reason: "no action template's required parameters resolved -- nothing compilable for this Execution Unit" };
  }

  return { status: "COMPILED", actions };
}
