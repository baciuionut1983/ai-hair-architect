import { describe, expect, it } from "vitest";

import { buildGuideRelationshipCapability, computeGuideRelationshipCapabilityId, deriveGuideStateTransition, GUIDE_BEHAVIORS, GUIDE_ROLES, GUIDE_SOURCES } from "@/lib/professional-skill-guide-relationship-contracts";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R3.3 -- pure
// tests for the guide-relationship capability model, no I/O, no
// database, no AI calls.

describe("professional-skill-guide-relationship-contracts", () => {
  it("test 1: stationary and travelling/mobile guide are structurally distinct capability instances", () => {
    const stationary = buildGuideRelationshipCapability({ guideBehavior: "STATIONARY" });
    const travelling = buildGuideRelationshipCapability({ guideBehavior: "TRAVELLING" });
    expect(stationary.id).not.toBe(travelling.id);
    expect(stationary.guideBehavior).toBe("STATIONARY");
    expect(travelling.guideBehavior).toBe("TRAVELLING");
  });

  it("test 2: a PREVIOUSLY_CUT_SECTION source does not automatically imply TRAVELLING behavior -- behavior defaults to UNKNOWN unless separately established", () => {
    const capability = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION" });
    expect(capability.guideBehavior).toBe("UNKNOWN");
  });

  it("test 3: a travelling guide can express an explicit state transition from section N to section N+1", () => {
    const transition = deriveGuideStateTransition("TRAVELLING", "section-N", "section-N+1");
    expect(transition).toEqual({ fact: "activeGuide", fromValue: "section-N", toValue: "section-N+1" });
  });

  it("test 4: a stationary guide produces NO state transition -- the active guide never changes", () => {
    const transition = deriveGuideStateTransition("STATIONARY", "initialGuide", "initialGuide");
    expect(transition).toBeNull();
  });

  it("test 5: overdirection-toward-guide can be represented with zero numeric angle -- unknownNumericFields names the gap explicitly", () => {
    const capability = buildGuideRelationshipCapability({ overdirectionRelationship: "TOWARD_GUIDE", unknownNumericFields: ["exactOverdirectionAngle"] });
    expect(capability.overdirectionRelationship).toBe("TOWARD_GUIDE");
    expect(capability.unknownNumericFields).toContain("exactOverdirectionAngle");
    for (const field of capability.unknownNumericFields) expect(field).not.toMatch(/\d/);
  });

  it("test 6: a stationary guide does not automatically imply an overdirection relationship -- stays UNKNOWN unless separately set", () => {
    const capability = buildGuideRelationshipCapability({ guideBehavior: "STATIONARY" });
    expect(capability.overdirectionRelationship).toBe("UNKNOWN");
  });

  it("test 7/8: mobile guide and progressive elevation are independent -- this model carries no elevation field at all, so neither can imply the other by construction", () => {
    const capability = buildGuideRelationshipCapability({ guideBehavior: "TRAVELLING" });
    expect(Object.keys(capability)).not.toContain("elevation");
    expect(Object.keys(capability)).not.toContain("elevationProgression");
  });

  it("test 9: diagonal sectioning is not representable in (and therefore cannot imply anything about) this model -- sectioning is deliberately out of scope", () => {
    const capability = buildGuideRelationshipCapability({ guideBehavior: "STATIONARY" });
    expect(Object.keys(capability)).not.toContain("sectioning");
  });

  it("test 10: guide source and guide behavior are independently settable and do not constrain each other", () => {
    const a = buildGuideRelationshipCapability({ guideSource: "PERIMETER_CONTOUR_GUIDE", guideBehavior: "TRAVELLING" });
    const b = buildGuideRelationshipCapability({ guideSource: "PERIMETER_CONTOUR_GUIDE", guideBehavior: "STATIONARY" });
    expect(a.guideSource).toBe(b.guideSource);
    expect(a.guideBehavior).not.toBe(b.guideBehavior);
  });

  it("test 11: perimeter/contour guide (STRUCTURAL_AUTHORITY) and progressive graduation guide (CONTINUATION_GUIDE) are distinct guide roles", () => {
    const contour = buildGuideRelationshipCapability({ guideSource: "PERIMETER_CONTOUR_GUIDE", guideRole: "STRUCTURAL_AUTHORITY", guideBehavior: "STATIONARY" });
    const graduation = buildGuideRelationshipCapability({ guideSource: "PREVIOUSLY_CUT_SECTION", guideRole: "CONTINUATION_GUIDE", guideBehavior: "TRAVELLING" });
    expect(contour.guideRole).toBe("STRUCTURAL_AUTHORITY");
    expect(graduation.guideRole).toBe("CONTINUATION_GUIDE");
    expect(contour.id).not.toBe(graduation.id);
  });

  it("test 12: exact numeric geometry remains UNKNOWN by default -- unknownNumericFields is empty only when the caller never names a gap, never auto-filled with a guess", () => {
    const capability = buildGuideRelationshipCapability();
    expect(capability.unknownNumericFields).toEqual([]);
    expect(capability.guideSource).toBe("UNKNOWN");
    expect(capability.guideBehavior).toBe("UNKNOWN");
  });

  it("every declared vocabulary value round-trips through the builder without collision", () => {
    for (const source of GUIDE_SOURCES) {
      for (const behavior of GUIDE_BEHAVIORS) {
        for (const role of GUIDE_ROLES) {
          const capability = buildGuideRelationshipCapability({ guideSource: source, guideBehavior: behavior, guideRole: role });
          expect(capability.guideSource).toBe(source);
          expect(capability.guideBehavior).toBe(behavior);
          expect(capability.guideRole).toBe(role);
        }
      }
    }
  });

  it("determinism: identical inputs produce identical ids; a changed dimension changes the id", () => {
    const a = computeGuideRelationshipCapabilityId({ guideSource: "PREVIOUSLY_CUT_SECTION", guideRole: "CONTINUATION_GUIDE", guideBehavior: "TRAVELLING", currentSectionRelationship: "BECOMES_NEXT_GUIDE", overdirectionRelationship: "UNKNOWN", progression: "PROGRESSES_EACH_UNIT", unknownNumericFields: [] });
    const b = computeGuideRelationshipCapabilityId({ guideSource: "PREVIOUSLY_CUT_SECTION", guideRole: "CONTINUATION_GUIDE", guideBehavior: "TRAVELLING", currentSectionRelationship: "BECOMES_NEXT_GUIDE", overdirectionRelationship: "UNKNOWN", progression: "PROGRESSES_EACH_UNIT", unknownNumericFields: [] });
    const c = computeGuideRelationshipCapabilityId({ guideSource: "PREVIOUSLY_CUT_SECTION", guideRole: "CONTINUATION_GUIDE", guideBehavior: "STATIONARY", currentSectionRelationship: "BECOMES_NEXT_GUIDE", overdirectionRelationship: "UNKNOWN", progression: "PROGRESSES_EACH_UNIT", unknownNumericFields: [] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
