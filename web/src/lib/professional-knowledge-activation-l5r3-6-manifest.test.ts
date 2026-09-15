import { describe, expect, it } from "vitest";

import {
  buildKnowledgeActivationManifest,
  buildRealProfessionalKnowledgeEntries,
  buildScopedMutationSet,
  EXPECTED_MUTATION_COUNT,
  validateKnowledgeActivationManifest,
} from "@/lib/professional-knowledge-activation-l5r3-6-manifest";
import { isValidProfessionalKnowledgeEntry } from "@/lib/professional-knowledge-entry-contracts";
import { buildRealAssimilationPlan } from "@/lib/professional-knowledge-assimilation-l5r3-4-real-plan";
import { buildProposedRegistryMutation } from "@/lib/professional-knowledge-assimilation-mutation-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 -- pure
// tests proving the REAL 16 entries built from the REAL 10 approved
// L5.R3.4.R1 mutations are correct, safe, distinct, and provenance-
// honest. No I/O, no database, ZERO AI calls.

describe("scoped mutation set -- exactly the 10 non-45deg-Interior mutations", () => {
  it("test 1: EXPECTED_MUTATION_COUNT is 10", () => {
    expect(EXPECTED_MUTATION_COUNT).toBe(10);
  });

  it("test 2: buildScopedMutationSet excludes the 45deg Interior mutation", () => {
    const scoped = buildScopedMutationSet();
    expect(scoped).toHaveLength(10);
    expect(scoped.some((m) => m.proposedIdentity?.techniqueId === "45-degree-interior")).toBe(false);
  });

  it("test 3: the real plan itself still has all 10 mutations, untouched", () => {
    expect(buildRealAssimilationPlan().mutationSet).toHaveLength(10);
  });
});

describe("the real entry set -- 16 total, 12 ACTIVE + 4 APPROVED_BUT_UNATTACHED", () => {
  it("test 4: builds exactly 16 entries", () => {
    expect(buildRealProfessionalKnowledgeEntries()).toHaveLength(16);
  });

  it("test 5: exactly 12 ACTIVE entries", () => {
    expect(buildRealProfessionalKnowledgeEntries().filter((e) => e.status === "ACTIVE")).toHaveLength(12);
  });

  it("test 6: exactly 4 APPROVED_BUT_UNATTACHED entries", () => {
    expect(buildRealProfessionalKnowledgeEntries().filter((e) => e.status === "APPROVED_BUT_UNATTACHED")).toHaveLength(4);
  });

  it("test 7: every entry is structurally valid", () => {
    for (const entry of buildRealProfessionalKnowledgeEntries()) expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 8: every entry id is unique -- no accidental duplicate", () => {
    const ids = buildRealProfessionalKnowledgeEntries().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("test 9 (idempotency): rebuilding twice produces byte-identical entries -- no duplication, no drift", () => {
    const first = JSON.stringify(buildRealProfessionalKnowledgeEntries());
    const second = JSON.stringify(buildRealProfessionalKnowledgeEntries());
    expect(second).toBe(first);
  });
});

describe("Graduated Cutting evidence support (A) -- supports without cloning", () => {
  it("test 10: exactly one EVIDENCE_SUPPORT entry, targeting skill-cutting-graduated", () => {
    const evidence = buildRealProfessionalKnowledgeEntries().filter((e) => e.kind === "EVIDENCE_SUPPORT");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].kind === "EVIDENCE_SUPPORT" && evidence[0].payload.targetSkillId).toBe("skill-cutting-graduated");
  });

  it("test 11: fieldsPreservedUnchanged names the real, already-declared Graduated Cutting parameters", () => {
    const evidence = buildRealProfessionalKnowledgeEntries().find((e) => e.kind === "EVIDENCE_SUPPORT")!;
    expect(evidence.kind === "EVIDENCE_SUPPORT" && evidence.payload.fieldsPreservedUnchanged).toContain("guideType");
  });
});

