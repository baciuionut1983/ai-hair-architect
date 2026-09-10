import { isRecord } from "@/lib/technical-visual-map-validators";

// AI Hair Architect, Stage 2.5.i.1 -- PROFESSIONAL SKILL DEFINITION,
// contract/foundation only. Types + pure validators, no I/O, no database,
// no provider call, no AI -- mirrors Stage 2.5.h.2b's own established
// "Stage 1" convention (technical-demonstration-execution-profile-contracts.ts)
// exactly: a shared vocabulary + runtime guards, nothing more.
//
// ARCHITECTURAL LOCK (Stage 2.5.i audit): a Professional Skill is a
// reusable, professionally-governed PROCEDURE -- never a bare scalar
// value. The Stage 2.5.i audit's own boundary test: if it has its OWN
// execution steps, it's a Skill; if it's just a value that configures a
// Skill's execution, it's a Parameter; if it's a predicate deciding which
// value/skill applies, it's a Condition; if it proves two things cannot
// coexist, it's a Compatibility Rule. This file enforces that boundary
// structurally wherever a type system honestly can (a `procedure` array
// with fewer than 2 real steps is rejected -- see isValidSkillDefinition
// below) and documents where it cannot: whether a given 2-step procedure
// is a REAL skill or a disguised parameter pair dressed up as one is
// ultimately a professional review judgment, never fully mechanizable --
// this contract nudges toward correctness, it does not claim to
// automate the judgment itself.
//
// DELIBERATELY NOT REUSING technical-demonstration-execution-profile-
// contracts.ts's own ExecutionRuleCondition TYPE DIRECTLY: that type is
// hardcoded to cutting's own closed fact vocabulary
// (ExecutionRuleConditionFact). Genericizing it in place would require
// editing a stable, already-shipped, 42-test file for zero runtime
// benefit this stage. Instead, this file reproduces the EXACT SAME
// condition LANGUAGE (five operators: equals/in/and/or/not, a closed
// data-only tree, no callback, no eval, no free-form expression) as a
// generic type parameterized over the fact-name type -- the proven SHAPE
// is reused faithfully; only the concrete fact vocabulary differs per
// vertical, exactly the "common governance, vertical-specific vocabulary"
// split the Stage 2.5.i audit itself locked.
//
// THIS FILE DOES NOT:
//   - compose plans, select skills, or resolve any runtime authority --
//     zero wiring into AnalysisProposal, Technical Demonstration Plan,
//     readiness, coherence, derivation, or the generator;
//   - decide the future ExecutionUnit/AtomicAction granularity model
//     (Stage 2.5.h's own deepest open question, explicitly deferred to
//     its own separate audit) -- SkillProcedureStep is deliberately a
//     plain, human-readable instruction label, never bound to
//     CuttingDemonstrationStepPayload or any Technical Demonstration
//     step shape;
//   - hardcode a single vertical -- `vertical` is a plain string (mirrors
//     AnalysisProposal's own unconstrained vertical column), and every
//     parameter/condition-fact/zone vocabulary is supplied BY the skill
//     author, never assumed by this contract;
//   - persist anything -- no Prisma model, no migration;
//   - encode any real professional skill content -- every example
//     anywhere near this concept, in tests only, is explicitly labeled
//     "SYNTHETIC TEST FIXTURE -- not a real professional rule."

// ---------------------------------------------------------------------------
// Condition model -- see the file header for why this mirrors, rather
// than imports, Stage 2.5.h.2b's own ExecutionRuleCondition shape.
// ---------------------------------------------------------------------------

export interface SkillConditionEquals<TFact extends string> {
  op: "equals";
  fact: TFact;
  value: string | boolean;
}
export interface SkillConditionIn<TFact extends string> {
  op: "in";
  fact: TFact;
  values: readonly (string | boolean)[];
}
export interface SkillConditionAnd<TFact extends string> {
  op: "and";
  conditions: readonly SkillCondition<TFact>[];
}
export interface SkillConditionOr<TFact extends string> {
  op: "or";
  conditions: readonly SkillCondition<TFact>[];
}
export interface SkillConditionNot<TFact extends string> {
  op: "not";
  condition: SkillCondition<TFact>;
}
export type SkillCondition<TFact extends string> =
  | SkillConditionEquals<TFact>
  | SkillConditionIn<TFact>
  | SkillConditionAnd<TFact>
  | SkillConditionOr<TFact>
  | SkillConditionNot<TFact>;

