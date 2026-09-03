import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// PRODUCTION BUG FIX -- source-level structural proofs for properties this
// codebase's own conventions (no jsdom/testing-library -- see
// vitest.config.ts) cannot assert by actually rendering the component.
// Mirrors the established precedent for exactly this situation (e.g.
// use-spatial-binding-auto-restore-structure.test.ts's own structural
// proofs). The pure DECISION of which href the "Da" button should use is
// separately, fully proven in concierge-logic.test.ts
// (resolveVideoOfferAcceptHref); this file proves the WIRING is correct:
// the videoOffer branch actually uses that computed value, "Nu" is
// untouched, and every other decision kind's own href/actionLabel is
// completely unaffected.

function readSource(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, "concierge-panel.tsx"), "utf8");
}

describe("ConciergePanel -- structural proofs (videoOffer 'Da' button fix)", () => {
  it("computes videoOfferAcceptHref from resolveVideoOfferAcceptHref, imported from concierge-logic", () => {
    const source = readSource();
    expect(source).toMatch(/import\s*\{[^}]*resolveVideoOfferAcceptHref[^}]*\}\s*from\s*["']\.\/concierge-logic["']/);
    expect(source).toMatch(/videoOfferAcceptHref=\{resolveVideoOfferAcceptHref\(state\.decision\)\}/);
  });

  it("the videoOffer branch's 'Da' link uses videoOfferAcceptHref, never the generic href (which is always null for OFFER_VIDEO)", () => {
    const source = readSource();
    const videoOfferBranch = source.slice(source.indexOf('decisionKind === "videoOffer"'), source.indexOf('decisionKind === "unsupported"'));
    expect(videoOfferBranch).toMatch(/\{videoOfferAcceptHref \? \(/);
    expect(videoOfferBranch).not.toMatch(/\{href \? \(/);
  });

  it("'Nu' is untouched -- still an unconditional button calling onDecline, with no href dependency at all", () => {
    const source = readSource();
    const videoOfferBranch = source.slice(source.indexOf('decisionKind === "videoOffer"'), source.indexOf('decisionKind === "unsupported"'));
    expect(videoOfferBranch).toMatch(/<Button variant="secondary" onClick=\{onDecline\}>/);
  });

  it("every other decision kind's own href/actionLabel computation is completely unchanged -- untouched by this fix", () => {
    const source = readSource();
    // The generic "action" branch (the final return) still renders from
    // href/actionLabel exactly as before.
    expect(source).toMatch(/\{href && actionLabel \? \(/);
    // The href passed into ConciergeDecisionView is still computed from
    // state.decision.recommendedAction via resolveOrchestratorActionHref,
    // unchanged -- this fix added a SECOND, separate prop, never modified
    // this one.
    expect(source).toMatch(/href=\{\s*state\.decision\.recommendedAction\s*\?\s*resolveOrchestratorActionHref\(state\.decision\.recommendedAction,/);
  });
});
