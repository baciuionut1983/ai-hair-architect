import type { SkillCapabilityKind, SkillParameterDefinition } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import {
  isProfessionalReasoningProposal,
  type ProfessionalReasoningContext,
  type ProfessionalReasoningPreserveConstraint,
  type ProfessionalReasoningProposal,
  type ProposedSkillParameter,
  type ProposedSkillStep,
} from "@/lib/professional-reasoning-contracts";

// AI Hair Architect, Professional Skill Engine Stage 5 -- PROFESSIONAL
// REASONING VALIDATOR. Pure, deterministic, no I/O, no AI. THE safety-
// critical file: "never trust raw LLM output directly." Every rejection
// path here is exercised by a dedicated adversarial test
// (professional-reasoning-validator.test.ts) -- this file's own
// correctness IS the boundary between "AI helps reason about options" and
// "AI silently becomes professional authority."
//
// KEY DESIGN INSIGHT, load-bearing: Stage 4's own deterministic selector
// (hair-state-delta-skill-candidate-selector.ts) ALREADY performs
// registry existence, exact-version resolution, capability-declaration,
// zone-scope, and applicability evaluation -- ProfessionalReasoningContext
// .candidateSkills (built by buildProfessionalReasoningContext, Part A) is
// the OUTPUT of that already-vetted process: every entry in it is, by
// construction, a real skill/version, with a real declared capability,
// whose applicability already resolved APPLICABLE (Stage 4's selector
// only ever populates candidateMatches -- what candidateSkills is mapped
// from -- with applicabilityResult === "APPLICABLE"; INAPPLICABLE/UNKNOWN
// results go to rejectedMatches, never surfaced to the AI at all).
//
// Therefore a SINGLE membership check --
// "does (skillDefinitionId, skillVersion, addressesDelta, declaredCapability)
// exist verbatim in context.candidateSkills?" -- simultaneously proves:
//   - the skill exists in the registry (never invented)
//   - the exact version is correct (never a wrong/stale version)
//   - the skill is in the ALLOWED candidate set (never a non-candidate)
//   - the capability is genuinely declared (never claimed)
//   - applicability was never FALSE (only APPLICABLE entries are present)
//   - an UNKNOWN precondition was never silently promoted to TRUE (same
//     reason)
//   - the addressed delta genuinely exists and genuinely needs this
//     capability (candidateSkills is itself delta-derived)
// This is not a shortcut -- it is the correct consequence of Stage 4
// already having done this work once, deterministically; re-deriving it
// here would risk the two layers drifting into two different answers.
//
// What THIS file adds on top (real, new checks Stage 4 cannot do, because
// they only make sense once a PROPOSAL exists):
//   - parameter values are within each skill's own declared allowedValues
//     (needs the full SkillDefinition, not just its identity)
//   - every input preservation constraint survives into the output,
//     verbatim (never silently dropped)
//   - every unresolved-context delta not addressed by a step is honestly
//     re-reported as unresolved (never silently "solved")
//   - no duplicate step, no directly conflicting capability pair on the
//     same delta
// The validated, returned proposal is always a FRESH object built field-
// by-field from validated data -- never the raw parsed JSON passed
// through -- so no unexpected extra key from a malicious/malformed
// response can ever survive into what downstream code trusts.

export interface ProfessionalReasoningValidationSuccess {
  valid: true;
  proposal: ProfessionalReasoningProposal;
}

export interface ProfessionalReasoningValidationFailure {
  valid: false;
  rejectionReasons: readonly string[];
}

export type ProfessionalReasoningValidationResult = ProfessionalReasoningValidationSuccess | ProfessionalReasoningValidationFailure;

// Capability pairs that can never both legitimately apply to the exact
// same (scope, field) delta at once -- a minimal, explicit, deterministic
// conflict table (never a semantic/LLM judgment).
const CONFLICTING_CAPABILITY_PAIRS: ReadonlyArray<readonly [SkillCapabilityKind, SkillCapabilityKind]> = [
  ["REDUCE_LENGTH", "INCREASE_LENGTH"],
  ["REDUCE_WEIGHT", "BUILD_WEIGHT"],
];

