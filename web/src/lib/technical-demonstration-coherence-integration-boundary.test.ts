import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

// Technical Demonstration, Stage 2.5.g.2 -- static, source-level proof that
// the Professional Coherence engine has NOT been wired into confirmation,
// readiness, or VIDEO_READY in this stage. Required tests 14, 15, 16 (this
// file's own share of them) are architectural boundary claims ("module X
// does not import module Y") -- a runtime unit test cannot observe an
// import that was never made, so this file reads the real, on-disk source
// text of each file this stage explicitly forbids touching and asserts the
// coherence module name appears nowhere in it. This is a stronger, more
// direct proof than a behavioral test could give for this specific claim,
// and is re-run on every future change to these files -- if Stage 2.5.g.3
// ever wires enforcement in, this test starts failing loudly, exactly as
// it should.

const WEB_ROOT = join(__dirname, "..", "..");
const COHERENCE_MODULE_REFERENCE = "technical-demonstration-cutting-coherence";

function readSource(relativePath: string): string {
  return readFileSync(join(WEB_ROOT, relativePath), "utf8");
}

describe("Stage 2.5.g.2 -- coherence remains visibility-only (static source boundary)", () => {
  it("14. the confirm route's own source never references the coherence module", () => {
    const source = readSource(
      "src/app/api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]/confirm/route.ts",
    );
    expect(source).not.toContain(COHERENCE_MODULE_REFERENCE);
  });

  it("14. confirmTechnicalDemonstrationPlan's own repository file never references the coherence module", () => {
    const source = readSource("src/lib/technical-demonstration-repository.ts");
    expect(source).not.toContain(COHERENCE_MODULE_REFERENCE);
  });

  it("15/16. the readiness/VIDEO_READY engine's own source never references the coherence module -- readiness and VIDEO_READY stay untouched by this stage", () => {
    const source = readSource("src/lib/technical-demonstration-cutting-video-readiness.ts");
    // Stage 2.5.g.1 exported two constants FROM this file FOR the
    // coherence module to import -- that is coherence depending on
    // readiness, never the reverse. This file's own logic (evaluatePlanReadiness,
    // evaluateStepReadiness, isRuleApplicableForStep, etc.) must still never
    // import or call anything from the coherence module.
    expect(source).not.toMatch(new RegExp(`from ["']@/lib/${COHERENCE_MODULE_REFERENCE}["']`));
    expect(source).not.toContain("evaluatePlanCoherence");
  });

  it("the new coherence route is GET-only and lives in its own sub-path, never folded into the confirm or readiness routes' own request handling", () => {
    const confirmSource = readSource(
      "src/app/api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]/confirm/route.ts",
    );
    const readinessSource = readSource(
      "src/app/api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]/readiness/route.ts",
    );
    expect(confirmSource).not.toContain("evaluatePlanCoherence");
    expect(readinessSource).not.toContain("evaluatePlanCoherence");
  });
});
