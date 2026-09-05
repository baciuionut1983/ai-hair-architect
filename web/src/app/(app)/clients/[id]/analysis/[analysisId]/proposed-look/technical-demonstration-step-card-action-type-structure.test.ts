import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Stage 2.5.d (round 2) -- source-level structural proof that Execution
// action is a FIRST-CLASS, always-visible field -- never buried in the
// generic collapsed "not yet available"/"marked not applicable" buckets
// alongside the ~15 other unrelated fields. Mirrors this codebase's own
// established precedent for exactly this situation (no jsdom/testing-
// library -- see vitest.config.ts): a real grep over the actual source,
// not a claim.

function readSource(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, "technical-demonstration-step-card.tsx"), "utf8");
}

describe("TechnicalDemonstrationStepCard -- Execution action is a dedicated, always-visible field", () => {
  it("extracts actionType out of all 3 generic resolveStepFieldRows buckets before rendering them", () => {
    const source = readSource();
    expect(source).toMatch(/populated\.filter\(\(row\) => row\.key !== "actionType"\)/);
    expect(source).toMatch(/notApplicable\.filter\(\(label\) => label !== "Execution action"\)/);
    expect(source).toMatch(/unknown\.filter\(\(label\) => label !== "Execution action"\)/);
  });

  it("the generic populated/notApplicable/unknown lists render the FILTERED (without-actionType) versions, never the raw ones", () => {
    const source = readSource();
    expect(source).toMatch(/populatedWithoutActionType\.map/);
    expect(source).toMatch(/notApplicableWithoutActionType\.map/);
    expect(source).toMatch(/unknownWithoutActionType\.map/);
    // Never iterating the raw, unfiltered lists anywhere in the render.
    expect(source).not.toMatch(/\{populated\.map/);
    expect(source).not.toMatch(/\{notApplicable\.map/);
    expect(source).not.toMatch(/\{unknown\.map/);
  });

  it("renders a dedicated, unconditional 'Execution action' block with a non-scary classification prompt when unresolved", () => {
    const source = readSource();
    expect(source).toMatch(/<dt className="text-muted">Execution action<\/dt>/);
    expect(source).toMatch(/"Not classified"/);
    expect(source).toMatch(/Needs professional classification/);
  });

  it("an explicit professional NOT_APPLICABLE decision gets its own distinct copy, never conflated with 'needs classification'", () => {
    const source = readSource();
    expect(source).toMatch(/A professional determined this step genuinely has no applicable execution action\./);
  });

  it("the actionType editor is passed a phase-aware options override, narrowing GUIDE/FINAL_CHECK to their own 2 valid choices", () => {
    const source = readSource();
    expect(source).toMatch(/resolveActionTypeOptionsForPhase\(stepPhase\)/);
  });

  it("no generation CTA or provider reference introduced", () => {
    const source = readSource();
    expect(source).not.toMatch(/Generate|generateVideo|veo|gemini/i);
  });
});
