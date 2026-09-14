import { describe, expect, it } from "vitest";

import {
  isProfessionalLearningReviewStatus,
  isValidApprovalDetail,
  isValidApprovedResultHash,
  type ProfessionalLearningReviewApprovalDetail,
} from "@/lib/professional-learning-review-validators";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5.R2 -- pure
// validator tests, no I/O. Mirrors professional-learning-draft-validators.test.ts's
// own convention.

function validDetail(): ProfessionalLearningReviewApprovalDetail {
  return {
    provenance: "PROFESSIONAL_INPUT",
    confirmedThemes: ["progressive_elevation", "stationary_guide"],
    reviewerNote: "Confirmed accurate against the source video.",
    fieldsChanged: false,
    unknownsRemoved: false,
    registryMutated: false,
    skillsCreated: false,
    falseStatementsFound: false,
  };
}

describe("professional-learning-review-validators", () => {
  it("accepts the only defined status", () => {
    expect(isProfessionalLearningReviewStatus("PROFESSIONALLY_VALIDATED")).toBe(true);
    expect(isProfessionalLearningReviewStatus("APPROVED")).toBe(false);
    expect(isProfessionalLearningReviewStatus(123)).toBe(false);
  });

  it("accepts a well-formed approval detail", () => {
    expect(isValidApprovalDetail(validDetail())).toBe(true);
  });

  it("rejects a detail with zero confirmed themes", () => {
    expect(isValidApprovalDetail({ ...validDetail(), confirmedThemes: [] })).toBe(false);
  });

  it("rejects a non-PROFESSIONAL_INPUT provenance (fail-closed, cannot smuggle a different provenance)", () => {
    expect(isValidApprovalDetail({ ...validDetail(), provenance: "OBSERVED" })).toBe(false);
  });

  it("rejects any of the negative assertions flipped to true (this approval must never claim it changed something)", () => {
    expect(isValidApprovalDetail({ ...validDetail(), fieldsChanged: true })).toBe(false);
    expect(isValidApprovalDetail({ ...validDetail(), unknownsRemoved: true })).toBe(false);
    expect(isValidApprovalDetail({ ...validDetail(), registryMutated: true })).toBe(false);
    expect(isValidApprovalDetail({ ...validDetail(), skillsCreated: true })).toBe(false);
    expect(isValidApprovalDetail({ ...validDetail(), falseStatementsFound: true })).toBe(false);
  });

  it("rejects an empty reviewer note", () => {
    expect(isValidApprovalDetail({ ...validDetail(), reviewerNote: "" })).toBe(false);
  });

  it("rejects a malformed value (not an object, an array, a confirmedThemes entry that is not a string)", () => {
    expect(isValidApprovalDetail(null)).toBe(false);
    expect(isValidApprovalDetail([])).toBe(false);
    expect(isValidApprovalDetail({ ...validDetail(), confirmedThemes: [1, 2] })).toBe(false);
  });

  it("validates a 64-hex-char sha256 hash and rejects anything else", () => {
    expect(isValidApprovedResultHash("a".repeat(64))).toBe(true);
    expect(isValidApprovedResultHash("A".repeat(64))).toBe(false); // lowercase only, matching every other content hash in this codebase
    expect(isValidApprovedResultHash("a".repeat(63))).toBe(false);
    expect(isValidApprovedResultHash(123)).toBe(false);
  });
});
