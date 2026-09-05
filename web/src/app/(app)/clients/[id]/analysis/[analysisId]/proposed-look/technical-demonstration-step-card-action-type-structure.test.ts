import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Stage 2.5.d -- source-level structural proof for the small, additive
// readiness-hint note this stage adds to the step card's own generic
// "not yet available" bucket. Mirrors this codebase's own established
// precedent for exactly this situation (no jsdom/testing-library --
// see vitest.config.ts): a real grep over the actual source, not a claim.
// The GENERIC editor mechanism itself (actionType renders via the SAME
// "select" kind as elevation/sectioning/etc., with zero new component
// code) is already proven by CUTTING_STEP_FIELD_EDITORS' own exhaustiveness
// check in technical-demonstration-plan-logic.ts and its test file -- this
// file only proves the ONE genuinely new line of UI added here.

function readSource(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, "technical-demonstration-step-card.tsx"), "utf8");
}

describe("TechnicalDemonstrationStepCard -- actionType readiness hint", () => {
  it("shows a non-scary, specific hint about readiness when Execution action is unknown for a step", () => {
    const source = readSource();
    expect(source).toMatch(/unknown\.includes\("Execution action"\)/);
    expect(source).toMatch(/Readiness cannot fully determine which technical fields apply to this step until the execution action\s*\n?\s*is classified\./);
  });

  it("the hint is scoped to the existing generic 'unknown' bucket -- no new UI branch, no generation CTA introduced", () => {
    const source = readSource();
    expect(source).not.toMatch(/Generate|generateVideo|veo|gemini/i);
  });
});