describe("technique identity distinctness (technique vs effect vs identity)", () => {
  const entries = buildRealProfessionalKnowledgeEntries();
  const identities = entries.filter((e) => e.kind === "TECHNIQUE_IDENTITY");

  it("test 12: exactly 3 TECHNIQUE_IDENTITY entries -- deep-point-cut, point-cut, channel-cut, never merged", () => {
    const ids = identities.map((e) => (e.kind === "TECHNIQUE_IDENTITY" ? e.payload.technique.techniqueId : ""));
    expect(new Set(ids)).toEqual(new Set(["deep-point-cut", "point-cut", "channel-cut"]));
  });

  it("test 13: all three declare distinctFrom skill-cutting-slice-and-slide-refinement", () => {
    for (const entry of identities) {
      expect(entry.kind === "TECHNIQUE_IDENTITY" && entry.payload.technique.distinctFrom).toContain("skill-cutting-slice-and-slide-refinement");
    }
  });

  it("test 14: Deep Point Cut remains distinct from Point Cut -- different techniqueIds, different entries", () => {
    const deep = identities.find((e) => e.kind === "TECHNIQUE_IDENTITY" && e.payload.technique.techniqueId === "deep-point-cut")!;
    const point = identities.find((e) => e.kind === "TECHNIQUE_IDENTITY" && e.payload.technique.techniqueId === "point-cut")!;
    expect(deep.id).not.toBe(point.id);
  });

  it("test 15: Channel Cut remains distinct from Deep Point Cut and Point Cut", () => {
    const channel = identities.find((e) => e.kind === "TECHNIQUE_IDENTITY" && e.payload.technique.techniqueId === "channel-cut")!;
    const others = identities.filter((e) => e.kind === "TECHNIQUE_IDENTITY" && e.payload.technique.techniqueId !== "channel-cut");
    for (const other of others) expect(channel.id).not.toBe(other.id);
  });
});

describe("purpose model (C) -- Point Cut correction/alignment, independent of identity", () => {
  const entries = buildRealProfessionalKnowledgeEntries();

  it("test 16: Point Cut's TECHNIQUE_PURPOSE entry is retrievable and equals ALIGNMENT_CORRECTION", () => {
    const purpose = entries.find((e) => e.kind === "TECHNIQUE_PURPOSE" && e.payload.techniqueId === "point-cut")!;
    expect(purpose).toBeDefined();
    expect(purpose.kind === "TECHNIQUE_PURPOSE" && purpose.payload.purpose).toBe("ALIGNMENT_CORRECTION");
  });

  it("test 17: Point Cut does NOT become universally texturizing -- its own purpose entry never equals Deep Point Cut's TEXTURIZATION_WEIGHT_REDUCTION", () => {
    const pointPurpose = entries.find((e) => e.kind === "TECHNIQUE_PURPOSE" && e.payload.techniqueId === "point-cut")!;
    const deepPurpose = entries.find((e) => e.kind === "TECHNIQUE_PURPOSE" && e.payload.techniqueId === "deep-point-cut")!;
    expect(pointPurpose.kind === "TECHNIQUE_PURPOSE" && pointPurpose.payload.purpose).not.toBe(deepPurpose.kind === "TECHNIQUE_PURPOSE" && deepPurpose.payload.purpose);
  });

  it("test 18: Channel Cut's own purpose is SUPERFICIAL_LIGHTENING_SURFACE_REFINEMENT, distinct from both", () => {
    const channelPurpose = entries.find((e) => e.kind === "TECHNIQUE_PURPOSE" && e.payload.techniqueId === "channel-cut")!;
    expect(channelPurpose.kind === "TECHNIQUE_PURPOSE" && channelPurpose.payload.purpose).toBe("SUPERFICIAL_LIGHTENING_SURFACE_REFINEMENT");
  });
});

describe("effect model (F) -- shared effect, never aliased identities", () => {
  const entries = buildRealProfessionalKnowledgeEntries();
  const effect = entries.find((e) => e.kind === "EFFECT_RELATIONSHIP")!;

  it("test 19: exactly one EFFECT_RELATIONSHIP entry", () => {
    expect(entries.filter((e) => e.kind === "EFFECT_RELATIONSHIP")).toHaveLength(1);
  });

  it("test 20: names exactly the 3 real, distinct related technique ids", () => {
    expect(effect.kind === "EFFECT_RELATIONSHIP" && effect.payload.relatedTechniqueIds).toEqual(["deep-point-cut", "channel-cut", "skill-cutting-slice-and-slide-refinement"]);
  });

  it("test 21: the effect label is the real, approved REDUCE_SOFTEN_TEXTURIZE_TERMINAL_MASS", () => {
    expect(effect.kind === "EFFECT_RELATIONSHIP" && effect.payload.effect).toBe("REDUCE_SOFTEN_TEXTURIZE_TERMINAL_MASS");
  });

  it("test 22: sharing an effect never implies the 3 techniques are the same -- 3 distinct ids, not 1", () => {
    expect(effect.kind === "EFFECT_RELATIONSHIP" && new Set(effect.payload.relatedTechniqueIds).size).toBe(3);
  });
});

