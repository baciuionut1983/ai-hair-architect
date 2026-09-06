import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Stage 2.5.g.4 -- source-level structural proof that "Reset to original"
// is gated on a genuine LOCAL Technical Demonstration Plan override, never
// on the field's own raw effective provenance alone. Mirrors this
// codebase's own established precedent for exactly this situation (no
// jsdom/testing-library -- see vitest.config.ts, and
// technical-demonstration-step-card-action-type-structure.test.ts's own
// identical convention): a real grep over the actual source, not a claim.

function readSource(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, "technical-demonstration-step-card.tsx"), "utf8");
}

describe("TechnicalDemonstrationStepCard -- Reset to original gated on a genuine LOCAL override, not raw provenance", () => {
  it("hasBeenOverriddenFor (which gates 'Reset to original') no longer treats a bare PROFESSIONAL_OVERRIDE tag as reason enough", () => {
    const source = readSource();
    // The OLD, buggy check this stage replaces must be gone.
    expect(source).not.toMatch(/entry\?\.provenance === "PROFESSIONAL_OVERRIDE" \|\| entry\?\.provenance === "NOT_APPLICABLE"/);
  });

  it("hasBeenOverriddenFor now delegates to the real, server-owned sourceLevel classification", () => {
    const source = readSource();
    expect(source).toMatch(/function hasBeenOverriddenFor[\s\S]{0,200}sourceLevelFor\(field\) === "LOCAL_PLAN_OVERRIDE"/);
  });

  it("sourceLevelFor calls the real, imported resolveCuttingStepFieldSourceLevel -- never a second, UI-local reimplementation of override precedence", () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{[^}]*resolveCuttingStepFieldSourceLevel[^}]*\}\s*from\s*"\.\/technical-demonstration-plan-logic"/);
    expect(source).toMatch(/function sourceLevelFor[\s\S]{0,300}resolveCuttingStepFieldSourceLevel\(/);
  });

  it("the card receives the plan's own real professionalOverrides as an explicit prop -- never guessed, never omitted", () => {
    const source = readSource();
    expect(source).toMatch(/professionalOverrides:\s*CuttingStepOverrideEntry\[\]/);
    expect(source).toMatch(/TechnicalDemonstrationStepCard\(\{\s*step,\s*professionalOverrides,\s*onEditField\s*\}/);
  });

  it("both provenance badge render sites pass the real sourceLevel through, never rendering the badge from provenance alone", () => {
    const source = readSource();
    const badgeUsages = source.match(/<TechnicalDemonstrationProvenanceBadge[^/]*\/>/g) ?? [];
    expect(badgeUsages.length).toBeGreaterThanOrEqual(2);
    for (const usage of badgeUsages) {
      expect(usage).toMatch(/sourceLevel=/);
    }
  });

  it("onEditField still gates every edit/reset affordance unconditionally -- a CONFIRMED plan (onEditField undefined) still renders zero editors regardless of sourceLevel", () => {
    const source = readSource();
    expect(source).toMatch(/function editButton\(field: CuttingStepOverrideFieldName\) \{\s*if \(!onEditField\) return null;/);
  });
});
