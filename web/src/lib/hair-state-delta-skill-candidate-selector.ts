import { isSkillEligibleForAuthority, type SkillCapabilityKind, type SkillDefinition } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import { evaluateSkillCondition, type SkillConditionFacts } from "@/lib/skill-condition-evaluator";
import { computeHairStateDelta, type HairStateDelta, type HairStateDeltaEntry, type HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";

// AI Hair Architect, Professional Skill Engine Stage 4 -- DETERMINISTIC
// CANDIDATE SELECTOR. Pure, deterministic, no I/O, no AI, no LLM. The
// bridge the task locks: CURRENT + TARGET -> HairStateDelta (hair-state-
// delta.ts, unchanged), then HairStateDelta + ProfessionalSkill Registry
// + deterministic applicability rules -> candidate skills. This file does
// NOT select a final execution technique, does NOT order/compose
// candidates, does NOT simulate final geometry -- Stage 5+'s own job.
// "Candidate" means only: "according to its structured, declared
// capability and applicability rules, this skill MAY contribute to this
// required transformation" -- never "this skill WILL be used."
//
// FAIL-CLOSED MATCHING RULE (task's own explicit, load-bearing
// requirement): a skill becomes a candidate ONLY because a REAL,
// structured SkillCapability it declares maps to the delta entry's own
// field+transformation, per REQUIRED_CAPABILITY_KINDS below -- never
// because its name/description contains matching words, never because an
// LLM says so. If the registry has no skill whose declared capability
// covers a given actionable delta entry, that entry becomes an
// UNRESOLVED DELTA. This file invents no skill to fill the gap.
//
// CAPABILITY -> DELTA MAPPING, kept in exactly one place
// (requiredCapabilityKinds below) -- see hair-state-delta.ts's own file
// header and professional-skill-contracts.ts's own SkillCapability header
// for why fiberThickness/texture/condition map to NO capability kind at
// all (no cutting-domain capability changes an intrinsic hair property;
// a real difference there is honestly, permanently unresolved by this
// registry, never invented).

export const SKILL_CANDIDATE_APPLICABILITY_RESULTS = ["APPLICABLE", "INAPPLICABLE", "UNKNOWN"] as const;
export type SkillCandidateApplicabilityResult = (typeof SKILL_CANDIDATE_APPLICABILITY_RESULTS)[number];

export interface SkillCandidateMatch {
  deltaEntry: HairStateDeltaEntry;
  skillDefinitionId: string;
  skillKey: string;
  skillVersion: number;
  matchedCapability: SkillCapabilityKind;
  applicabilityResult: SkillCandidateApplicabilityResult;
  deterministicReason: string;
}

export interface HairStateDeltaSkillSelectionResult {
  delta: HairStateDelta;
  // APPLICABLE matches only -- the real candidate set.
  candidateMatches: readonly SkillCandidateMatch[];
  // Capability-matched but INAPPLICABLE or UNKNOWN applicability -- kept
  // for audit/debugging (task's own explicit allowance), never treated as
  // a candidate.
  rejectedMatches: readonly SkillCandidateMatch[];
  // Delta entries that DO require a real capability (requiredCapabilityKinds
  // below returns at least one kind -- this deliberately includes
  // PRESERVED entries: "preserve the perimeter" / "preserve length" are
  // real, active professional requirements a skill must contribute to,
  // never "nothing to do") with ZERO entries in candidateMatches -- the
  // registry has no applicable answer for these, reported honestly rather
  // than guessed. Entries with no capability mapping at all (UNKNOWN
  // transformations, or fields like texture/condition/fiberThickness that
  // no capability vocabulary addresses by design) are never reported here
  // -- that would be noise, not a genuine registry gap.
  unresolvedDeltas: readonly HairStateDeltaEntry[];
}

// ---------------------------------------------------------------------------
// Capability <-> delta field/transformation mapping.
// ---------------------------------------------------------------------------

function isFactKnown(side: { value: string; source: string }): boolean {
  return side.value !== "unspecified" && side.source !== "not_yet_assessed";
}

function requiredCapabilityKinds(entry: HairStateDeltaEntry): readonly SkillCapabilityKind[] {
  switch (entry.field) {
    case "lengthIntent":
      if (entry.target.value === "shorten") return ["REDUCE_LENGTH"];
      if (entry.target.value === "preserve" || entry.target.value === "maintain") {
        return isFactKnown(entry.current) ? ["PRESERVE_LENGTH"] : ["ESTABLISH_GUIDE", "PRESERVE_LENGTH"];
      }
      return [];
    case "weightIntent":
      if (entry.target.value === "reduce") return ["REDUCE_WEIGHT"];
      if (entry.target.value === "build") return ["BUILD_WEIGHT"];
      if (entry.target.value === "preserve") return ["PRESERVE_WEIGHT"];
      return [];
    case "perimeterRelationship":
      if (entry.transformation === "PRESERVED") return ["PRESERVE_PERIMETER"];
      if (entry.transformation === "UNKNOWN") return [];
      return ["MODIFY_PERIMETER_RELATIONSHIP"];
    case "relativeLength":
      switch (entry.transformation) {
        case "REDUCED":
          return ["REDUCE_LENGTH"];
        case "INCREASED":
          return ["INCREASE_LENGTH"];
        case "PRESERVED":
          return ["PRESERVE_LENGTH"];
        case "ADDED":
          return ["ESTABLISH_GUIDE", "PRESERVE_LENGTH"];
        default:
          return [];
      }
    case "density":
      switch (entry.transformation) {
        case "REDUCED":
          return ["REDUCE_WEIGHT"];
        case "INCREASED":
          return ["BUILD_WEIGHT"];
        case "PRESERVED":
          return ["PRESERVE_WEIGHT"];
        default:
          return [];
      }
    default:
      // fiberThickness/texture/condition -- no capability vocabulary maps
      // to intrinsic-property fields; see file header.
      return [];
  }
}

function zoneAppliesToDelta(capabilityZones: readonly string[] | undefined, skillApplicableZones: readonly string[] | undefined, scope: HairStateDeltaEntry["scope"]): boolean {
  const resolvedZones = capabilityZones ?? skillApplicableZones; // undefined == unconstrained ("ALL")
  if (scope === "global") return resolvedZones === undefined;
  if (resolvedZones === undefined) return true;
  return resolvedZones.includes(scope);
}

// ---------------------------------------------------------------------------
// Applicability -- reuses the EXACT existing SkillCondition tree via
// skill-condition-evaluator.ts, never a second condition language. Facts
// are derived deterministically from the two real snapshots being
// compared, keyed "<current|target>.<scope>.<field>" -- a skill's own
// applicabilityCondition referencing a fact name outside this derived set
// (e.g. a vertical-specific anatomical judgment like
// "aboveOccipitalThreshold") is honestly UNKNOWN, never guessed.
// ---------------------------------------------------------------------------

function deriveFacts(delta: HairStateDelta): SkillConditionFacts<string> {
  const facts = new Map<string, { value: string | boolean; known: boolean }>();
  for (const entry of delta.entries) {
    facts.set(`current.${entry.scope}.${entry.field}`, { value: entry.current.value, known: isFactKnown(entry.current) });
    facts.set(`target.${entry.scope}.${entry.field}`, { value: entry.target.value, known: isFactKnown(entry.target) });
  }
  return facts;
}

function evaluateApplicability(skill: SkillDefinition, facts: SkillConditionFacts<string>): SkillCandidateApplicabilityResult {
  if (!skill.applicabilityCondition) return "APPLICABLE"; // no condition declared == unconstrained, matches the existing contract's own semantics.
  const result = evaluateSkillCondition(skill.applicabilityCondition, facts);
  if (result === "TRUE") return "APPLICABLE";
  if (result === "FALSE") return "INAPPLICABLE";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// The selector.
// ---------------------------------------------------------------------------

export function selectCandidateSkillsForDelta(
  current: HairStateSnapshotDeltaInput,
  target: HairStateSnapshotDeltaInput,
  registry: readonly ProfessionalSkillDefinitionRecord[],
): HairStateDeltaSkillSelectionResult {
  const delta = computeHairStateDelta(current, target);
  const facts = deriveFacts(delta);

  // Only eligible authority (ACTIVE, never MACHINE_DRAFTED) may ever
  // become a candidate -- mirrors isSkillEligibleForAuthority's own exact,
  // already-established precedent, never re-derived.
  const eligibleSkills = registry.filter((record) => isSkillEligibleForAuthority({ status: record.status, authorityType: record.authorityType }));

  const candidateMatches: SkillCandidateMatch[] = [];
  const rejectedMatches: SkillCandidateMatch[] = [];
  const unresolvedDeltas: HairStateDeltaEntry[] = [];

  // Iterates EVERY delta entry, not a pre-filtered "actionable" subset --
  // PRESERVED entries with a real capability mapping (PRESERVE_LENGTH/
  // PRESERVE_WEIGHT/PRESERVE_PERIMETER) must still be matchable. Only
  // entries with a non-empty requiredCapabilityKinds set are ever
  // evaluated against the registry or reported as unresolved -- see this
  // function's own return-type comment.
  for (const entry of delta.entries) {
    const requiredKinds = requiredCapabilityKinds(entry);
    if (requiredKinds.length === 0) continue;

    let matchedAnyApplicable = false;

    for (const record of eligibleSkills) {
      const skill = record.payload;
      for (const capability of skill.capabilities ?? []) {
        if (!requiredKinds.includes(capability.kind)) continue;
        if (!zoneAppliesToDelta(capability.zones, skill.applicableZones, entry.scope)) continue;

        const applicabilityResult = evaluateApplicability(skill, facts);
        const match: SkillCandidateMatch = {
          deltaEntry: entry,
          skillDefinitionId: record.id,
          skillKey: skill.skillId,
          skillVersion: skill.version,
          matchedCapability: capability.kind,
          applicabilityResult,
          deterministicReason: `Skill "${skill.skillId}" v${skill.version} declares capability ${capability.kind} for scope "${entry.scope}", required by ${entry.field}=${entry.target.value} (${entry.transformation}).`,
        };

        if (applicabilityResult === "APPLICABLE") {
          candidateMatches.push(match);
          matchedAnyApplicable = true;
        } else {
          rejectedMatches.push(match);
        }
      }
    }

    if (!matchedAnyApplicable) unresolvedDeltas.push(entry);
  }

  return { delta, candidateMatches, rejectedMatches, unresolvedDeltas };
}
