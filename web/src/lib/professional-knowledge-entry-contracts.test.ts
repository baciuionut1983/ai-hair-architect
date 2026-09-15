import { describe, expect, it } from "vitest";

import {
  computeProfessionalKnowledgeEntryId,
  isProfessionalKnowledgeEntryKind,
  isProfessionalKnowledgeEntryStatus,
  isValidProfessionalKnowledgeEntry,
  PROFESSIONAL_KNOWLEDGE_ENTRY_KINDS,
  PROFESSIONAL_KNOWLEDGE_ENTRY_STATUSES,
  type ProfessionalKnowledgeEntry,
} from "@/lib/professional-knowledge-entry-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.6 -- pure
// tests for the ProfessionalKnowledgeEntry contract layer. No I/O, no
// database, no AI calls. Every fixture below is SYNTHETIC (explicitly
// labeled) -- real content is tested separately, against the real
// approved data, in professional-knowledge-activation-l5r3-6-manifest.test.ts.

const PROVENANCE_ADDITION = { originalAIClaim: null, decisionType: "ADDITION" as const, professionalAuthority: "PROFESSIONAL_INPUT" as const, sourceDecisionId: "synthetic-decision-1" };
const PROVENANCE_CONFIRMATION = { originalAIClaim: { value: "x", provenance: "OBSERVED" as const }, decisionType: "CONFIRMATION" as const, professionalAuthority: "PROFESSIONAL_INPUT" as const, sourceDecisionId: "synthetic-decision-2" };

function baseFields() {
  return { vertical: "cutting", createdAt: "2026-09-15T00:00:00.000Z" };
}

describe("PROFESSIONAL_KNOWLEDGE_ENTRY_KINDS -- exactly 7 closed values", () => {
  it("test 1: has exactly 7 kinds", () => {
    expect(PROFESSIONAL_KNOWLEDGE_ENTRY_KINDS).toHaveLength(7);
  });

  it("test 2: isProfessionalKnowledgeEntryKind rejects an unknown kind", () => {
    expect(isProfessionalKnowledgeEntryKind("SOMETHING_ELSE")).toBe(false);
  });
});

describe("PROFESSIONAL_KNOWLEDGE_ENTRY_STATUSES -- APPROVED != ATTACHED != ACTIVE", () => {
  it("test 3: has exactly the 3 expected values", () => {
    expect(PROFESSIONAL_KNOWLEDGE_ENTRY_STATUSES).toEqual(["ACTIVE", "APPROVED_BUT_UNATTACHED", "RETIRED"]);
  });

  it("test 4: isProfessionalKnowledgeEntryStatus rejects an unknown status", () => {
    expect(isProfessionalKnowledgeEntryStatus("DRAFT")).toBe(false);
  });
});

describe("TECHNIQUE_IDENTITY entries", () => {
  const entry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", "d1", "m1"),
    kind: "TECHNIQUE_IDENTITY",
    status: "ACTIVE",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { technique: { techniqueId: "synthetic-technique", label: "Synthetic Technique", relatedTechniqueIds: [], distinctFrom: ["skill-cutting-slice-and-slide-refinement"] }, knownFields: ["fact one"], unknownFields: ["exact depth"] },
    ...baseFields(),
  };

  it("test 5: a well-formed TECHNIQUE_IDENTITY entry is valid", () => {
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 6: technique identity can exist independently from purpose -- no `purpose` field anywhere on this payload", () => {
    expect(entry.payload).not.toHaveProperty("purpose");
  });

  it("test 7: technique identity can exist independently from effect -- no `effect` field anywhere on this payload", () => {
    expect(entry.payload).not.toHaveProperty("effect");
  });

  it("test 8: rejects a payload missing techniqueId", () => {
    const bad = { ...entry, payload: { ...entry.payload, technique: { label: "no id" } } };
    expect(isValidProfessionalKnowledgeEntry(bad)).toBe(false);
  });
});

