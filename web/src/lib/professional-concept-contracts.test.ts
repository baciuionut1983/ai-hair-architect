import { describe, expect, it } from "vitest";
import * as c from "./professional-concept-contracts";
import { CUTTING_PROFESSIONAL_CONCEPT_PACK as pack } from "./professional-concept-cutting-pack";

describe("O1 structural contracts", () => {
  it("locks the architecture vocabularies", () => {
    expect(c.PROFESSIONAL_SCOPES).toEqual(["TECHNIQUE_GLOBAL", "HEAD_REGION", "SECTION", "SUBSECTION", "STRAND", "ACTION", "PHASE", "OBSERVATION_WINDOW"]);
    expect(c.EXECUTABILITY_ROLES).toEqual(["DESCRIPTIVE", "STATE", "PARAMETER", "CONSTRAINT", "ACTION", "CONTROL_FLOW", "EFFECT", "CONTEXT"]);
    expect(c.OBSERVABILITY_CLASSES).toEqual(["DIRECTLY_OBSERVABLE", "PARTIALLY_OBSERVABLE", "VOICE_OR_TEXT_EXPLAINABLE", "PROFESSIONAL_INTERPRETATION_REQUIRED", "NOT_RELIABLY_VISUAL"]);
    expect(c.OBSERVABILITY_CHANNELS).toEqual(["VISUAL", "AUDIO", "BOTH", "TEXT"]);
    expect(c.PROFESSIONAL_RELATIONSHIP_KINDS).toEqual(["PART_OF", "CONTAINS", "APPLIES_TO", "PRECEDES", "FOLLOWS", "CONSTRAINS", "REQUIRES", "MODIFIES", "PRODUCES_EFFECT", "USES_GUIDE", "USES_TOOL", "OBSERVED_AS", "EXECUTED_BY", "INCOMPATIBLE_WITH", "NOT_EQUIVALENT"]);
  });
  it.each(c.PROFESSIONAL_SCOPES)("accepts scope %s", scope => expect(c.isProfessionalScope(scope)).toBe(true));
  it.each([null, "GLOBAL", "local", {}, 1])("rejects unknown scope %j", scope => expect(c.isProfessionalScope(scope)).toBe(false));
  it("keeps observability axes independent and roles multi-valued", () => {
    for (const observabilityClass of c.OBSERVABILITY_CLASSES) for (const channel of c.OBSERVABILITY_CHANNELS) {
      expect(c.isProfessionalObservability({ observabilityClass, typicalChannels: [channel] })).toBe(true);
    }
    expect(c.isProfessionalObservability({ observabilityClass: "VISUAL", typicalChannels: ["DIRECTLY_OBSERVABLE"] })).toBe(false);
    expect(c.isProfessionalObservability({ observabilityClass: "DIRECTLY_OBSERVABLE", typicalChannels: [] })).toBe(false);
    expect(c.isExecutionRoles(["PARAMETER", "CONTROL_FLOW"])).toBe(true);
    for (const roles of [[], ["PARAMETER", "PARAMETER"], ["STRUCTURAL_RELATIONSHIP"], "PARAMETER"]) expect(c.isExecutionRoles(roles)).toBe(false);
  });
  it.each(["1", "v1.0.0", "01.0.0", "1.0", "1.0.0-", "", null])("rejects invalid version %j", version => expect(c.isSemanticVersion(version)).toBe(false));
  it("uses the governed sorted-key hashing behavior; array order remains semantic", () => {
    expect(c.semanticFingerprint({ a: 1, b: 2 })).toBe(c.semanticFingerprint({ b: 2, a: 1, missing: undefined }));
    expect(c.semanticFingerprint({ a: [1, 2] })).not.toBe(c.semanticFingerprint({ a: [2, 1] }));
  });
  it("excludes version labels and unknown presentation fields from concept digests", () => {
    const concept = pack.concepts[0];
    expect(c.conceptDigest({ ...concept, specificationVersion: "2.0.0" })).toBe(concept.specificationDigest);
    expect(c.conceptDigest(Object.assign({}, concept, { localizedLabels: { ro: "test" }, uiOrder: 99, presentationDetail: "format" }))).toBe(concept.specificationDigest);
    for (const change of [{ conceptId: "test.changed" }, { vertical: "test" }, { discipline: "test" }, { canonicalName: "test" }, { conceptType: ["STATE"] as const }, { scope: "ACTION" as const }, { status: "NEEDS_SPLIT" as const }, { relationships: [{ kind: "NOT_EQUIVALENT" as const, targetConceptId: "haircutting.cuttingAngle" }] }, { observability: { observabilityClass: "DIRECTLY_OBSERVABLE" as const, typicalChannels: ["VISUAL"] as const } }]) {
      expect(c.conceptDigest({ ...concept, ...change })).not.toBe(concept.specificationDigest);
    }
  });
  it("rejects private authority and malformed contract additions", () => {
    expect(pack.concepts.every(c.isProfessionalConcept)).toBe(true);
    for (const extra of [{ ownerUserId: "private" }, { professionalDecision: "CONFIRMED" }, { executionRole: "PARAMETER" }, { domain: "hair" }]) expect(c.isProfessionalConcept({ ...pack.concepts[0], ...extra })).toBe(false);
    expect(c.isProfessionalConcept({ ...pack.concepts[0], appliesTo: ["INVENTED_ZONE"] })).toBe(false);
    expect(c.isProfessionalConcept({ ...pack.concepts[0], canonicalName: "Elevație" })).toBe(false);
  });
});