function capabilitiesConflict(a: SkillCapabilityKind, b: SkillCapabilityKind): boolean {
  return CONFLICTING_CAPABILITY_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function deltaKey(entry: { scope: string; field: string }): string {
  return `${entry.scope}::${entry.field}`;
}

function candidateKey(entry: { skillDefinitionId: string; skillVersion: number; addressesDelta: { scope: string; field: string }; matchedCapability?: SkillCapabilityKind; declaredCapabilityUsed?: SkillCapabilityKind }): string {
  const capability = entry.matchedCapability ?? entry.declaredCapabilityUsed;
  return `${entry.skillDefinitionId}::v${entry.skillVersion}::${deltaKey(entry.addressesDelta)}::${capability}`;
}

function findParameterDefinition(parameters: readonly SkillParameterDefinition[], name: string): SkillParameterDefinition | undefined {
  return parameters.find((p) => p.name === name);
}

function isParameterValueAllowed(definition: SkillParameterDefinition, proposed: ProposedSkillParameter): boolean {
  if (definition.valueKind === "enum") {
    return (definition.allowedValues ?? []).includes(proposed.value);
  }
  if (definition.valueKind === "boolean") return typeof proposed.value === "boolean";
  if (definition.valueKind === "number") return typeof proposed.value === "number";
  if (definition.valueKind === "string") return typeof proposed.value === "string";
  return false;
}

export function validateProfessionalReasoningProposal(
  rawProposal: unknown,
  context: ProfessionalReasoningContext,
  allowedSkills: readonly ProfessionalSkillDefinitionRecord[],
): ProfessionalReasoningValidationResult {
  // --- 1. SCHEMA VALIDATION ---
  if (!isProfessionalReasoningProposal(rawProposal)) {
    return { valid: false, rejectionReasons: ["SCHEMA_VALIDATION_FAILED: the response is not a structurally valid ProfessionalReasoningProposal."] };
  }

  const reasons: string[] = [];
  const candidateByKey = new Map(context.candidateSkills.map((c) => [candidateKey(c), c]));
  const skillById = new Map(allowedSkills.map((s) => [s.id, s]));

  const seenStepKeys = new Set<string>();
  const addressedDeltaKeys = new Set<string>();
  const stepsByDeltaKey = new Map<string, ProposedSkillStep[]>();

  for (const step of rawProposal.proposedSkills) {
    // --- 2. REGISTRY + 3. CAPABILITY + 4. APPLICABILITY (one combined,
    // load-bearing check -- see file header) ---
    const key = candidateKey(step);
    const candidate = candidateByKey.get(key);
    if (!candidate) {
      reasons.push(
        `REGISTRY_OR_APPLICABILITY_REJECTED: step "${step.stepId}" proposes skill "${step.skillKey}" v${step.skillVersion} with capability ${step.declaredCapabilityUsed} for ${deltaKey(step.addressesDelta)}, which is not a real, applicable candidate for this context.`,
      );
      continue;
    }

    // --- Duplicate step detection ---
    if (seenStepKeys.has(key)) {
      reasons.push(`DUPLICATE_STEP: skill "${step.skillKey}" v${step.skillVersion} is proposed more than once for the same delta ${deltaKey(step.addressesDelta)}.`);
    }
    seenStepKeys.add(key);

    // --- 5. PARAMETER VALIDATION ---
    const skillRecord = skillById.get(step.skillDefinitionId);
    if (!skillRecord) {
      reasons.push(`REGISTRY_LOOKUP_FAILED: skill definition "${step.skillDefinitionId}" was not found among the allowed skill records supplied to this validator.`);
    } else {
      for (const parameter of step.parameters) {
        const definition = findParameterDefinition(skillRecord.payload.parameters, parameter.name);
        if (!definition) {
          reasons.push(`INVALID_PARAMETER: step "${step.stepId}" proposes parameter "${parameter.name}", which skill "${step.skillKey}" v${step.skillVersion} does not declare.`);
          continue;
        }
        if (!isParameterValueAllowed(definition, parameter)) {
          reasons.push(
            `INVALID_PARAMETER_VALUE: step "${step.stepId}" proposes ${parameter.name}=${JSON.stringify(parameter.value)}, which is not an allowed value for skill "${step.skillKey}" v${step.skillVersion}.`,
          );
        }
      }
    }

    addressedDeltaKeys.add(deltaKey(step.addressesDelta));
    const existing = stepsByDeltaKey.get(deltaKey(step.addressesDelta)) ?? [];
    existing.push(step);
    stepsByDeltaKey.set(deltaKey(step.addressesDelta), existing);
  }

  // --- Conflicting capability pairs on the same delta ---
  for (const [key, steps] of stepsByDeltaKey) {
    for (let i = 0; i < steps.length; i += 1) {
      for (let j = i + 1; j < steps.length; j += 1) {
        if (capabilitiesConflict(steps[i].declaredCapabilityUsed, steps[j].declaredCapabilityUsed)) {
          reasons.push(`CONFLICTING_REQUIREMENT: delta ${key} has both ${steps[i].declaredCapabilityUsed} and ${steps[j].declaredCapabilityUsed} proposed, which cannot both be true.`);
        }
      }
    }
  }

  // --- 6. DELTA COVERAGE VALIDATION -- an unresolved-context delta the
  // AI didn't address must still be honestly reported as unresolved,
  // never silently dropped or silently marked solved. ---
  const reportedUnresolvedKeys = new Set(rawProposal.unresolvedRequirements.map((r) => deltaKey(r)));
  for (const unresolved of context.unresolvedDeltas) {
    const key = deltaKey(unresolved);
    if (addressedDeltaKeys.has(key)) continue; // a valid step claims to address it -- fine, already checked above.
    if (!reportedUnresolvedKeys.has(key)) {
      reasons.push(`UNRESOLVED_DELTA_DROPPED: delta ${key} is unresolved in this context and was neither addressed by a valid step nor reported as unresolved.`);
    }
  }

  // --- 7. PRESERVATION-CONSTRAINT VALIDATION -- every input constraint
  // must survive into the output verbatim. ---
  const outputConstraintKeys = new Set(rawProposal.preservationConstraints.map((c) => `${deltaKey(c)}::${c.value}`));
  for (const constraint of context.preserveConstraints) {
    const key = `${deltaKey(constraint)}::${constraint.value}`;
    if (!outputConstraintKeys.has(key)) {
      reasons.push(`PRESERVE_CONSTRAINT_DROPPED: constraint "${constraint.description}" was present in the input context but is missing from the proposal's own preservationConstraints.`);
    }
  }

  if (reasons.length > 0) {
    return { valid: false, rejectionReasons: reasons };
  }

  // Rebuild a fresh, clean object from validated fields only -- never a
  // passthrough of rawProposal itself (see file header).
  const proposal: ProfessionalReasoningProposal = {
    schemaVersion: rawProposal.schemaVersion,
    planSummary: rawProposal.planSummary,
    proposedSkills: rawProposal.proposedSkills.map((step) => ({
      stepId: step.stepId,
      skillDefinitionId: step.skillDefinitionId,
      skillKey: step.skillKey,
      skillVersion: step.skillVersion,
      zone: step.zone,
      addressesDelta: { scope: step.addressesDelta.scope, field: step.addressesDelta.field },
      declaredCapabilityUsed: step.declaredCapabilityUsed,
      parameters: step.parameters.map((p) => ({ name: p.name, value: p.value })),
      rationale: step.rationale,
    })),
    proposedOrder: [...rawProposal.proposedOrder],
    preservationConstraints: rawProposal.preservationConstraints.map((c) => cloneConstraint(c)),
    unresolvedRequirements: rawProposal.unresolvedRequirements.map((r) => ({ scope: r.scope, field: r.field, reason: r.reason })),
    clarifyingQuestions: [...rawProposal.clarifyingQuestions],
    reasoningStatus: rawProposal.reasoningStatus,
  };

  return { valid: true, proposal };
}

function cloneConstraint(c: ProfessionalReasoningPreserveConstraint): ProfessionalReasoningPreserveConstraint {
  return { scope: c.scope, field: c.field, value: c.value, description: c.description };
}