describe("workflow model (E) -- wet -> dry, never a fake technique", () => {
  const entries = buildRealProfessionalKnowledgeEntries();
  const workflow = entries.find((e) => e.kind === "WORKFLOW_TRANSITION")!;

  it("test 23: exactly one WORKFLOW_TRANSITION entry", () => {
    expect(entries.filter((e) => e.kind === "WORKFLOW_TRANSITION")).toHaveLength(1);
  });

  it("test 24: the real transition is wet_structural_work -> dry_refinement_check_finishing", () => {
    expect(workflow.kind === "WORKFLOW_TRANSITION" && workflow.payload.transition).toEqual({ fact: "hairWorkflowPhase", fromValue: "wet_structural_work", toValue: "dry_refinement_check_finishing" });
  });

  it("test 25: this entry never carries a techniqueId/procedure -- it is workflow knowledge, never a disguised cutting skill", () => {
    expect(workflow.payload).not.toHaveProperty("techniqueId");
    expect(workflow.payload).not.toHaveProperty("procedure");
  });
});

describe("contextual knowledge (B, D) -- commonly used != required", () => {
  const entries = buildRealProfessionalKnowledgeEntries();
  const contextual = entries.filter((e) => e.kind === "CONTEXTUAL_KNOWLEDGE");

  it("test 26: exactly 3 CONTEXTUAL_KNOWLEDGE entries (2 for Deep Point Cut, 1 for Channel Cut)", () => {
    expect(contextual).toHaveLength(3);
  });

  it("test 27: every contextual entry's relation is from the ContextualPreferenceRelation vocabulary only", () => {
    const allowed = ["COMMONLY_USED_FOR", "TYPICALLY_USED_FOR", "PREFERRED_IN_CONTEXT", "COMPATIBLE_WITH", "ALTERNATIVE_TO", "MAY_BE_USED_FOR"];
    for (const entry of contextual) expect(entry.kind === "CONTEXTUAL_KNOWLEDGE" && allowed).toContain(entry.kind === "CONTEXTUAL_KNOWLEDGE" ? entry.payload.claim.relation : "");
  });

  it("test 28: Deep Point Cut's short-hair contextual claim is COMMONLY_USED_FOR, never REQUIRED_FOR (that relation does not exist in the vocabulary at all)", () => {
    const shortHair = contextual.find((e) => e.kind === "CONTEXTUAL_KNOWLEDGE" && e.payload.claim.subject === "SHORTER_HAIR")!;
    expect(shortHair.kind === "CONTEXTUAL_KNOWLEDGE" && shortHair.payload.claim.relation).toBe("COMMONLY_USED_FOR");
  });

  it("test 29: Channel Cut's sideburn/fringe/nape contextual claim stays COMMONLY_USED_FOR, never mandatory", () => {
    const channelContext = contextual.find((e) => e.kind === "CONTEXTUAL_KNOWLEDGE" && e.payload.techniqueId === "channel-cut")!;
    expect(channelContext.kind === "CONTEXTUAL_KNOWLEDGE" && channelContext.payload.claim.relation).toBe("COMMONLY_USED_FOR");
    expect(channelContext.kind === "CONTEXTUAL_KNOWLEDGE" && channelContext.payload.claim.subject).toBe("SHORT_HAIR_SIDEBURNS_FRINGE_NAPE");
  });
});

describe("provenance proof -- especially Channel Cut", () => {
  const entries = buildRealProfessionalKnowledgeEntries();

  it("test 30: Channel Cut's TECHNIQUE_IDENTITY entry has originalAIClaim = null and decisionType = ADDITION", () => {
    const channelIdentity = entries.find((e) => e.kind === "TECHNIQUE_IDENTITY" && e.payload.technique.techniqueId === "channel-cut")!;
    expect(channelIdentity.provenance.originalAIClaim).toBeNull();
    expect(channelIdentity.provenance.decisionType).toBe("ADDITION");
  });

  it("test 31: professionalAuthority is PROFESSIONAL_INPUT on every entry -- never AI-authored", () => {
    for (const entry of entries) expect(entry.provenance.professionalAuthority).toBe("PROFESSIONAL_INPUT");
  });

  it("test 32: provenance survives JSON serialization byte-for-byte", () => {
    const entry = entries[0];
    const roundTripped = JSON.parse(JSON.stringify(entry));
    expect(roundTripped.provenance).toEqual(entry.provenance);
  });

  it("test 33: every sourceDecisionId is a real id present in the real L5.R3.2 decisions (never fabricated)", () => {
    // Indirect proof: provenanceFromMutation throws if the id is not
    // found -- buildRealProfessionalKnowledgeEntries() having succeeded
    // at all (test 4) already proves every id resolved. This test
    // additionally confirms the ids are non-empty, well-formed hashes.
    for (const entry of entries) expect(entry.provenance.sourceDecisionId).toMatch(/^[0-9a-f]{20,}$/);
  });
});

