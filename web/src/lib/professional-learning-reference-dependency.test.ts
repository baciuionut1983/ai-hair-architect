import { describe, expect, it } from "vitest";

import {
  createReferenceDependencyRelationship,
  isReferenceDependencyEstablished,
  isValidReferenceDependencyRelationship,
  summarizeReferenceLifecycle,
  type ReferenceDependencyRelationshipInput,
  type ReferenceEntityRef,
} from "./professional-learning-reference-dependency";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R1.1 --
// Section 27 acceptance fixtures A-J. Domain-general by construction:
// entity refs below use hair-cutting example text only as illustrative
// labels (Section 23 -- prove the model is not haircut-name-specific),
// never as part of the TYPE system itself.

const strandA: ReferenceEntityRef = { ref: "strand-A", kind: "PROFESSIONAL_STATEMENT", label: "guide strand" };
const strandB: ReferenceEntityRef = { ref: "strand-B", kind: "PROFESSIONAL_STATEMENT", label: "next strand" };

describe("professional-learning-reference-dependency (Stage 8.5L5.R1.1)", () => {
  it("Section 27.A positive -- professional input explicitly establishes a guide relationship", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
      note: "The next strand is cut to the established guide.",
    });
    expect(relationship.established).toBe(true);
    expect(relationship.professionalAuthority).toBe(true);
    expect(isValidReferenceDependencyRelationship(relationship)).toBe(true);
  });

  it("Section 27.B negative -- temporal adjacency alone never establishes a reference relationship", () => {
    // A caller that only knows "A happened, then B happened" has no
    // semantic support to offer -- omitting semanticSupport (or setting
    // it false) is the honest representation of that ignorance.
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "OBSERVED",
      temporalSupport: true,
    });
    expect(relationship.established).toBe(false);
  });

  it("Section 27.C negative -- matching visible length alone never establishes a guide relationship", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "USES_REFERENCE",
      provenance: "OBSERVED",
      note: "Both strands end at a visually similar length.",
      // No semanticSupport asserted -- a visual length match is not, on
      // its own, professional semantic grounding for a dependency claim.
    });
    expect(relationship.established).toBe(false);
  });

  it("Section 27.D negative -- combing alone never establishes a guide", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: { ref: "combing-action", kind: "ACTION" },
      targetEntity: strandB,
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "OBSERVED",
      note: "Hair is combed downward.",
    });
    expect(relationship.established).toBe(false);
  });

  it("Section 27.E negative -- a previously cut strand existing is not automatically a guide", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: { ref: "previous-cut-strand", kind: "ACTION" },
      targetEntity: strandB,
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "INFERRED",
      note: "A strand was visibly cut earlier in the sequence.",
    });
    expect(relationship.established).toBe(false);
  });

  it("Section 27.F positive -- continuation guide explicitly stated by professional input", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: { ref: "strand-C", kind: "PROFESSIONAL_STATEMENT", label: "next section" },
      relationshipType: "CONTINUES_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
      referenceRole: "CONTINUATION_GUIDE",
      note: "The previously cut strand becomes the reference for the next section.",
    });
    expect(relationship.established).toBe(true);
    expect(relationship.referenceRole).toBe("CONTINUATION_GUIDE");
  });

  it("Section 27.G -- structural authority and continuation guide remain two distinct concepts, never collapsed", () => {
    const structuralAuthority = createReferenceDependencyRelationship({
      sourceEntity: { ref: "final-perimeter", kind: "PROFESSIONAL_STATEMENT", label: "intended final length/perimeter" },
      targetEntity: strandA,
      relationshipType: "ESTABLISHES_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
      referenceRole: "STRUCTURAL_AUTHORITY",
    });
    const continuationGuide = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
      referenceRole: "CONTINUATION_GUIDE",
    });
    expect(structuralAuthority.referenceRole).toBe("STRUCTURAL_AUTHORITY");
    expect(continuationGuide.referenceRole).toBe("CONTINUATION_GUIDE");
    expect(structuralAuthority.referenceRole).not.toBe(continuationGuide.referenceRole);
  });

  it("Section 27.H -- a reference-like relationship with insufficient authority remains UNKNOWN role, not established", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "REFERENCE_ROLE_UNKNOWN",
      provenance: "INFERRED",
      note: "Something reference-like appears related, but authority is not established.",
    });
    expect(relationship.established).toBe(false);
    expect(relationship.relationshipType).toBe("REFERENCE_ROLE_UNKNOWN");
  });

  it("Section 27.I -- a successfully used guide never implies zone/procedure completion (that remains L5's own job)", () => {
    // This module has no completion field at all -- structurally
    // incapable of asserting it. A guide relationship being `established`
    // says nothing about whether a zone or procedure is complete; that
    // question belongs entirely to professional-learning-video-temporal-
    // reasoning.ts's assessZoneCompletion, untouched by this file.
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "CUTS_TO_REFERENCE",
      provenance: "PROFESSIONAL_INPUT",
    });
    expect((relationship as unknown as Record<string, unknown>).completion).toBeUndefined();
    expect((relationship as unknown as Record<string, unknown>).zoneComplete).toBeUndefined();
  });

  it("Section 27.J -- 'A before B' alone never establishes that B depends on A (no causality overreach)", () => {
    const relationship = createReferenceDependencyRelationship({
      sourceEntity: strandA,
      targetEntity: strandB,
      relationshipType: "USES_REFERENCE",
      provenance: "OBSERVED",
      temporalSupport: true, // A is known to precede B
      // semanticSupport intentionally omitted: temporal precedence alone
      // is not dependency.
    });
    expect(relationship.established).toBe(false);
  });

  describe("isReferenceDependencyEstablished -- the core safety gate", () => {
    it("PROFESSIONAL_INPUT is always established, regardless of semanticSupport", () => {
      expect(isReferenceDependencyEstablished({ provenance: "PROFESSIONAL_INPUT", semanticSupport: false })).toBe(true);
      expect(isReferenceDependencyEstablished({ provenance: "PROFESSIONAL_INPUT" })).toBe(true);
    });

    it("UNKNOWN is never established", () => {
      expect(isReferenceDependencyEstablished({ provenance: "UNKNOWN", semanticSupport: true })).toBe(false);
    });

    it("OBSERVED/INFERRED require explicit semanticSupport: true -- never inferred by this function itself", () => {
      expect(isReferenceDependencyEstablished({ provenance: "OBSERVED" })).toBe(false);
      expect(isReferenceDependencyEstablished({ provenance: "OBSERVED", semanticSupport: true })).toBe(true);
      expect(isReferenceDependencyEstablished({ provenance: "INFERRED", semanticSupport: true })).toBe(true);
    });
  });

  describe("identity / idempotency", () => {
    it("identical relationship inputs produce identical ids", () => {
      const input: ReferenceDependencyRelationshipInput = { sourceEntity: strandA, targetEntity: strandB, relationshipType: "CUTS_TO_REFERENCE", provenance: "PROFESSIONAL_INPUT" };
      const a = createReferenceDependencyRelationship(input);
      const b = createReferenceDependencyRelationship(input);
      expect(a.id).toBe(b.id);
    });

    it("a different relationship type or provenance produces a different id", () => {
      const base = createReferenceDependencyRelationship({ sourceEntity: strandA, targetEntity: strandB, relationshipType: "CUTS_TO_REFERENCE", provenance: "PROFESSIONAL_INPUT" });
      const differentType = createReferenceDependencyRelationship({ sourceEntity: strandA, targetEntity: strandB, relationshipType: "USES_REFERENCE", provenance: "PROFESSIONAL_INPUT" });
      expect(differentType.id).not.toBe(base.id);
    });
  });

  describe("isValidReferenceDependencyRelationship", () => {
    it("rejects an invalid relationship type, entity shape, or provenance", () => {
      const valid = createReferenceDependencyRelationship({ sourceEntity: strandA, targetEntity: strandB, relationshipType: "CUTS_TO_REFERENCE", provenance: "PROFESSIONAL_INPUT" });
      expect(isValidReferenceDependencyRelationship({ ...valid, relationshipType: "INVENTED_TYPE" })).toBe(false);
      expect(isValidReferenceDependencyRelationship({ ...valid, sourceEntity: { ref: "", kind: "ACTION" } })).toBe(false);
      expect(isValidReferenceDependencyRelationship({ ...valid, provenance: "MADE_UP" })).toBe(false);
      expect(isValidReferenceDependencyRelationship(null)).toBe(false);
    });
  });

  describe("summarizeReferenceLifecycle (Section 9) -- reporting-only, never fabricates", () => {
    it("reports only established relationships, missing stages as NOT_OBSERVED", () => {
      const established = createReferenceDependencyRelationship({ sourceEntity: strandA, targetEntity: strandB, relationshipType: "ESTABLISHES_REFERENCE", provenance: "PROFESSIONAL_INPUT" });
      const notEstablished = createReferenceDependencyRelationship({ sourceEntity: strandB, targetEntity: strandA, relationshipType: "CONTINUES_REFERENCE", provenance: "OBSERVED" });

      const summary = summarizeReferenceLifecycle({ relationships: [established, notEstablished], nextMaterialPresentedObserved: true, resultProducedObserved: false });

      expect(summary.REFERENCE_ESTABLISHED).toBe("OBSERVED");
      expect(summary.NEXT_MATERIAL_PRESENTED).toBe("OBSERVED");
      expect(summary.RESULT_PRODUCED).toBe("NOT_OBSERVED");
      // notEstablished relationship (OBSERVED, no semanticSupport) never
      // counts toward CONTINUES_REFERENCE even though its type matches --
      // only `established` relationships are counted.
      expect(summary.RESULT_MAY_BECOME_CONTINUATION_REFERENCE).toBe("NOT_OBSERVED");
    });

    it("has no NEXT_ITERATION stage -- never claims a second iteration is demonstrated", () => {
      const summary = summarizeReferenceLifecycle({ relationships: [], nextMaterialPresentedObserved: false, resultProducedObserved: false });
      expect((summary as unknown as Record<string, unknown>).NEXT_ITERATION).toBeUndefined();
    });
  });
});
