import { describe, expect, it } from "vitest";

import { buildProposedRegistryMutation, computeProposedRegistryMutationId, MUTATION_ACTIVATION_STATES } from "@/lib/professional-knowledge-assimilation-mutation-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.4 -- pure
// tests for the proposed-registry-mutation contracts, no I/O, no
// database, no AI calls.

describe("professional-knowledge-assimilation-mutation-contracts", () => {
  it("test 3: MUTATION_ACTIVATION_STATES has exactly one member -- construction can never produce anything other than PENDING_PROFESSIONAL_APPROVAL", () => {
    expect(MUTATION_ACTIVATION_STATES).toEqual(["PENDING_PROFESSIONAL_APPROVAL"]);
  });

  it("every constructed mutation has activationState PENDING_PROFESSIONAL_APPROVAL, regardless of operation", () => {
    const mutation = buildProposedRegistryMutation({
      sourceEvidenceId: "ev-1",
      approvedResultHash: "hash-1",
      operation: "PROPOSE_NEW_SKILL",
      discriminator: "test",
      sourceDecisionIds: ["decision-1"],
      reason: "test",
    });
    expect(mutation.activationState).toBe("PENDING_PROFESSIONAL_APPROVAL");
  });

  it("fails closed: a mutation with zero source decisions is refused -- every proposal must be justified by real professional authority", () => {
    expect(() =>
      buildProposedRegistryMutation({
        sourceEvidenceId: "ev-1",
        approvedResultHash: "hash-1",
        operation: "KEEP_PENDING",
        discriminator: "test",
        sourceDecisionIds: [],
        reason: "test",
      }),
    ).toThrow();
  });

  it("professionalAuthority is always PROFESSIONAL_INPUT -- never any other provenance value", () => {
    const mutation = buildProposedRegistryMutation({ sourceEvidenceId: "ev-1", approvedResultHash: "hash-1", operation: "KEEP_PENDING", discriminator: "test", sourceDecisionIds: ["d-1"], reason: "test" });
    expect(mutation.professionalAuthority).toBe("PROFESSIONAL_INPUT");
  });

  it("determinism: identical inputs produce identical mutation ids; a changed discriminator changes the id", () => {
    const a = computeProposedRegistryMutationId("ev-1", "hash-1", "ATTACH_EVIDENCE", "disc-1");
    const b = computeProposedRegistryMutationId("ev-1", "hash-1", "ATTACH_EVIDENCE", "disc-1");
    const c = computeProposedRegistryMutationId("ev-1", "hash-1", "ATTACH_EVIDENCE", "disc-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
