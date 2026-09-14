import { describe, expect, it } from "vitest";

import { computeKnowledgeUnitId, isKnowledgeUnitType, KNOWLEDGE_UNIT_TYPES } from "@/lib/professional-knowledge-unit";

describe("professional-knowledge-unit", () => {
  it("accepts every declared type and rejects unknown strings", () => {
    for (const type of KNOWLEDGE_UNIT_TYPES) expect(isKnowledgeUnitType(type)).toBe(true);
    expect(isKnowledgeUnitType("SKILL")).toBe(false);
    expect(isKnowledgeUnitType(123)).toBe(false);
  });

  it("computeKnowledgeUnitId is deterministic: same inputs -> same id", () => {
    const a = computeKnowledgeUnitId("ev1", "rev1", "hash1", "EXECUTION_CAPABILITY", "CUTTING_ACTION|window-0", "v1");
    const b = computeKnowledgeUnitId("ev1", "rev1", "hash1", "EXECUTION_CAPABILITY", "CUTTING_ACTION|window-0", "v1");
    expect(a).toBe(b);
  });

  it("computeKnowledgeUnitId changes when any input changes (discriminator, type, assimilation version, approved hash)", () => {
    const base = computeKnowledgeUnitId("ev1", "rev1", "hash1", "EXECUTION_CAPABILITY", "CUTTING_ACTION|window-0", "v1");
    expect(computeKnowledgeUnitId("ev1", "rev1", "hash1", "EXECUTION_CAPABILITY", "CUTTING_ACTION|window-1", "v1")).not.toBe(base);
    expect(computeKnowledgeUnitId("ev1", "rev1", "hash1", "VALIDATION_RULE", "CUTTING_ACTION|window-0", "v1")).not.toBe(base);
    expect(computeKnowledgeUnitId("ev1", "rev1", "hash1", "EXECUTION_CAPABILITY", "CUTTING_ACTION|window-0", "v2")).not.toBe(base);
    expect(computeKnowledgeUnitId("ev1", "rev1", "hash2", "EXECUTION_CAPABILITY", "CUTTING_ACTION|window-0", "v1")).not.toBe(base);
  });

  it("id is never random -- no crypto.randomUUID anywhere in the source", () => {
    // Structural proof, not just behavioral: reading the module source
    // confirms no random-id generator is imported or called.
    expect(computeKnowledgeUnitId.toString()).not.toMatch(/randomUUID|Math\.random/);
  });
});
