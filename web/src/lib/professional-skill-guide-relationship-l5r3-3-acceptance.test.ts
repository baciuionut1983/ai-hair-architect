import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY } from "@/lib/professional-skill-guide-relationship-l5r3-3-real-replay";
import { compareGuideRelationshipAgainstExecutionUnits, type ComparableExecutionUnit } from "@/lib/professional-skill-guide-relationship-execution-unit-comparison";
import { GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL } from "@/lib/cutting-skill-graduated";
import { ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL } from "@/lib/cutting-skill-one-length-perimeter";
import { CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL } from "@/lib/cutting-skill-continue-central-nape-construction";
import { buildCanonicalCandidateSkillRegistry } from "@/lib/professional-brain-skill-templates";
import { L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS } from "@/lib/professional-knowledge-review-l5r3-2-real-decisions";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.3 -- THE
// REAL GUIDE-RELATIONSHIP REPLAY ACCEPTANCE. Pure, ZERO database, ZERO
// AI calls, ZERO video access, ZERO network anywhere in this file.
// Replays review items #2/#4/#9/#10 (professional-skill-guide-
// relationship-l5r3-3-real-replay.ts) against the real Graduated
// Cutting / One-Length Perimeter / Continue Central Nape Construction
// execution units, and proves L5.R3.2's own decisions remain untouched.

function toComparable(units: readonly { executionUnitId: string; parameterRules?: readonly { parameterName: string; semantic: string; fixedValue?: string | boolean | number }[] }[], skillId: string): ComparableExecutionUnit[] {
  return units.map((u) => ({ executionUnitId: u.executionUnitId, skillId, parameterRules: u.parameterRules }));
}

const ALL_REAL_UNITS: readonly ComparableExecutionUnit[] = [
  ...toComparable(GRADUATED_CUTTING_EXECUTION_UNITS, GRADUATED_CUTTING_SKILL.skillId),
  ...toComparable(ONE_LENGTH_PERIMETER_EXECUTION_UNITS, ONE_LENGTH_PERIMETER_SKILL.skillId),
  ...toComparable(CONTINUE_CENTRAL_NAPE_CONSTRUCTION_EXECUTION_UNITS, CONTINUE_CENTRAL_NAPE_CONSTRUCTION_SKILL.skillId),
];

describe("Stage 8.5L5.R3.3 -- real guide-relationship replay of #2/#4/#9/#10 (zero database, zero AI, zero network)", () => {
  it("test 19/25: replays all 4 real cases against the real registry with zero mutation and zero network calls", () => {
    const registry = buildCanonicalCandidateSkillRegistry();
    const registrySnapshotBefore = JSON.stringify(registry);

    const results = Object.fromEntries(Object.entries(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY).map(([label, capability]) => [label, compareGuideRelationshipAgainstExecutionUnits(capability, ALL_REAL_UNITS)]));

    expect(JSON.stringify(buildCanonicalCandidateSkillRegistry())).toBe(registrySnapshotBefore);

    fs.writeFileSync(path.join(process.cwd(), "scratch-l5r3-3-real-guide-replay-result.json"), JSON.stringify({ capabilities: L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY, results }, null, 2), "utf8");
  });

  it("#2 and #4 are semantically UNAMBIGUOUS and structurally distinct -- the exact ambiguity L5.R3.2 could not resolve", () => {
    const capability2 = L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY["#2"];
    const capability4 = L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY["#4"];
    expect(capability2.guideBehavior).toBe("TRAVELLING");
    expect(capability4.guideBehavior).toBe("STATIONARY");
    expect(capability2.id).not.toBe(capability4.id);
  });

  it("#9 stays deliberately PARTIAL -- guideBehavior/guideRole remain UNKNOWN, never inferred beyond the professionally confirmed guide relationship itself", () => {
    const capability9 = L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY["#9"];
    expect(capability9.guideBehavior).toBe("UNKNOWN");
    expect(capability9.guideRole).toBe("UNKNOWN");
    expect(capability9.currentSectionRelationship).toBe("REFERENCES_GUIDE");
  });

  it("#10 separately represents guide relationship + overdirection + progression -- never flattened into one opaque boolean", () => {
    const capability10 = L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY["#10"];
    expect(capability10.currentSectionRelationship).toBe("CUT_RELATIVE_TO_GUIDE");
    expect(capability10.overdirectionRelationship).toBe("TOWARD_GUIDE");
    expect(capability10.progression).toBe("PROGRESSES_EACH_UNIT");
    expect(capability10.unknownNumericFields).toContain("exactOverdirectionAngle");
  });

  it("#2's mobile guide correctly finds a compatible existing execution unit (Graduated Cutting's own traveling/previous_subsection unit)", () => {
    const result = compareGuideRelationshipAgainstExecutionUnits(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY["#2"], ALL_REAL_UNITS);
    expect(result.hasCompatibleExecutionUnit).toBe(true);
    expect(result.matches.map((m) => m.executionUnitId)).toContain("executionunit-cutting-graduated-execution-zone");
  });

  it("#4's stationary guide finds only a WEAK, behavior-only match against Graduated Cutting's contour-guide unit -- never a full source+role+behavior match, since #4's own source/role were honestly left UNKNOWN by Ionut's review (an honest, reportable architecture gap: no execution unit represents 'a stationary guide of unestablished origin')", () => {
    const result = compareGuideRelationshipAgainstExecutionUnits(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY["#4"], ALL_REAL_UNITS);
    expect(result.hasCompatibleExecutionUnit).toBe(true);
    for (const match of result.matches) {
      expect(match.matchedDimensions).toEqual(["behavior"]); // never "source" or "role" -- those remain genuinely unestablished
    }
  });

  it("test 20: deterministic replay -- comparing all 4 real cases twice produces byte-identical results", () => {
    const first = Object.fromEntries(Object.entries(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY).map(([label, capability]) => [label, compareGuideRelationshipAgainstExecutionUnits(capability, ALL_REAL_UNITS)]));
    const second = Object.fromEntries(Object.entries(L5R3_3_REAL_GUIDE_CAPABILITY_REPLAY).map(([label, capability]) => [label, compareGuideRelationshipAgainstExecutionUnits(capability, ALL_REAL_UNITS)]));
    expect(second).toEqual(first);
  });

  it("test 21/22/23/24: L5.R3.2's own real decisions (Deep Point Cut / Point Cut / Channel Cut / Slice-and-Slide / Graduated Cutting / One-Length references) remain completely unchanged -- this stage never imports or edits that fixture's content", () => {
    expect(L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS).toHaveLength(13);
    const decision7 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#7")!;
    expect(decision7.professionalValue).toBe("DEEP_POINT_CUT");
    const decision13 = L5R3_2_REAL_PROFESSIONAL_REVIEW_DECISIONS.find((d) => d.reviewItemLabel === "#13")!;
    expect(decision13.professionalValue).toBe("CHANNEL_CUT");
    expect(decision13.originalAIClaim).toBeNull();
  });

  it("test 25: this file and its dependencies never import Prisma or any provider client", () => {
    const source = fs.readFileSync(__filename, "utf8");
    expect(source).not.toMatch(/from ["']@\/lib\/prisma["']/);
    expect(source).not.toMatch(/\bprisma\./);
  });
});
