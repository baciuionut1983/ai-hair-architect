import { describe, expect, it } from "vitest";

import { computeTechnicalDemonstrationPlanRequestFingerprint } from "@/lib/technical-demonstration-contracts";

// Stage 2.5.e.1 -- focused, pure unit tests for the ONE fingerprint
// function that gates Technical Demonstration Plan creation idempotency
// (createTechnicalDemonstrationPlanFromProposal, technical-demonstration-
// repository.ts). Mirrors photo-preview-contracts.test.ts's own
// computePhotoPreviewRequestFingerprint describe block exactly (same
// sibling fingerprint pattern, same test shape) -- no DB, no I/O.
describe("computeTechnicalDemonstrationPlanRequestFingerprint", () => {
  const base = {
    ownerUserId: "owner-1",
    clientId: "client-1",
    analysisProposalId: "proposal-1",
    analysisProposalConfirmedAt: "2026-08-31T12:20:51.717Z",
    vertical: "cutting",
    generatorVersion: "1.2.0-td25e",
  };

  // Invariant A: same authoritative inputs (including the same
  // generatorVersion) always produce the same fingerprint -- this is what
  // makes repeated creation idempotent.
  it("is deterministic -- identical input always produces the identical fingerprint", () => {
    expect(computeTechnicalDemonstrationPlanRequestFingerprint(base)).toBe(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base }));
  });

  // Invariant B: changing ANY single field of the scope -- including
  // generatorVersion specifically -- changes the fingerprint.
  it("changes when any single field of the scope changes, including generatorVersion", () => {
    const original = computeTechnicalDemonstrationPlanRequestFingerprint(base);
    expect(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, ownerUserId: "owner-2" })).not.toBe(original);
    expect(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, clientId: "client-2" })).not.toBe(original);
    expect(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, analysisProposalId: "proposal-2" })).not.toBe(original);
    expect(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, analysisProposalConfirmedAt: "2026-09-01T00:00:00.000Z" })).not.toBe(
      original,
    );
    expect(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, vertical: "color" })).not.toBe(original);
    expect(computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, generatorVersion: "1.1.0-td25a" })).not.toBe(original);
  });

  // Invariant C: the real Stage 2.5.e.1 generator version does not collide
  // with the real, previously-shipped Stage 2.5.a generator version (the
  // exact value production's own V2 plan was created under) for otherwise
  // identical authoritative inputs -- proven with the real string
  // constants' own values, not placeholders.
  it("the Stage 2.5.e.1 generator version ('1.2.0-td25e') never collides with the prior Stage 2.5.a version ('1.1.0-td25a') for identical inputs", () => {
    const oldVersionFingerprint = computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, generatorVersion: "1.1.0-td25a" });
    const newVersionFingerprint = computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, generatorVersion: "1.2.0-td25e" });
    expect(newVersionFingerprint).not.toBe(oldVersionFingerprint);
  });

  // Same invariant, now for the Stage 2.5.f.2 (current re-derivation)
  // generator version bump -- does not collide with the prior Stage
  // 2.5.e.1 value production's own V3 was created under.
  it("the Stage 2.5.f.2 generator version ('1.3.0-td25f2') never collides with the prior Stage 2.5.e.1 version ('1.2.0-td25e') for identical inputs", () => {
    const oldVersionFingerprint = computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, generatorVersion: "1.2.0-td25e" });
    const newVersionFingerprint = computeTechnicalDemonstrationPlanRequestFingerprint({ ...base, generatorVersion: "1.3.0-td25f2" });
    expect(newVersionFingerprint).not.toBe(oldVersionFingerprint);
  });
});
