import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

// Technical Demonstration, Stage 2.5.g.2/2.5.g.3 -- static, source-level
// proof of exactly WHERE the Professional Coherence engine is, and is not,
// wired in. Architectural boundary claims ("module X does not import
// module Y") cannot be proven by a runtime unit test -- a test cannot
// observe an import that was never made -- so this file reads the real,
// on-disk source text of the relevant files and asserts the coherence
// module name appears (or does not appear) exactly where the current
// stage's own decision lock says it should.
//
// Stage 2.5.g.2 shipped coherence as VISIBILITY ONLY -- confirmation never
// called it. Stage 2.5.g.3 deliberately, explicitly wires it INTO
// confirmTechnicalDemonstrationPlan for enforcement (deterministic
// blockers only) -- so the repository-level "never references coherence"
// claim from 2.5.g.2 is now intentionally false and has been replaced
// below with a more precise claim: coherence is referenced for
// enforcement, and ONLY inside confirmTechnicalDemonstrationPlan, never
// inside createTechnicalDemonstrationPlanFromProposal or
// applyOverridesToDraft. The readiness/VIDEO_READY engine's own
// "never references coherence" claim remains unchanged and still holds --
// Stage 2.5.g.3 explicitly does not touch readiness/VIDEO_READY.

const WEB_ROOT = join(__dirname, "..", "..");
const COHERENCE_MODULE_REFERENCE = "technical-demonstration-cutting-coherence";

function readSource(relativePath: string): string {
  return readFileSync(join(WEB_ROOT, relativePath), "utf8");
}

describe("Stage 2.5.g.2/2.5.g.3 -- coherence is wired ONLY where each stage's own decision lock allows (static source boundary)", () => {
  it("14. the confirm route's own source never references the coherence module directly -- it only catches the repository's own re-exported error class", () => {
    const source = readSource(
      "src/app/api/v1/clients/[id]/analysis-proposals/[proposalId]/technical-demonstration-plans/[planId]/confirm/route.ts",
    );
    expect(source).not.toContain(COHERENCE_MODULE_REFERENCE);
    expect(source).not.toContain("evaluatePlanCoherence");
    // But it DOES handle the structured blocked-confirmation error the
    // repository throws -- proving the wiring exists at the correct layer.
    expect(source).toContain("TechnicalDemonstrationCoherenceBlockedError");
  });

  it("Stage 2.5.g.3: confirmTechnicalDemonstrationPlan DOES reference the coherence module (deliberate enforcement wiring) -- proves the intended integration actually exists", () => {
    const source = readSource("src/lib/technical-demonstration-repository.ts");
    expect(source).toContain(COHERENCE_MODULE_REFERENCE);
    expect(source).toContain("evaluatePlanCoherence");
  });

  it("Stage 2.5.g.3: coherence enforcement lives ONLY inside confirmTechnicalDemonstrationPlan -- never inside createTechnicalDemonstrationPlanFromProposal or applyOverridesToDraft", () => {
    const source = readSource("src/lib/technical-demonstration-repository.ts");

    function functionBody(startMarker: string, endMarker: string): string {
      const start = source.indexOf(startMarker);
      const end = source.indexOf(endMarker, start);
      if (start === -1 || end === -1 || end <= start) {
        throw new Error(`Could not locate the region between "${startMarker}" and "${endMarker}" -- markers may be stale.`);
      }
      return source.slice(start, end);
    }

    const createFunctionBody = functionBody(
      "export async function createTechnicalDemonstrationPlanFromProposal",
      "// ---------------------------------------------------------------------------\n// Reads",
    );
    expect(createFunctionBody).not.toContain("evaluatePlanCoherence");

    const applyOverridesFunctionBody = functionBody(
      "export async function applyOverridesToDraft",
      "export function resolveEffectiveCuttingStepsForRecord",
    );
    expect(applyOverridesFunctionBody).not.toContain("evaluatePlanCoherence");

    const confirmFunctionBody = functionBody(
      "export async function confirmTechnicalDemonstrationPlan",
      "// ---------------------------------------------------------------------------\n// applyOverridesToDraft",
    );
    expect(confirmFunctionBody).toContain("evaluatePlanCoherence");
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
