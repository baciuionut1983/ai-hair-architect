import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Stage 2.5.c -- DRAFT readiness visibility fix. Source-level structural
// proofs for the properties this codebase's own convention cannot assert
// by actually rendering a component (no jsdom/testing-library anywhere in
// this repo -- see vitest.config.ts) -- mirrors the established precedent
// for exactly this situation (use-spatial-binding-auto-restore-structure.
// test.ts's own identical technique). The pure DECISION of which plan to
// target (draft over confirmed) is separately, fully proven in
// technical-demonstration-plan-logic.test.ts's own resolveReadinessTargetPlan
// suite -- this file proves the WIRING around that decision: that the
// section actually calls it (never reimplementing the priority inline),
// that BOTH the draft and confirmed branches receive the resulting
// readiness, that a professional edit's own timestamp bump actually
// participates in the fetch hook's own refetch trigger, and that neither
// this file nor its neighbors ever second-guess or override the server's
// own `ready` verdict.

function readSource(...segments: string[]): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, ...segments), "utf8");
}

describe("TechnicalDemonstrationPlanSection -- DRAFT readiness visibility wiring", () => {
  const source = () => readSource("technical-demonstration-plan-section.tsx");

  it("resolves the readiness target plan via the shared, separately-tested resolveReadinessTargetPlan -- never a reimplemented priority", () => {
    expect(source()).toMatch(/import \{ resolveReadinessTargetPlan, .* \} from "\.\/technical-demonstration-plan-logic"/);
    expect(source()).toMatch(/resolveReadinessTargetPlan\(state\.draft\?\.plan, state\.current\?\.plan\)/);
  });

  it("passes BOTH the target plan's id AND its own updatedAt into the readiness hook -- never just the id alone", () => {
    expect(source()).toMatch(/useTechnicalExecutionVideoReadiness\(\s*clientId,\s*proposalId,\s*readinessTargetPlan\?\.id \?\? null,\s*readinessTargetPlan\?\.updatedAt \?\? null,?\s*\)/);
  });

  it("the DRAFT branch's own TechnicalDemonstrationPlanView call receives readiness -- the exact gap this fix closes", () => {
    const draftBranch = source().split("{draft ? (")[1]?.split(") : current ? (")[0] ?? "";
    expect(draftBranch).toMatch(/readiness=\{readiness\}/);
  });

  it("the CONFIRMED branch still receives readiness -- existing behavior unchanged when there is no draft", () => {
    const confirmedBranch = source().split(") : current ? (")[1]?.split(") : (")[0] ?? "";
    expect(confirmedBranch).toMatch(/readiness=\{readiness\}/);
  });

  it("readiness is computed exactly ONCE per render and reused for whichever branch actually renders -- never two independent fetches for draft vs confirmed", () => {
    // A single `readinessState`/`readiness` declaration, referenced by both
    // JSX branches above -- not a second useTechnicalExecutionVideoReadiness
    // call anywhere else in the file.
    const occurrences = source().match(/useTechnicalExecutionVideoReadiness\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });

  it("the readiness hook call happens unconditionally, before both early returns (Rules of Hooks)", () => {
    const s = source();
    const hookCallIndex = s.indexOf("useTechnicalExecutionVideoReadiness(");
    const loadingReturnIndex = s.indexOf('state.status === "loading"');
    const errorReturnIndex = s.indexOf('state.status === "error"');
    expect(hookCallIndex).toBeGreaterThan(-1);
    expect(hookCallIndex).toBeLessThan(loadingReturnIndex);
    expect(hookCallIndex).toBeLessThan(errorReturnIndex);
  });
});

describe("useTechnicalExecutionVideoReadiness -- refetch-on-edit wiring", () => {
  const source = () => readSource("use-technical-execution-video-readiness.ts");

  it("accepts an explicit planUpdatedAt parameter, independent of planId", () => {
    expect(source()).toMatch(/planUpdatedAt\?: string \| null/);
  });

  it("planUpdatedAt participates in the effect's own dependency array -- an override write (which always bumps updatedAt) reliably refetches even though planId itself never changes", () => {
    expect(source()).toMatch(/\}, \[clientId, proposalId, planId, planUpdatedAt\]\);/);
  });

  it("never assumes/derives readiness itself -- always the server's own JSON response, verbatim", () => {
    const s = source();
    expect(s).toMatch(/setFetchState\(\{ status: "ready", readiness: body\.readiness \}\);/);
    // No client-side construction of a PlanReadinessResult-shaped object
    // with a literal `ready: true` anywhere in this file.
    expect(s).not.toMatch(/ready:\s*true/);
  });
});

describe("TechnicalExecutionVideoReadinessSummary -- server verdict is never overridden client-side", () => {
  const source = () => readSource("technical-execution-video-readiness-summary.tsx");

  it("branches only on the server-supplied readiness.ready -- never reassigns or recomputes it", () => {
    const s = source();
    expect(s).toMatch(/readiness\.ready \? "success" : "neutral"/);
    expect(s).toMatch(/readiness\.ready \? "Ready" : "Not ready"/);
    // Never a local mutation/override of the received prop.
    expect(s).not.toMatch(/readiness\.ready\s*=/);
    expect(s).not.toMatch(/\{\s*\.\.\.readiness,\s*ready:/);
  });

  it("is rendered unconditionally by plan status -- TechnicalDemonstrationPlanView never gates it behind a CONFIRMED check", () => {
    const viewSource = readSource("technical-demonstration-plan-view.tsx");
    expect(viewSource).toMatch(/\{readiness \? <TechnicalExecutionVideoReadinessSummary readiness=\{readiness\} \/> : null\}/);
    expect(viewSource).not.toMatch(/plan\.status === "CONFIRMED" &&.*TechnicalExecutionVideoReadinessSummary/);
  });
});
