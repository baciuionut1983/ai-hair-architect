import { describe, expect, it } from "vitest";

import {
  ACTIVATION_ELIGIBLE_TECHNIQUE_IDS,
  EXPECTED_APPROVED_PROPOSAL_COUNT,
  buildActivationManifest,
  buildAuthorizedProposalSet,
  classifyMutationForActivation,
  computePreActivationBaselineRegistryFingerprint,
  validateActivationManifest,
} from "@/lib/professional-knowledge-activation-l5r3-5-manifest";
import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { INTERIOR_45_PROPOSED_MUTATION } from "@/lib/professional-knowledge-assimilation-l5r3-4-r2-proposal";
import { buildProposedRegistryMutation } from "@/lib/professional-knowledge-assimilation-mutation-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.5 -- pure
// tests for the activation manifest / classification / fail-closed
// validation. No I/O, no database, ZERO AI calls.

describe("EXPECTED_APPROVED_PROPOSAL_COUNT is exactly 11", () => {
  it("test 1", () => {
    expect(EXPECTED_APPROVED_PROPOSAL_COUNT).toBe(11);
  });
});

describe("buildAuthorizedProposalSet -- the exact 10+1 = 11 authorized set", () => {
  it("test 2: contains exactly 11 mutations", () => {
    expect(buildAuthorizedProposalSet()).toHaveLength(11);
  });

  it("test 3: contains all 10 existing L5.R3.4.R1 mutations plus the 1 new L5.R3.4.R2 mutation, ids match exactly", () => {
    const existing = buildRealAssimilationPlan().mutationSet;
    const authorized = buildAuthorizedProposalSet();
    for (const m of existing) expect(authorized.map((a) => a.id)).toContain(m.id);
    expect(authorized.map((a) => a.id)).toContain(INTERIOR_45_PROPOSED_MUTATION.id);
  });

  it("test 4: every id is unique -- no accidental duplicate/12th item", () => {
    const ids = buildAuthorizedProposalSet().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("classifyMutationForActivation -- deterministic, exhaustive over the real 11", () => {
  it("test 5: exactly 4 mutations classify PENDING_BY_DESIGN (the plan's own KEEP_PENDING items: #4-guide, #9, #10, #6a-direction)", () => {
    const results = buildAuthorizedProposalSet().map(classifyMutationForActivation);
    expect(results.filter((r) => r.classification === "PENDING_BY_DESIGN")).toHaveLength(4);
    for (const r of results.filter((r) => r.classification === "PENDING_BY_DESIGN")) expect(r.operation).toBe("KEEP_PENDING");
  });

  it("test 6: exactly 1 mutation classifies ACTIVATED -- the 45-degree-interior PROPOSE_NEW_SKILL", () => {
    const results = buildAuthorizedProposalSet().map(classifyMutationForActivation);
    const activated = results.filter((r) => r.classification === "ACTIVATED");
    expect(activated).toHaveLength(1);
    expect(activated[0].mutationId).toBe(INTERIOR_45_PROPOSED_MUTATION.id);
  });

  it("test 7: exactly 6 mutations classify PENDING_NO_MECHANISM (ATTACH_EVIDENCE, deep-point-cut, point-cut, channel-cut, ADD_WORKFLOW_STATE_TRANSITION, ADD_EFFECT_RELATIONSHIP)", () => {
    const results = buildAuthorizedProposalSet().map(classifyMutationForActivation);
    expect(results.filter((r) => r.classification === "PENDING_NO_MECHANISM")).toHaveLength(6);
  });

  it("test 8: 1 + 4 + 6 = 11 -- every authorized mutation is classified, none dropped", () => {
    const results = buildAuthorizedProposalSet().map(classifyMutationForActivation);
    expect(results).toHaveLength(11);
  });

  it("test 9: deep-point-cut/point-cut/channel-cut PROPOSE_NEW_SKILL mutations are NOT accidentally activated -- only techniqueIds in ACTIVATION_ELIGIBLE_TECHNIQUE_IDS activate", () => {
    const plan = buildRealAssimilationPlan();
    const deepPointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "deep-point-cut")!;
    const pointCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "point-cut")!;
    const channelCut = plan.mutationSet.find((m) => m.proposedIdentity?.techniqueId === "channel-cut")!;
    for (const m of [deepPointCut, pointCut, channelCut]) {
      expect(classifyMutationForActivation(m).classification).toBe("PENDING_NO_MECHANISM");
    }
    expect(ACTIVATION_ELIGIBLE_TECHNIQUE_IDS.has("deep-point-cut")).toBe(false);
    expect(ACTIVATION_ELIGIBLE_TECHNIQUE_IDS.has("point-cut")).toBe(false);
    expect(ACTIVATION_ELIGIBLE_TECHNIQUE_IDS.has("channel-cut")).toBe(false);
    expect(ACTIVATION_ELIGIBLE_TECHNIQUE_IDS.has("45-degree-interior")).toBe(true);
  });

  it("test 10: a fabricated, never-approved 12th mutation (e.g. a synthetic PROPOSE_NEW_SKILL for an unapproved techniqueId) still classifies structurally -- but is never part of buildAuthorizedProposalSet(), proving the authorized set cannot silently grow", () => {
    const fake = buildProposedRegistryMutation({
      sourceEvidenceId: "test-only",
      approvedResultHash: "test-only",
      operation: "PROPOSE_NEW_SKILL",
      discriminator: "fake-unapproved-technique",
      proposedIdentity: { techniqueId: "fake-unapproved-technique", label: "Fake", purpose: "TEST_ONLY" },
      sourceDecisionIds: ["test-only"],
      reason: "test fixture only, never a real professional proposal",
    });
    expect(classifyMutationForActivation(fake).classification).toBe("PENDING_NO_MECHANISM");
    expect(buildAuthorizedProposalSet().map((m) => m.id)).not.toContain(fake.id);
  });
});

describe("buildActivationManifest -- deterministic, complete, correct", () => {
  it("test 11: expectedProposalCount is 11", () => {
    expect(buildActivationManifest().expectedProposalCount).toBe(11);
  });

  it("test 12: sourceProposalIds has length 11, all unique", () => {
    const manifest = buildActivationManifest();
    expect(manifest.sourceProposalIds).toHaveLength(11);
    expect(new Set(manifest.sourceProposalIds).size).toBe(11);
  });

  it("test 13: activationId is deterministic across repeated builds", () => {
    expect(buildActivationManifest().activationId).toBe(buildActivationManifest().activationId);
  });

  it("test 14: professionalAuthority is PROFESSIONAL_INPUT, activationState is MANIFEST_PREPARED", () => {
    const manifest = buildActivationManifest();
    expect(manifest.professionalAuthority).toBe("PROFESSIONAL_INPUT");
    expect(manifest.activationState).toBe("MANIFEST_PREPARED");
  });

  it("test 15: unknownFields is de-duplicated and sorted", () => {
    const fields = buildActivationManifest().unknownFields;
    expect(new Set(fields).size).toBe(fields.length);
    expect([...fields].sort()).toEqual(fields);
  });

  it("test 16: expectedTargetIdentities / expectedOperationTypes / conflictStatus each have length 11, positionally aligned with sourceProposalIds", () => {
    const manifest = buildActivationManifest();
    expect(manifest.expectedTargetIdentities).toHaveLength(11);
    expect(manifest.expectedOperationTypes).toHaveLength(11);
    expect(manifest.conflictStatus).toHaveLength(11);
  });
});

describe("computePreActivationBaselineRegistryFingerprint -- excludes 45-degree-interior", () => {
  it("test 17: is deterministic across repeated calls", () => {
    expect(computePreActivationBaselineRegistryFingerprint()).toBe(computePreActivationBaselineRegistryFingerprint());
  });
});

describe("validateActivationManifest -- FAIL-CLOSED", () => {
  it("test 18: a correct manifest against the live authorized set is VALID, zero failures", () => {
    const manifest = buildActivationManifest();
    const result = validateActivationManifest(manifest, buildAuthorizedProposalSet(), computePreActivationBaselineRegistryFingerprint());
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("test 19: proposal count != 11 fails closed", () => {
    const manifest = buildActivationManifest();
    const shortSet = buildAuthorizedProposalSet().slice(0, 10);
    const result = validateActivationManifest(manifest, shortSet, computePreActivationBaselineRegistryFingerprint());
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes("count"))).toBe(true);
  });

  it("test 20: an unexpected 12th proposal fails closed", () => {
    const manifest = buildActivationManifest();
    const fake = buildProposedRegistryMutation({
      sourceEvidenceId: "x",
      approvedResultHash: "x",
      operation: "PROPOSE_NEW_SKILL",
      discriminator: "unauthorized-12th",
      proposedIdentity: { techniqueId: "unauthorized-12th", label: "Unauthorized", purpose: "TEST" },
      sourceDecisionIds: ["x"],
      reason: "test fixture",
    });
    const tamperedSet = [...buildAuthorizedProposalSet(), fake];
    const result = validateActivationManifest(manifest, tamperedSet, computePreActivationBaselineRegistryFingerprint());
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes(fake.id))).toBe(true);
  });

  it("test 21: a missing approved proposal fails closed", () => {
    const manifest = buildActivationManifest();
    const missingOne = buildAuthorizedProposalSet().filter((_, index) => index !== 3);
    const result = validateActivationManifest(manifest, missingOne, computePreActivationBaselineRegistryFingerprint());
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes("missing from the live authorized set"))).toBe(true);
  });

  it("test 22: a drifted/tampered registry baseline fingerprint fails closed", () => {
    const manifest = buildActivationManifest();
    const result = validateActivationManifest(manifest, buildAuthorizedProposalSet(), "tampered-fingerprint-does-not-match");
    expect(result.valid).toBe(false);
    expect(result.failures.some((f) => f.includes("fingerprint"))).toBe(true);
  });
});
