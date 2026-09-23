import { describe, expect, it } from "vitest";
import { CUTTING_PROFESSIONAL_CONCEPT_PACK as pack } from "./professional-concept-cutting-pack";
import { valueLabel } from "@/components/consultation/teach-ai-professional-field-review-labels";
import { PROFESSIONAL_VALIDATION_REQUIRED, semanticFingerprint } from "./professional-concept-contracts";
import { isGuideBehavior, isGuideSource } from "./professional-skill-guide-relationship-contracts";

describe("O1 cutting pack", () => {
  it("preserves all original concept/value content apart from version labels", () => {
    const baselineContent = JSON.parse(JSON.stringify({ concepts: pack.concepts.slice(0, 5), canonicalValues: pack.canonicalValues }), (key, value) => ["specificationVersion", "semanticVersion"].includes(key) ? undefined : value);
    // Captured from released 4decea5 before expansion, including all original
    // fields, labels, value digests, statuses and correspondence metadata.
    expect(semanticFingerprint(baselineContent)).toBe("sha256:d77ea89558c1d453d05057c6f79fe1bd5454121371d3ae955451aaa08d06dd17");
  });
  it("reuses existing English display labels verbatim without using them as identities", () => {
    for (const value of pack.canonicalValues) {
      const field = value.conceptId.split(".")[1] as "elevation" | "sectioning" | "guideType";
      expect(value.localizedLabels.en).toBe(valueLabel(field, value.valueToken, "en"));
      expect(value.semanticMeaning).toBe(PROFESSIONAL_VALIDATION_REQUIRED);
    }
  });
  it("freezes every registry node and provides no mutation or promotion entry point", () => {
    const check = (v: unknown): void => {
      if (v && typeof v === "object") { expect(Object.isFrozen(v)).toBe(true); Object.values(v).forEach(check); }
    };
    check(pack);
    expect(() => { pack.concepts.push(pack.concepts[0]); }).toThrow();
    expect(pack.concepts).toHaveLength(12);
    expect(Object.keys(pack).sort()).toEqual(["canonicalValues", "concepts", "definitions", "specificationVersion", "vertical"]);
  });
  it("retains the O2 placeholders and has no other verticals or professional decisions", () => {
    expect(pack.vertical).toBe("cutting");
    expect(pack.concepts.every(c => c.vertical === "cutting" && c.scope === PROFESSIONAL_VALIDATION_REQUIRED && c.observability === PROFESSIONAL_VALIDATION_REQUIRED)).toBe(true);
    expect(pack.definitions).toEqual([]);
    expect(JSON.stringify(pack)).not.toMatch(/ownerUserId|reviewedByUserId|45° Interior|CONFIRMED|APPROVED|ACTIVE/);
  });
  it("references real guide dimensions without deriving any other dimension", () => {
    for (const value of pack.canonicalValues.filter(v => v.conceptId === "haircutting.guideType")) {
      const entries = value.legacyMappingCorrespondence!;
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (entry.targetDimension === "GuideBehavior") expect(isGuideBehavior(entry.targetValue)).toBe(true);
      else if (entry.targetDimension === "GuideSource") expect(isGuideSource(entry.targetValue)).toBe(true);
      else { expect(entry.correspondence).toBe("NO_MAPPING"); expect(entry.targetValue).toBeUndefined(); }
    }
  });
});