describe("the four pending items (#4, #9, #10, #6a) -- remain professionally approved but unattached", () => {
  const entries = buildRealProfessionalKnowledgeEntries();
  const pending = entries.filter((e) => e.kind === "PENDING_OBSERVATION");

  it("test 34: exactly 4 PENDING_OBSERVATION entries", () => {
    expect(pending).toHaveLength(4);
  });

  it("test 35: all 4 have status APPROVED_BUT_UNATTACHED (never ACTIVE, never dropped)", () => {
    for (const entry of pending) expect(entry.status).toBe("APPROVED_BUT_UNATTACHED");
  });

  it("test 36: unknownFields on each pending entry is preserved verbatim from the real mutation -- never populated with new authority", () => {
    const summaries = pending.map((e) => (e.kind === "PENDING_OBSERVATION" ? e.payload.unknownFields.join("|") : ""));
    expect(summaries.some((s) => s.includes("exact overdirection angle"))).toBe(true);
    expect(summaries.some((s) => s.includes("any anatomical target beyond forward/outward"))).toBe(true);
  });

  it("test 37: pending entries carry no techniqueId/targetSkillId -- they cannot be mistaken for an attached entry", () => {
    for (const entry of pending) {
      expect(entry.payload).not.toHaveProperty("techniqueId");
      expect(entry.payload).not.toHaveProperty("targetSkillId");
    }
  });

  it("test 38: pending entries are structurally inert -- no ACTIVE-only query function (queryTechniquePurposes/queryTechniquesByEffect/queryEvidenceSupportingSkill/queryWorkflowTransitionsFrom/queryContextualKnowledgeBySubject) can ever return one, since all are gated on status === 'ACTIVE'", () => {
    for (const entry of pending) expect(entry.status).not.toBe("ACTIVE");
  });
});

describe("activation manifest -- fail-closed", () => {
  it("test 39: expectedMutationCount is 10", () => {
    expect(buildKnowledgeActivationManifest().expectedMutationCount).toBe(10);
  });

  it("test 40: deterministic activationId across repeated builds", () => {
    expect(buildKnowledgeActivationManifest().activationId).toBe(buildKnowledgeActivationManifest().activationId);
  });

  it("test 41: a correct manifest against the live scoped set is valid", () => {
    const manifest = buildKnowledgeActivationManifest();
    const result = validateKnowledgeActivationManifest(manifest, buildScopedMutationSet());
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("test 42: an unexpected 11th mutation fails closed", () => {
    const manifest = buildKnowledgeActivationManifest();
    const fake = buildProposedRegistryMutation({
      sourceEvidenceId: "x",
      approvedResultHash: "x",
      operation: "KEEP_PENDING",
      discriminator: "unauthorized",
      sourceDecisionIds: ["x"],
      reason: "test fixture",
    });
    const tampered = [...buildScopedMutationSet(), fake];
    const result = validateKnowledgeActivationManifest(manifest, tampered);
    expect(result.valid).toBe(false);
  });

  it("test 43: a missing mutation fails closed", () => {
    const manifest = buildKnowledgeActivationManifest();
    const missingOne = buildScopedMutationSet().filter((_, i) => i !== 0);
    const result = validateKnowledgeActivationManifest(manifest, missingOne);
    expect(result.valid).toBe(false);
  });

  it("test 44 (idempotency, no duplicate relationships): rebuilding the manifest twice never changes sourceMutationIds length or content", () => {
    const first = buildKnowledgeActivationManifest();
    const second = buildKnowledgeActivationManifest();
    expect(first.sourceMutationIds).toEqual(second.sourceMutationIds);
  });
});