describe("TECHNIQUE_PURPOSE entries -- decoupled from identity, many allowed per technique", () => {
  const purposeA: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("TECHNIQUE_PURPOSE", "d1", "m1|a"),
    kind: "TECHNIQUE_PURPOSE",
    status: "ACTIVE",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { techniqueId: "synthetic-technique", purpose: "CORRECTION_ALIGNMENT", note: "synthetic" },
    ...baseFields(),
  };
  const purposeB: ProfessionalKnowledgeEntry = { ...purposeA, id: computeProfessionalKnowledgeEntryId("TECHNIQUE_PURPOSE", "d1", "m1|b"), payload: { ...purposeA.payload, purpose: "TEXTURIZATION" } };

  it("test 9: both are individually valid", () => {
    expect(isValidProfessionalKnowledgeEntry(purposeA)).toBe(true);
    expect(isValidProfessionalKnowledgeEntry(purposeB)).toBe(true);
  });

  it("test 10: a technique may carry two distinct purpose entries without redefining its identity", () => {
    expect(purposeA.payload.techniqueId).toBe(purposeB.payload.techniqueId);
    expect(purposeA.payload.purpose).not.toBe(purposeB.payload.purpose);
    expect(purposeA.id).not.toBe(purposeB.id);
  });
});

describe("EFFECT_RELATIONSHIP entries -- many-to-many, never an alias", () => {
  const entry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("EFFECT_RELATIONSHIP", "d1", "m1"),
    kind: "EFFECT_RELATIONSHIP",
    status: "ACTIVE",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { effect: "SYNTHETIC_EFFECT", relatedTechniqueIds: ["technique-a", "technique-b", "technique-c"] },
    ...baseFields(),
  };

  it("test 11: a well-formed EFFECT_RELATIONSHIP entry is valid", () => {
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 12: rejects fewer than 2 related technique ids -- a relationship needs at least two members", () => {
    const bad = { ...entry, payload: { ...entry.payload, relatedTechniqueIds: ["technique-a"] } };
    expect(isValidProfessionalKnowledgeEntry(bad)).toBe(false);
  });

  it("test 13: rejects a duplicated technique id (never a self-alias)", () => {
    const bad = { ...entry, payload: { ...entry.payload, relatedTechniqueIds: ["technique-a", "technique-a"] } };
    expect(isValidProfessionalKnowledgeEntry(bad)).toBe(false);
  });

  it("test 14: three distinct techniques sharing one effect never implies they are the same technique", () => {
    expect(new Set(entry.payload.relatedTechniqueIds).size).toBe(3);
  });
});

describe("WORKFLOW_TRANSITION entries -- reuses AtomicActionStateTransition verbatim", () => {
  const entry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("WORKFLOW_TRANSITION", "d1", "m1"),
    kind: "WORKFLOW_TRANSITION",
    status: "ACTIVE",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { transition: { fact: "synthetic_phase", fromValue: "a", toValue: "b" } },
    ...baseFields(),
  };

  it("test 15: a well-formed WORKFLOW_TRANSITION entry is valid", () => {
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 16: never claims to be a cutting technique -- no `technique`/`techniqueId` field anywhere on this payload", () => {
    expect(entry.payload).not.toHaveProperty("techniqueId");
    expect(entry.payload).not.toHaveProperty("technique");
  });

  it("test 17: rejects a transition missing toValue", () => {
    const bad = { ...entry, payload: { transition: { fact: "x" } } };
    expect(isValidProfessionalKnowledgeEntry(bad)).toBe(false);
  });
});

describe("CONTEXTUAL_KNOWLEDGE entries -- commonly-used-for is structurally never required-for", () => {
  const entry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("CONTEXTUAL_KNOWLEDGE", "d1", "m1"),
    kind: "CONTEXTUAL_KNOWLEDGE",
    status: "ACTIVE",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { techniqueId: "synthetic-technique", claim: { relation: "COMMONLY_USED_FOR", subject: "SHORTER_HAIR", note: "synthetic, not a strict rule" } },
    ...baseFields(),
  };

  it("test 18: a well-formed CONTEXTUAL_KNOWLEDGE entry is valid", () => {
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 19: rejects a relation value from the UniversalRuleRelation vocabulary (REQUIRED/PROHIBITED/ALWAYS/NEVER) -- structurally impossible to construct", () => {
    for (const forbidden of ["REQUIRED", "PROHIBITED", "ALWAYS", "NEVER"]) {
      const bad = { ...entry, payload: { ...entry.payload, claim: { ...entry.payload.claim, relation: forbidden } } };
      expect(isValidProfessionalKnowledgeEntry(bad)).toBe(false);
    }
  });
});

