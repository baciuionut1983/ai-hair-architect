import { describe, expect, it } from "vitest";

import {
  buildActiveProfessionalKnowledgeRegistry,
  computeProfessionalKnowledgeRegistryFingerprint,
  queryApprovedButUnattached,
  queryContextualKnowledgeBySubject,
  queryEvidenceSupportingSkill,
  queryTechniquePurposes,
  queryTechniquesByEffect,
  queryWorkflowTransitionsFrom,
  summarizeProfessionalKnowledgeSnapshot,
} from "@/lib/professional-knowledge-registry";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 -- pure
// tests for the Professional Knowledge Registry: fingerprinting,
// snapshot categorization, and deterministic queries. No I/O, no
// database, ZERO AI calls, ZERO LLM anywhere in this file.

describe("buildActiveProfessionalKnowledgeRegistry -- deterministic, 16 entries", () => {
  it("test 1: returns 16 entries, deterministically", () => {
    expect(buildActiveProfessionalKnowledgeRegistry()).toHaveLength(16);
    expect(buildActiveProfessionalKnowledgeRegistry()).toHaveLength(16);
  });
});

describe("fingerprint -- deterministic, order-independent", () => {
  it("test 2: identical entry sets produce identical fingerprints", () => {
    const registry = buildActiveProfessionalKnowledgeRegistry();
    expect(computeProfessionalKnowledgeRegistryFingerprint(registry)).toBe(computeProfessionalKnowledgeRegistryFingerprint(registry));
  });

  it("test 3: reordering the same entries produces the identical fingerprint (canonical sort by id)", () => {
    const registry = buildActiveProfessionalKnowledgeRegistry();
    const reversed = [...registry].reverse();
    expect(computeProfessionalKnowledgeRegistryFingerprint(registry)).toBe(computeProfessionalKnowledgeRegistryFingerprint(reversed));
  });

  it("test 4: a smaller registry produces a different fingerprint", () => {
    const registry = buildActiveProfessionalKnowledgeRegistry();
    expect(computeProfessionalKnowledgeRegistryFingerprint(registry.slice(1))).not.toBe(computeProfessionalKnowledgeRegistryFingerprint(registry));
  });
});

describe("snapshot summary -- exact category counts", () => {
  const summary = summarizeProfessionalKnowledgeSnapshot(buildActiveProfessionalKnowledgeRegistry());

  it("test 5: totalEntries is 16", () => {
    expect(summary.totalEntries).toBe(16);
  });

  it("test 6: category counts sum to 16", () => {
    const sum = Object.values(summary.countsByCategory).reduce((a, b) => a + b, 0);
    expect(sum).toBe(16);
  });

  it("test 7: ACTIVE_TECHNIQUE_IDENTITY = 3, ACTIVE_PURPOSE = 3, ACTIVE_EFFECT_RELATIONSHIP = 1, ACTIVE_WORKFLOW = 1, ACTIVE_CONTEXTUAL_KNOWLEDGE = 3, ACTIVE_EVIDENCE_SUPPORT = 1, APPROVED_BUT_UNATTACHED = 4", () => {
    expect(summary.countsByCategory.ACTIVE_TECHNIQUE_IDENTITY).toBe(3);
    expect(summary.countsByCategory.ACTIVE_PURPOSE).toBe(3);
    expect(summary.countsByCategory.ACTIVE_EFFECT_RELATIONSHIP).toBe(1);
    expect(summary.countsByCategory.ACTIVE_WORKFLOW).toBe(1);
    expect(summary.countsByCategory.ACTIVE_CONTEXTUAL_KNOWLEDGE).toBe(3);
    expect(summary.countsByCategory.ACTIVE_EVIDENCE_SUPPORT).toBe(1);
    expect(summary.countsByCategory.APPROVED_BUT_UNATTACHED).toBe(4);
    expect(summary.countsByCategory.UNKNOWN).toBe(0);
  });
});

describe("Query A: what purposes can Point Cut serve?", () => {
  it("returns ALIGNMENT_CORRECTION, and only that", () => {
    const purposes = queryTechniquePurposes(buildActiveProfessionalKnowledgeRegistry(), "point-cut");
    expect(purposes).toEqual(["ALIGNMENT_CORRECTION"]);
  });

  it("returns an empty array for an unknown techniqueId -- never invents a purpose", () => {
    expect(queryTechniquePurposes(buildActiveProfessionalKnowledgeRegistry(), "not-a-real-technique")).toEqual([]);
  });
});

describe("Query B: what techniques may reduce/lighten terminal mass?", () => {
  it("returns the 3 distinct techniques, never aliased", () => {
    const techniques = queryTechniquesByEffect(buildActiveProfessionalKnowledgeRegistry(), "REDUCE_SOFTEN_TEXTURIZE_TERMINAL_MASS");
    expect(techniques).toEqual(["deep-point-cut", "channel-cut", "skill-cutting-slice-and-slide-refinement"]);
    expect(new Set(techniques).size).toBe(3);
  });
});

describe("Query C: what workflow transition is known after wet structural cutting?", () => {
  it("returns dry_refinement_check_finishing", () => {
    const transitions = queryWorkflowTransitionsFrom(buildActiveProfessionalKnowledgeRegistry(), "wet_structural_work");
    expect(transitions).toHaveLength(1);
    expect(transitions[0].toValue).toBe("dry_refinement_check_finishing");
  });
});

describe("Query D: what professional evidence supports Graduated Cutting?", () => {
  it("returns the real evidence entry, without cloning the skill", () => {
    const evidence = queryEvidenceSupportingSkill(buildActiveProfessionalKnowledgeRegistry(), "skill-cutting-graduated");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].kind).toBe("EVIDENCE_SUPPORT");
  });

  it("returns empty for a skill with no evidence attached", () => {
    expect(queryEvidenceSupportingSkill(buildActiveProfessionalKnowledgeRegistry(), "skill-cutting-one-length-perimeter")).toEqual([]);
  });
});

describe("Query E: what is commonly used on short-hair terminal zones?", () => {
  it("returns Deep Point Cut and Channel Cut's real contextual claims, all COMMONLY_USED_FOR -- never REQUIRED", () => {
    const results = queryContextualKnowledgeBySubject(buildActiveProfessionalKnowledgeRegistry(), "SHORT");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.relation).toBe("COMMONLY_USED_FOR");
  });
});

describe("Query F: what knowledge is professionally approved but not safely attached?", () => {
  it("returns exactly the 4 pending items, visible and retrievable", () => {
    const pending = queryApprovedButUnattached(buildActiveProfessionalKnowledgeRegistry());
    expect(pending).toHaveLength(4);
    for (const entry of pending) expect(entry.kind).toBe("PENDING_OBSERVATION");
  });
});
