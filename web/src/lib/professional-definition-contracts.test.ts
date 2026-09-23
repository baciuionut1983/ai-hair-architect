import { describe, expect, it } from "vitest";
import { PROFESSIONAL_CONCEPT_SPEC_VERSION, PROFESSIONAL_VALIDATION_REQUIRED } from "./professional-concept-contracts";
import { definitionDigest, isProfessionalDefinition, type ProfessionalDefinition } from "./professional-definition-contracts";
import { CUTTING_PROFESSIONAL_CONCEPT_PACK } from "./professional-concept-cutting-pack";

describe("O1 future definition shape", () => {
  const seed: Omit<ProfessionalDefinition, "specificationDigest"> = { definitionId: "test.fixture", conceptId: "haircutting.elevation", text: PROFESSIONAL_VALIDATION_REQUIRED, scope: PROFESSIONAL_VALIDATION_REQUIRED, provenance: { sourceId: "test-only", authorityType: "test-only", reviewedAt: "2026-01-01T00:00:00Z" }, specificationVersion: PROFESSIONAL_CONCEPT_SPEC_VERSION };
  const fixture = { ...seed, specificationDigest: definitionDigest(seed) };
  it("ships no definitions, validates placeholder test fixtures without creating authority", () => {
    expect(CUTTING_PROFESSIONAL_CONCEPT_PACK.definitions).toEqual([]);
    expect(isProfessionalDefinition(fixture)).toBe(true);
    for (const change of [{ provenance: {} }, { ownerUserId: "private" }, { text: "" }, { scope: "GLOBAL" }, { distinguishFrom: ["bad"] }]) expect(isProfessionalDefinition({ ...fixture, ...change })).toBe(false);
  });
  it("includes definition content, scope, source language and authority kind", () => {
    for (const change of [{ text: "test fixture only" }, { scope: "ACTION" as const }, { sourceLanguage: "ro" }, { sourceTerm: "test" }, { distinguishFrom: ["haircutting.cuttingAngle"] }, { provenance: { ...fixture.provenance, authorityType: "changed test authority" } }]) expect(definitionDigest({ ...fixture, ...change })).not.toBe(fixture.specificationDigest);
  });
  it("excludes definition ID, translation, reviewed timestamp and version labels", () => {
    expect(definitionDigest({ ...fixture, definitionId: "test.other", specificationVersion: "2.0.0", localizedLabels: { ro: "test" }, provenance: { ...fixture.provenance, reviewedAt: "2026-02-01T00:00:00Z" } })).toBe(fixture.specificationDigest);
  });
});