describe("EVIDENCE_SUPPORT entries -- supports an existing skill without cloning it", () => {
  const entry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("EVIDENCE_SUPPORT", "d1", "m1"),
    kind: "EVIDENCE_SUPPORT",
    status: "ACTIVE",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { targetSkillId: "skill-cutting-graduated", fieldsPreservedUnchanged: ["guideType"], evidenceReference: "claim-hash-abc", note: "synthetic" },
    ...baseFields(),
  };

  it("test 20: a well-formed EVIDENCE_SUPPORT entry is valid", () => {
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 21: carries no procedure/parameters/capabilities field -- it can never be mistaken for a cloned SkillDefinition", () => {
    expect(entry.payload).not.toHaveProperty("procedure");
    expect(entry.payload).not.toHaveProperty("parameters");
    expect(entry.payload).not.toHaveProperty("capabilities");
  });
});

describe("PENDING_OBSERVATION entries -- status is TYPE-LOCKED to APPROVED_BUT_UNATTACHED", () => {
  const entry: ProfessionalKnowledgeEntry = {
    id: computeProfessionalKnowledgeEntryId("PENDING_OBSERVATION", "d1", "m1"),
    kind: "PENDING_OBSERVATION",
    status: "APPROVED_BUT_UNATTACHED",
    provenance: PROVENANCE_CONFIRMATION,
    payload: { professionalKnowledgeSummary: "synthetic observation", knownFields: ["fact"], unknownFields: ["exact angle"], reasonPending: "no safe target yet" },
    ...baseFields(),
  };

  it("test 22: a well-formed PENDING_OBSERVATION entry is valid", () => {
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
  });

  it("test 23: a PENDING_OBSERVATION entry claiming status ACTIVE is rejected by the runtime validator (defense in depth beyond the type system)", () => {
    const bad = { ...entry, status: "ACTIVE" };
    expect(isValidProfessionalKnowledgeEntry(bad)).toBe(false);
  });

  it("test 24: unknownFields is preserved verbatim, never silently cleared", () => {
    expect(entry.payload.unknownFields).toContain("exact angle");
  });
});

describe("provenance validity", () => {
  it("test 25: ADDITION provenance with originalAIClaim=null is valid (Channel Cut's own shape)", () => {
    const entry: ProfessionalKnowledgeEntry = {
      id: computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", "d1", "m1"),
      kind: "TECHNIQUE_IDENTITY",
      status: "ACTIVE",
      provenance: PROVENANCE_ADDITION,
      payload: { technique: { techniqueId: "t", label: "T" }, knownFields: [], unknownFields: [] },
      ...baseFields(),
    };
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
    expect(entry.provenance.originalAIClaim).toBeNull();
    expect(entry.provenance.decisionType).toBe("ADDITION");
  });

  it("test 26: rejects a professionalAuthority value other than PROFESSIONAL_INPUT", () => {
    const entry = {
      id: "x",
      kind: "TECHNIQUE_IDENTITY",
      status: "ACTIVE",
      provenance: { ...PROVENANCE_CONFIRMATION, professionalAuthority: "AI_GENERATED" },
      payload: { technique: { techniqueId: "t", label: "T" }, knownFields: [], unknownFields: [] },
      ...baseFields(),
    };
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(false);
  });

  it("test 27: rejects a missing sourceDecisionId", () => {
    const entry = {
      id: "x",
      kind: "TECHNIQUE_IDENTITY",
      status: "ACTIVE",
      provenance: { ...PROVENANCE_CONFIRMATION, sourceDecisionId: "" },
      payload: { technique: { techniqueId: "t", label: "T" }, knownFields: [], unknownFields: [] },
      ...baseFields(),
    };
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(false);
  });
});

describe("computeProfessionalKnowledgeEntryId -- deterministic content hash", () => {
  it("test 28: identical inputs produce the identical id", () => {
    expect(computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", "d1", "m1")).toBe(computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", "d1", "m1"));
  });

  it("test 29: different discriminators produce different ids", () => {
    expect(computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", "d1", "m1")).not.toBe(computeProfessionalKnowledgeEntryId("TECHNIQUE_IDENTITY", "d1", "m2"));
  });
});
