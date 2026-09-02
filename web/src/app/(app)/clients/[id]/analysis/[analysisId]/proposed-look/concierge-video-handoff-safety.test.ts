import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// AI Concierge / Orchestrator, Stage 2 -- source-level regression lock for
// the single most safety-critical property this stage adds: the
// Concierge's "yes" can reach the EXISTING Video consent dialog, but can
// NEVER itself submit a real generation. Mirrors this codebase's own
// established source-inspection convention (video-provider-veo.test.ts's
// own regression locks) for a boundary that is architecturally guaranteed
// rather than mockable -- video-demonstration-section.tsx has zero tests
// of its own (this app never unit-tests component rendering), so this is
// the one place these specific invariants are proven, without rendering
// anything.
function readVideoDemonstrationSectionSource(): string {
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "video-demonstration-section.tsx"), "utf8");
}

// This file's own doc comments deliberately mention `create()`/
// `confirmAndSubmit` BY NAME in prose (to explain the safety property to a
// future reader) -- a naive text scan over the whole file would therefore
// find false matches inside those comments, not just in real code. Every
// assertion below scans CODE ONLY.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("VideoDemonstrationSection <- requestConsentOnMount handoff safety (task section 6, tests E/F/G/K)", () => {
  it("E/G: the auto-open effect calls ONLY setConfirmIntent -- it never calls create()/createVariation() directly", () => {
    const source = readVideoDemonstrationSectionSource();
    const effectStart = source.indexOf("useEffect(() => {\n    if (!requestConsentOnMount");
    expect(effectStart).toBeGreaterThan(-1);
    const effectEnd = source.indexOf("}, [requestConsentOnMount, state]);", effectStart);
    expect(effectEnd).toBeGreaterThan(effectStart);
    const effectBody = source.slice(effectStart, effectEnd);

    expect(effectBody).toMatch(/setConfirmIntent\("create"\)/);
    expect(effectBody).not.toMatch(/\bcreate\(\)/);
    expect(effectBody).not.toMatch(/createVariation\(/);
    expect(effectBody).not.toMatch(/await /);
  });

  it("G: the ONLY two call sites of the real create()/createVariation() calls are both inside confirmAndSubmit -- never anywhere else in the file", () => {
    const source = stripComments(readVideoDemonstrationSectionSource());
    const confirmAndSubmitStart = source.indexOf("async function confirmAndSubmit()");
    const confirmAndSubmitEnd = source.indexOf("\n  }\n", confirmAndSubmitStart);
    expect(confirmAndSubmitStart).toBeGreaterThan(-1);
    expect(confirmAndSubmitEnd).toBeGreaterThan(confirmAndSubmitStart);

    // Every real call to create()/createVariation() anywhere in the CODE
    // must fall strictly within confirmAndSubmit's own body.
    const realCallPattern = /\bcreateVariation\(\)|(?<!use)(?<!\w)create\(\)/g;
    let match: RegExpExecArray | null;
    let callCount = 0;
    while ((match = realCallPattern.exec(source)) !== null) {
      callCount += 1;
      expect(match.index).toBeGreaterThanOrEqual(confirmAndSubmitStart);
      expect(match.index).toBeLessThan(confirmAndSubmitEnd);
    }
    expect(callCount).toBe(2); // create() and createVariation(), both real, both found, nowhere else
  });

  it("F: confirmAndSubmit is reachable ONLY from the Dialog's own onConfirm -- proving the SAME existing dialog is what gates every real submit, auto-opened or not", () => {
    const source = stripComments(readVideoDemonstrationSectionSource());
    expect(source).toMatch(/onConfirm=\{confirmAndSubmit\}/);
    // Exactly one reference to confirmAndSubmit as a value (the Dialog
    // wiring) plus its own declaration -- never a second, independent
    // trigger site, in real code (comments are already stripped above).
    const references = source.match(/confirmAndSubmit/g) ?? [];
    expect(references.length).toBe(2); // the `async function confirmAndSubmit` declaration + the one onConfirm wiring
  });

  it("K: the manual 'Create Result Video' button and the Concierge auto-open both set the IDENTICAL confirmIntent value -- one convergent path, not two", () => {
    const source = readVideoDemonstrationSectionSource();
    expect(source).toMatch(/onRequestConfirm=\{\(\) => setConfirmIntent\("create"\)\}/);
    expect(source).toMatch(/setConfirmIntent\("create"\);\s*\n\s*\}, \[requestConsentOnMount, state\]\);/);
  });

  it("the file never references generateVideos, provider.submit, or any Video creation-repository function by name -- only the existing hook's own create/createVariation", () => {
    const source = readVideoDemonstrationSectionSource();
    expect(source).not.toMatch(/generateVideos/);
    expect(source).not.toMatch(/createVideoDemonstrationGeneration/);
    expect(source).not.toMatch(/fetch\(/); // this component never calls fetch itself -- only the hook does
  });
});

function readUseConciergeVideoOfferSource(): string {
  return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "use-concierge-video-offer.ts"), "utf8");
}

describe("useConciergeVideoOffer -- NO path safety (task section 5/13, tests C/D)", () => {
  it("C/D: decline() makes zero real requests and calls no Video/Google/Veo function -- only a local setState + a console-only log", () => {
    const source = stripComments(readUseConciergeVideoOfferSource());
    const declineStart = source.indexOf("function decline()");
    const declineEnd = source.indexOf("\n  }\n", declineStart);
    expect(declineStart).toBeGreaterThan(-1);
    const declineBody = source.slice(declineStart, declineEnd);

    expect(declineBody).not.toMatch(/fetch\(/);
    expect(declineBody).not.toMatch(/await /);
    expect(declineBody).not.toMatch(/create/i);
    expect(declineBody).not.toMatch(/generateVideos/);
    expect(declineBody).toMatch(/setState/);
  });

  it("the ONE real fetch call in this file targets ONLY the existing /api/v1/concierge/orchestrate route -- never a Video-specific endpoint, never Google/Veo directly", () => {
    const source = stripComments(readUseConciergeVideoOfferSource());
    const fetchCalls = source.match(/fetch\("([^"]+)"/g) ?? [];
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]).toBe('fetch("/api/v1/concierge/orchestrate"');
  });
});