function isConditionLiteral(value: unknown): value is string | boolean {
  return typeof value === "string" || typeof value === "boolean";
}

// `isValidFact` is caller-supplied (mirrors isProvenanceValue's own
// isInner-parameter pattern, technical-demonstration-contracts.ts) -- this
// file has no opinion on what facts any given vertical's skills may
// reference. Each vertical's own skill-authoring module supplies its own
// closed fact guard, exactly like cutting's own
// EXECUTION_RULE_CONDITION_FACTS list already does one level up. The
// recursive shape is closed: any `op` outside this exact five-member set
// (including, deliberately, no "javascript"/"eval"/"expression" op ever
// existing) is rejected, not silently ignored.
export function isValidSkillCondition<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is SkillCondition<TFact> {
  if (!isRecord(value)) return false;
  switch (value.op) {
    case "equals":
      return isValidFact(value.fact) && isConditionLiteral(value.value);
    case "in":
      return isValidFact(value.fact) && Array.isArray(value.values) && value.values.length > 0 && value.values.every(isConditionLiteral);
    case "and":
    case "or":
      return Array.isArray(value.conditions) && value.conditions.length > 0 && value.conditions.every((c) => isValidSkillCondition(c, isValidFact));
    case "not":
      return isValidSkillCondition(value.condition, isValidFact);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Parameter model -- a Skill's own typed configuration surface. Every
// parameter declares a real, closed shape -- never bare, unconstrained
// free text as technical authority. `valueKind: "string"` is still
// permitted (some genuinely free-text facts exist, e.g. a tool name), but
// it is an EXPLICIT, declared choice, never a silent default -- and it
// structurally cannot carry a contradictory `allowedValues` list.
// ---------------------------------------------------------------------------

export const SKILL_PARAMETER_VALUE_KINDS = ["enum", "boolean", "number", "string"] as const;
export type SkillParameterValueKind = (typeof SKILL_PARAMETER_VALUE_KINDS)[number];

export interface SkillParameterDefinition {
  name: string;
  valueKind: SkillParameterValueKind;
  // Required, non-empty, ONLY for valueKind "enum" -- a closed, named set
  // of legal values. A skill author reuses an EXISTING vertical enum's own
  // option array here wherever one exists (e.g. cutting's own
  // ELEVATION_OPTIONS, proposal-validators.ts) rather than re-typing a
  // duplicate list -- this contract never mandates a new vocabulary when
  // a real one already exists.
  allowedValues?: readonly (string | boolean | number)[];
  description: string;
}

export function isValidSkillParameterDefinition(value: unknown): value is SkillParameterDefinition {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || value.name.length === 0) return false;
  if (!(SKILL_PARAMETER_VALUE_KINDS as readonly string[]).includes(value.valueKind as string)) return false;
  if (typeof value.description !== "string" || value.description.trim().length === 0) return false;

  const hasAllowedValues = "allowedValues" in value && value.allowedValues !== undefined;
  if (value.valueKind === "enum") {
    return (
      hasAllowedValues &&
      Array.isArray(value.allowedValues) &&
      value.allowedValues.length > 0 &&
      value.allowedValues.every((v) => typeof v === "string" || typeof v === "boolean" || typeof v === "number")
    );
  }
  // boolean/number/string kinds are self-describing -- allowedValues here
  // would be a contradiction (either redundant or silently narrowing a
  // supposedly-open kind), so it is deliberately forbidden.
  return !hasAllowedValues;
}

// ---------------------------------------------------------------------------
// Procedure model -- see file header. The smallest honest representation
// of "an ordered professional procedure": a label, never a compiled or
// executable action, and never bound to any Technical Demonstration step
// shape.
// ---------------------------------------------------------------------------

export interface SkillProcedureStep {
  order: number;
  instruction: string;
  // Optional: which of this skill's OWN declared parameters this specific
  // step depends on -- lets a future compiler know which values matter at
  // which point, without committing to HOW compilation happens.
  referencedParameters?: readonly string[];
}

function isValidSkillProcedureStep(value: unknown, declaredParameterNames: ReadonlySet<string>): value is SkillProcedureStep {
  if (!isRecord(value)) return false;
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1) return false;
  if (typeof value.instruction !== "string" || value.instruction.trim().length === 0) return false;
  if (value.referencedParameters !== undefined) {
    if (!Array.isArray(value.referencedParameters)) return false;
    if (!value.referencedParameters.every((p) => typeof p === "string" && declaredParameterNames.has(p))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lifecycle / authority -- DRAFT|ACTIVE|RETIRED status and a governance
// model that structurally prevents unreviewed content from ever counting
// as active authority merely by existing. Deliberately a NEW, separately-
// named constant/type (not an import of Stage 2.5.h.2b's own
// ExecutionProfileStatus/ExecutionProfileAuthorityType) -- this codebase's
// own established convention already tolerates small, independently-named,
// structurally-similar lifecycle enums per entity type (e.g.
// TECHNICAL_DEMONSTRATION_PLAN_STATUSES vs. Technical Visual Map's own
// nearly-identical status enum) rather than forcing every governed entity
// through one shared "Status" type; naming a Skill's own status
// `ExecutionProfileStatus` would read as a naming bug, not a reuse win.
// ---------------------------------------------------------------------------

export const SKILL_DEFINITION_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export type SkillDefinitionStatus = (typeof SKILL_DEFINITION_STATUSES)[number];

export function isSkillDefinitionStatus(value: unknown): value is SkillDefinitionStatus {
  return typeof value === "string" && (SKILL_DEFINITION_STATUSES as readonly string[]).includes(value);
}

// PROFESSIONALLY_AUTHORED -- written directly by a reviewed professional
//   process (this engagement's own audit -> authorize -> implement -> test
//   -> release gate).
// PROFESSIONALLY_REVIEWED -- originated elsewhere but has since passed the
//   SAME human review.
// MACHINE_DRAFTED -- AI-assisted or otherwise generated, NOT yet reviewed.
//   Can exist only as DRAFT status (see isValidSkillDefinition below) --
//   never ACTIVE, and never eligible authority (isSkillEligibleForAuthority).
export const SKILL_AUTHORITY_TYPES = ["PROFESSIONALLY_AUTHORED", "PROFESSIONALLY_REVIEWED", "MACHINE_DRAFTED"] as const;
export type SkillAuthorityType = (typeof SKILL_AUTHORITY_TYPES)[number];

export function isSkillAuthorityType(value: unknown): value is SkillAuthorityType {
  return typeof value === "string" && (SKILL_AUTHORITY_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Skill Capability -- Stage 4 addition. The smallest structured vocabulary
// that lets a deterministic selector ask "can this skill contribute to
// this required state transformation?" without resorting to free-text/
// name/description matching (Stage 4's own explicit fail-closed rule).
//
// Deliberately trimmed to EXACTLY what hair-state-delta.ts's own
// HairStateDeltaTransformation categories can actually express, never the
// task's own full illustrative list -- "creates movement" and "increases
// layering" were considered and rejected: HairStateSnapshot's own file
// header already deliberately excludes a separate movement/layering axis
// (movement is HairTexture's own vocabulary; layering is already
// expressible via weightIntent), so a capability kind with no
// corresponding delta field to ever match against would be dead
// vocabulary -- exactly the "invent false precision" this engagement
// consistently refuses to do.
//
// TWO FAMILIES, both real and useful, kept structurally distinct:
//   OUTCOME kinds (REDUCE_LENGTH/PRESERVE_LENGTH/INCREASE_LENGTH/
//   REDUCE_WEIGHT/BUILD_WEIGHT/PRESERVE_WEIGHT/PRESERVE_PERIMETER/
//   MODIFY_PERIMETER_RELATIONSHIP) -- these are what Stage 4's own
//   candidate selector (hair-state-delta-skill-candidate-selector.ts)
//   actually matches against HairStateDeltaEntry transformations.
//   PROCEDURAL kinds (ESTABLISH_GUIDE/CONNECT_ZONES/CROSS_CHECK_VALIDATE/
//   REFINE_ENDS) -- real, honest things a skill does, but NOT a state
//   transformation a delta ever expresses on its own; declared now so
//   real skills can describe themselves completely, but Stage 4's own
//   selector never targets these directly (a future Stage 5+ composition/
//   ordering engine is the intended consumer). ESTABLISH_GUIDE is the one
//   exception matched by Stage 4 too, in the specific case of a
//   newly-added (no prior CURRENT baseline) length requirement -- see the
//   selector's own header for why.
//
// A skill may declare MULTIPLE capabilities (one skill, multiple
// contributions) -- see file's own "multi-skill reality" precedent this
// stage's own task requires.
// ---------------------------------------------------------------------------

export const SKILL_CAPABILITY_KINDS = [
  "REDUCE_LENGTH",
  "PRESERVE_LENGTH",
  "INCREASE_LENGTH",
  "REDUCE_WEIGHT",
  "BUILD_WEIGHT",
  "PRESERVE_WEIGHT",
  "PRESERVE_PERIMETER",
  "MODIFY_PERIMETER_RELATIONSHIP",
  "ESTABLISH_GUIDE",
  "CONNECT_ZONES",
  "CROSS_CHECK_VALIDATE",
  "REFINE_ENDS",
] as const;
export type SkillCapabilityKind = (typeof SKILL_CAPABILITY_KINDS)[number];

export function isSkillCapabilityKind(value: unknown): value is SkillCapabilityKind {
  return typeof value === "string" && (SKILL_CAPABILITY_KINDS as readonly string[]).includes(value);
}

export interface SkillCapability {
  kind: SkillCapabilityKind;
  // Vertical-specific zone strings (e.g. real HeadZone values for
  // cutting) -- same "this contract does not interpret the strings
  // itself" discipline as SkillDefinition.applicableZones. Omitted means
  // "every zone this skill's own applicableZones already covers" (falls
  // back to the skill-level list at match time -- see the selector); an
  // explicit, narrower list here lets one skill declare capabilities that
  // apply to different zone subsets.
  zones?: readonly string[];
}

export function isValidSkillCapability(value: unknown): value is SkillCapability {
  if (!isRecord(value)) return false;
  if (!isSkillCapabilityKind(value.kind)) return false;
  if (value.zones !== undefined) {
    if (!Array.isArray(value.zones) || value.zones.length === 0) return false;
    if (!value.zones.every((z) => typeof z === "string" && z.length > 0)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The Skill Definition itself.
// ---------------------------------------------------------------------------

export interface SkillDefinition<TFact extends string = string> {
  // Stable across versions -- identifies "this skill", not "this exact
  // revision". Human-assigned, never derived automatically.
  skillId: string;
  // Starts at 1, a distinct integer per revision. A skill object is a
  // frozen SNAPSHOT of one version -- there is no "update in place" API
  // anywhere in this file; a new version is always a new, separate
  // object, exactly like ProfessionalTechniqueExecutionProfile's own
  // versioning discipline.
  version: number;
  // Open string, deliberately -- mirrors AnalysisProposal's own
  // unconstrained `vertical` column. This contract never hardcodes a
  // vertical list (cutting/color/bleaching/styling/treatments/
  // barbering/nails/makeup are all future possibilities, none assumed).
  vertical: string;
  name: string;
  description: string;
  status: SkillDefinitionStatus;
  authorityType: SkillAuthorityType;
  // Present only once professionally reviewed (PROFESSIONALLY_REVIEWED).
  reviewedByUserId?: string;
  reviewedAt?: string;
  // Top-level, human-authored justification for this skill's existence as
  // a whole -- distinct from the procedure's own step-level instructions.
  rationale: string;
  parameters: readonly SkillParameterDefinition[];
  // A genuine PROCEDURE, not a bag of metadata -- see file header for the
  // "at least 2 real steps" structural heuristic this stage enforces.
  procedure: readonly SkillProcedureStep[];
  // Optional: when this skill applies at all, expressed in the SAME
  // closed condition language every other rule engine in this domain
  // already uses -- never a free-form description.
  applicabilityCondition?: SkillCondition<TFact>;
  // Optional, vertical-specific meaning (e.g. real HeadZone values for a
  // cutting skill) -- this contract does not interpret the strings itself.
  applicableZones?: readonly string[];
  // Stage 4 addition -- structured "what can this skill contribute"
  // declarations, see SkillCapability's own header above. Optional: a
  // skill declaring none simply can never become a Stage 4 candidate
  // match (never an error -- a skill may exist purely as a not-yet-
  // capability-tagged record, or one whose only real contribution is
  // procedural and out of Stage 4's own matching scope).
  capabilities?: readonly SkillCapability[];
  // Declarative only -- no resolution/ordering logic lives here. A future
  // composition engine consults these; this contract only records them.
  prerequisiteSkillIds?: readonly string[];
  incompatibleSkillIds?: readonly string[];
  // Present only once status=RETIRED and a successor exists.
  supersededBySkillId?: string;
  createdAt: string;
}

// Two skill definitions sharing the SAME parameter name is an unresolvable
// ambiguity, detected deterministically -- mirrors
// findConflictingExecutionFieldRules's own exact precedent.
export function findConflictingSkillParameterNames(parameters: readonly SkillParameterDefinition[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const parameter of parameters) {
    counts.set(parameter.name, (counts.get(parameter.name) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
}

export function isValidSkillDefinition<TFact extends string>(
  value: unknown,
  isValidFact: (candidate: unknown) => candidate is TFact,
): value is SkillDefinition<TFact> {
  if (!isRecord(value)) return false;
  if (typeof value.skillId !== "string" || value.skillId.length === 0) return false;
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) return false;
  if (typeof value.vertical !== "string" || value.vertical.length === 0) return false;
  if (typeof value.name !== "string" || value.name.trim().length === 0) return false;
  if (typeof value.description !== "string" || value.description.trim().length === 0) return false;
  if (!(SKILL_DEFINITION_STATUSES as readonly string[]).includes(value.status as string)) return false;
  if (!(SKILL_AUTHORITY_TYPES as readonly string[]).includes(value.authorityType as string)) return false;
  // A MACHINE_DRAFTED skill can exist only as DRAFT -- it must never be
  // possible to construct a valid ACTIVE-and-unreviewed skill.
  if (value.status === "ACTIVE" && value.authorityType === "MACHINE_DRAFTED") return false;
  if (value.authorityType === "PROFESSIONALLY_REVIEWED") {
    if (typeof value.reviewedByUserId !== "string" || value.reviewedByUserId.length === 0) return false;
    if (typeof value.reviewedAt !== "string" || value.reviewedAt.length === 0) return false;
  }
  if (typeof value.rationale !== "string" || value.rationale.trim().length === 0) return false;
  if (typeof value.createdAt !== "string" || value.createdAt.length === 0) return false;

  if (!Array.isArray(value.parameters) || !value.parameters.every(isValidSkillParameterDefinition)) return false;
  const parameters = value.parameters as SkillParameterDefinition[];
  if (findConflictingSkillParameterNames(parameters).length > 0) return false;
  const parameterNames = new Set(parameters.map((p) => p.name));

  // THE structural skill-vs-parameter boundary enforcement (file header):
  // a genuine procedure needs at least 2 real, ordered instructions -- a
  // single instruction is just an instruction, not a procedure.
  if (!Array.isArray(value.procedure) || value.procedure.length < 2) return false;
  if (!value.procedure.every((step) => isValidSkillProcedureStep(step, parameterNames))) return false;
  // Ordering must be a genuine, contiguous 1..N sequence -- never
  // ambiguous or duplicated.
  const orders = (value.procedure as SkillProcedureStep[]).map((s) => s.order).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) return false;
  }

  if (value.applicabilityCondition !== undefined && !isValidSkillCondition(value.applicabilityCondition, isValidFact)) return false;
  if (value.applicableZones !== undefined) {
    if (!Array.isArray(value.applicableZones) || !value.applicableZones.every((z) => typeof z === "string" && z.length > 0)) return false;
  }
  if (value.capabilities !== undefined) {
    if (!Array.isArray(value.capabilities) || !value.capabilities.every(isValidSkillCapability)) return false;
  }
  if (value.prerequisiteSkillIds !== undefined) {
    if (!Array.isArray(value.prerequisiteSkillIds) || !value.prerequisiteSkillIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  }
  if (value.incompatibleSkillIds !== undefined) {
    if (!Array.isArray(value.incompatibleSkillIds) || !value.incompatibleSkillIds.every((id) => typeof id === "string" && id.length > 0)) return false;
  }
  if (value.supersededBySkillId !== undefined) {
    if (typeof value.supersededBySkillId !== "string" || value.supersededBySkillId.length === 0) return false;
    if (value.status !== "RETIRED") return false; // supersession is only meaningful once retired
  }

  return true;
}

// ---------------------------------------------------------------------------
// Authority eligibility -- the ONE, single, central predicate any FUTURE
// composition engine must call to decide "may this skill ever be selected
// as active authority". Not called from anywhere in production yet (this
// stage has zero runtime integration) -- exists now so eligibility is
// decided once, here, mirroring
// isExecutionProfileEligibleForAuthority's own exact precedent.
// ---------------------------------------------------------------------------

export function isSkillEligibleForAuthority(skill: Pick<SkillDefinition, "status" | "authorityType">): boolean {
  if (skill.status !== "ACTIVE") return false;
  if (skill.authorityType === "MACHINE_DRAFTED") return false;
  return true;
}
