import { isSkillEligibleForAuthority, type SkillCapabilityKind, type SkillDefinition } from "@/lib/professional-skill-contracts";
import type { ProfessionalSkillDefinitionRecord } from "@/lib/professional-skill-registry-repository";
import { evaluateSkillCondition, type SkillConditionFacts } from "@/lib/skill-condition-evaluator";
import type { HairStateDelta, HairStateDeltaEntry, HairStateSnapshotDeltaInput } from "@/lib/hair-state-delta";
import { computeColorStateDelta } from "@/lib/hair-state-color-delta";
import type { HairStateDeltaSkillSelectionResult, SkillCandidateApplicabilityResult, SkillCandidateMatch } from "@/lib/hair-state-delta-skill-candidate-selector";

// AI Hair Architect, Professional Skill Engine, B1 (Professional Brain
// CUT+COLOR slice) -- COLOR CANDIDATE SELECTOR. The color-vertical sibling
// of hair-state-delta-skill-candidate-selector.ts's own
// selectCandidateSkillsForDelta. Deliberately a SEPARATE function in a
// SEPARATE file, reusing that file's own exported result shape
// (HairStateDeltaSkillSelectionResult) but NEVER touching its own
// CUT-scoped requiredCapabilityKinds switch -- that switch is explicitly
// documented, in that file's own header, as "kept in exactly one place";
// adding color branches there would be exactly the ever-growing,
// hardcoded-chemical-logic switch this stage's own task instructs against.
// A caller (professional-brain-orchestrator.ts's own multi-domain
// functions) composes this file's own result with the CUT selector's own
// result into one combined view -- this file never performs that
// composition itself, and the CUT selector file is never imported or
// modified here.
//
// FAIL-CLOSED, same discipline as the CUT selector: a color skill becomes
// a candidate ONLY because it declares the real, structured
// EVALUATE_COLOR_SERVICE capability -- never by name/description matching.
// A colorLevel/colorTone delta entry with no matching registered skill
// becomes an unresolved delta, never a guessed/invented answer.
//
// ONE CAPABILITY ONLY (EVALUATE_COLOR_SERVICE): this selector maps BOTH
// colorLevel and colorTone changes to the same single, gate/evaluation-only
// capability -- see professional-skill-contracts.ts's own header on that
// capability for why no outcome-style (lighten/deposit) capability exists
// yet. A future stage that adds real color EXECUTION capabilities would
// extend this mapping additively, never by editing the CUT file.

function requiredColorCapabilityKinds(entry: HairStateDeltaEntry): readonly SkillCapabilityKind[] {
  if (entry.field !== "colorLevel" && entry.field !== "colorTone") return [];
  if (entry.transformation === "UNKNOWN") return [];
  return ["EVALUATE_COLOR_SERVICE"];
}

// Color facts are global-only for this slice (see HairStateColorEntry's
// own header) -- a color skill must leave both `capabilities[].zones` and
// `applicableZones` undefined ("unconstrained") to ever match a global
// entry, mirroring the CUT selector's own zoneAppliesToDelta exactly for
// the scope === "global" case.
function colorCapabilityAppliesToDelta(capabilityZones: readonly string[] | undefined, skillApplicableZones: readonly string[] | undefined): boolean {
  const resolvedZones = capabilityZones ?? skillApplicableZones;
  return resolvedZones === undefined;
}

function isFactKnown(side: { value: string; source: string }): boolean {
  return side.value !== "unspecified" && side.source !== "not_yet_assessed";
}

function deriveFacts(entries: readonly HairStateDeltaEntry[]): SkillConditionFacts<string> {
  const facts = new Map<string, { value: string | boolean; known: boolean }>();
  for (const entry of entries) {
    facts.set(`current.${entry.scope}.${entry.field}`, { value: entry.current.value, known: isFactKnown(entry.current) });
    facts.set(`target.${entry.scope}.${entry.field}`, { value: entry.target.value, known: isFactKnown(entry.target) });
  }
  return facts;
}

function evaluateApplicability(skill: SkillDefinition, facts: SkillConditionFacts<string>): SkillCandidateApplicabilityResult {
  if (!skill.applicabilityCondition) return "APPLICABLE";
  const result = evaluateSkillCondition(skill.applicabilityCondition, facts);
  if (result === "TRUE") return "APPLICABLE";
  if (result === "FALSE") return "INAPPLICABLE";
  return "UNKNOWN";
}

export function selectColorCandidateSkillsForDelta(
  current: HairStateSnapshotDeltaInput,
  target: HairStateSnapshotDeltaInput,
  registry: readonly ProfessionalSkillDefinitionRecord[],
): HairStateDeltaSkillSelectionResult {
  const entries = computeColorStateDelta(current, target);
  const delta: HairStateDelta = {
    sourceCurrentSnapshotId: current.id,
    sourceCurrentSnapshotVersion: current.snapshotVersion,
    sourceTargetSnapshotId: target.id,
    sourceTargetSnapshotVersion: target.snapshotVersion,
    computedAt: new Date().toISOString(),
    entries,
  };
  const facts = deriveFacts(entries);

  const eligibleSkills = registry.filter((record) => isSkillEligibleForAuthority({ status: record.status, authorityType: record.authorityType }));

  const candidateMatches: SkillCandidateMatch[] = [];
  const rejectedMatches: SkillCandidateMatch[] = [];
  const unresolvedDeltas: HairStateDeltaEntry[] = [];

  for (const entry of entries) {
    const requiredKinds = requiredColorCapabilityKinds(entry);
    if (requiredKinds.length === 0) continue;

    let matchedAnyApplicable = false;

    for (const record of eligibleSkills) {
      const skill = record.payload;
      for (const capability of skill.capabilities ?? []) {
        if (!requiredKinds.includes(capability.kind)) continue;
        if (!colorCapabilityAppliesToDelta(capability.zones, skill.applicableZones)) continue;

        const applicabilityResult = evaluateApplicability(skill, facts);
        const match: SkillCandidateMatch = {
          deltaEntry: entry,
          skillDefinitionId: record.id,
          skillKey: skill.skillId,
          skillVersion: skill.version,
          matchedCapability: capability.kind,
          applicabilityResult,
          deterministicReason: `Skill "${skill.skillId}" v${skill.version} declares capability ${capability.kind}, required by ${entry.field}=${entry.target.value} (${entry.transformation}).`,
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
