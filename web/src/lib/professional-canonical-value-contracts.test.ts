import { describe, expect, it } from "vitest";
import { LEGACY_MAPPING_CORRESPONDENCES, LEGACY_TOKEN_STATUSES, isLegacyMappingCorrespondence, isLegacyTokenStatus } from "./professional-concept-contracts";
import { canonicalValueDigest, isLegacyCorrespondenceEntry, isProfessionalCanonicalValue } from "./professional-canonical-value-contracts";
import { CUTTING_PROFESSIONAL_CONCEPT_PACK as pack } from "./professional-concept-cutting-pack";

describe("O1 independent legacy axes", () => {
  it("locks the two independent member sets", () => {
    expect(LEGACY_TOKEN_STATUSES).toEqual(["CANONICAL", "LEGACY_ALIAS", "DEPRECATED", "AMBIGUOUS", "NEEDS_SPLIT"]);
    expect(LEGACY_MAPPING_CORRESPONDENCES).toEqual(["EXACT", "PARTIAL", "AMBIGUOUS_CORRESPONDENCE", "MIXED", "NO_MAPPING"]);
    for (const status of LEGACY_TOKEN_STATUSES) { expect(isLegacyTokenStatus(status)).toBe(true); expect(isLegacyMappingCorrespondence(status)).toBe(false); }
    for (const correspondence of LEGACY_MAPPING_CORRESPONDENCES) { expect(isLegacyMappingCorrespondence(correspondence)).toBe(true); expect(isLegacyTokenStatus(correspondence)).toBe(false); }
    for (const invalid of ["UNKNOWN", null, {}, 1]) { expect(isLegacyTokenStatus(invalid)).toBe(false); expect(isLegacyMappingCorrespondence(invalid)).toBe(false); }
  });
  it("represents stationary/traveling as AMBIGUOUS plus PARTIAL, never as PARTIAL status", () => {
    for (const [token, targetValue] of [["stationary", "STATIONARY"], ["traveling", "TRAVELLING"]]) {
      const value = pack.canonicalValues.find(v => v.valueToken === token)!;
      expect(value.status).toBe("AMBIGUOUS");
      expect(value.legacyMappingCorrespondence).toEqual([{ targetModelRef: "GuideRelationshipCapability", targetDimension: "GuideBehavior", targetValue, correspondence: "PARTIAL" }]);
      expect(isProfessionalCanonicalValue({ ...value, status: "PARTIAL" })).toBe(false);
    }
  });
  it("validates correspondence independently, including honest absent targets", () => {
    expect(pack.canonicalValues.every(isProfessionalCanonicalValue)).toBe(true);
    expect(isLegacyCorrespondenceEntry({ targetModelRef: "test", targetDimension: "test", correspondence: "NO_MAPPING" })).toBe(true);
    expect(isLegacyCorrespondenceEntry({ targetModelRef: "test", targetDimension: "test", correspondence: "NO_MAPPING", targetValue: "invented" })).toBe(false);
    expect(isLegacyCorrespondenceEntry({ targetModelRef: "test", targetDimension: "test", correspondence: "AMBIGUOUS" })).toBe(false);
  });
  it("hashes both axes, never translations or version labels", () => {
    const value = pack.canonicalValues.find(v => v.valueToken === "stationary")!;
    expect(canonicalValueDigest({ ...value, localizedLabels: { ro: "format only" }, semanticVersion: "2.0.0" })).toBe(value.semanticDigest);
    expect(canonicalValueDigest({ ...value, status: "NEEDS_SPLIT" })).not.toBe(value.semanticDigest);
    expect(canonicalValueDigest({ ...value, legacyMappingCorrespondence: value.legacyMappingCorrespondence!.map(m => ({ ...m, correspondence: "EXACT" })) })).not.toBe(value.semanticDigest);
    expect(isProfessionalCanonicalValue({ ...value, ownerUserId: "private" })).toBe(false);
  });
});
