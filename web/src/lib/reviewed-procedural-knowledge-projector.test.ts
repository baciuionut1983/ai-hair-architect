import { describe, expect, it } from "vitest";
import { isValidProfessionalKnowledgeEntry, type ProfessionalKnowledgeEntry } from "@/lib/professional-knowledge-entry-contracts";
import { projectReviewedProceduralKnowledge, type ReviewedProceduralProjectionInput } from "@/lib/reviewed-procedural-knowledge-projector";
import type { ProceduralClaimReviewEntry } from "@/lib/professional-learning-procedural-review-validators";
import { buildActiveProfessionalKnowledgeRegistry, computeProfessionalKnowledgeRegistryFingerprint, summarizeProfessionalKnowledgeSnapshot } from "@/lib/professional-knowledge-registry";

function review(patch: Partial<ProceduralClaimReviewEntry> = {}): ProceduralClaimReviewEntry {
  return { claimId: "COMBING", claimType: "PROCEDURAL_PATTERN", decision: "PROFESSIONALLY_CONFIRMED", originalValue: { kind: "COMBING", occurrenceCount: 2 }, originalProvenance: "INFERRED", reviewedByUserId: "owner-a", reviewedAt: "2026-09-19T12:00:00.000Z", ...patch };
}
function input(claim = review()): ReviewedProceduralProjectionInput {
  return {
    ownerUserId: "owner-a", draftId: "draft", sourceEvidenceId: "evidence", videoAssetId: "video", vertical: "hair_cutting", extractorVersion: "test-v1", proceduralReviewRevision: 1,
    proceduralReview: { claims: { COMBING: claim } },
    temporalEvidence: { observations: [], actions: [
      { timeStartSeconds: 0, timeEndSeconds: 2, kind: "COMBING", source: "INFERRED" },
      { timeStartSeconds: 3, timeEndSeconds: 5, kind: "COMBING", source: "INFERRED" },
      { timeStartSeconds: 6, timeEndSeconds: 8, kind: "CUTTING_ACTION", source: "INFERRED" },
    ], editGaps: [], sourceDurationSeconds: 10 },
  };
}
function freeze(value: unknown) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}

describe("T1.5 pure reviewed procedural knowledge projection", () => {
  it("CONFIRMED produces exactly one canonical, inert, narrowly scoped claim", () => {
    const projected = projectReviewedProceduralKnowledge(input())!;
    expect(projected.entries).toHaveLength(1);
    const entry: ProfessionalKnowledgeEntry = projected.entries[0];
    expect(entry).toMatchObject({ kind: "REVIEWED_PROCEDURAL_CLAIM", status: "APPROVED_BUT_UNATTACHED", scope: "ONLY_THIS_CLAIM", ownerUserId: "owner-a", payload: { claimId: "COMBING", claimType: "PROCEDURAL_PATTERN", decision: "PROFESSIONALLY_CONFIRMED", value: { kind: "COMBING", occurrenceCount: 2 } } });
    expect(isValidProfessionalKnowledgeEntry(entry)).toBe(true);
    expect(projected.unreviewedClaimIds).toEqual(["CUTTING_ACTION"]);
    expect(entry.provenance).toMatchObject({ draftId: "draft", sourceEvidenceId: "evidence", videoAssetId: "video", claimId: "COMBING", proceduralReviewRevision: 1, extractorVersion: "test-v1", bridgeVersion: "t1.4a-bridge-v1", projectionVersion: "t1.5-projection-v1", sourceDecisionId: '["draft","COMBING",1]' });
  });
  it("CORRECTED uses the exact professional value and preserves the original AI snapshot without mutation", () => {
    const data = input(review({ decision: "PROFESSIONALLY_CORRECTED", correctedValue: "  Apare de trei ori.  " }));
    const before = JSON.stringify(data);
    freeze(data);
    const projection = projectReviewedProceduralKnowledge(data)!;
    expect(projection.entries).toHaveLength(1);
    expect(projection.entries[0].payload.value).toBe("  Apare de trei ori.  ");
    expect(projection.entries[0].provenance.originalAIClaim).toEqual({ value: { kind: "COMBING", occurrenceCount: 2 }, provenance: "INFERRED" });
    expect(isValidProfessionalKnowledgeEntry(projection.entries[0])).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
    expect(projectReviewedProceduralKnowledge(data)).toEqual(projection);
  });
  it("REJECTED produces neither knowledge nor professionally unknown", () => {
    const result = projectReviewedProceduralKnowledge(input(review({ decision: "PROFESSIONALLY_REJECTED" })))!;
    expect(result.entries).toEqual([]);
    expect(result.professionallyUndetermined).toEqual([]);
    expect(result.unreviewedClaimIds).toEqual(["CUTTING_ACTION"]);
  });
  it("UNKNOWN is separate from rejected, unreviewed, and missing review", () => {
    const unknown = projectReviewedProceduralKnowledge(input(review({ decision: "PROFESSIONALLY_UNKNOWN" })))!;
    expect(unknown.entries).toEqual([]);
    expect(unknown.professionallyUndetermined).toEqual([expect.objectContaining({ claimId: "COMBING", decision: "PROFESSIONALLY_UNKNOWN" })]);
    expect(unknown.reviewState).toBe("PRESENT");
    expect(unknown.unreviewedClaimIds).toEqual(["CUTTING_ACTION"]);
    for (const state of [null, { claims: {} }]) {
      const missing = projectReviewedProceduralKnowledge({ ...input(), proceduralReview: state, proceduralReviewRevision: 0 })!;
      expect(missing.entries).toEqual([]);
      expect(missing.professionallyUndetermined).toEqual([]);
      expect(missing.unreviewedClaimIds).toEqual(["COMBING", "CUTTING_ACTION"]);
      expect(missing.reviewState).toBe(state === null ? "MISSING" : "PRESENT");
    }
  });
  it("never leaks sibling AI fields, arbitrary review metadata, or unreviewed claims", () => {
    const data = { ...input(), extraction: { technique: "sectioned blunt cut with finger guide" } };
    data.proceduralReview = { claims: { COMBING: { ...review(), note: "private note is not knowledge", originalValue: { kind: "COMBING", occurrenceCount: 2, technique: "sibling technique" }, sibling: "extra claim" } } };
    const serialized = JSON.stringify(projectReviewedProceduralKnowledge(data));
    for (const secret of ["sectioned blunt", "finger guide", "private note", "sibling technique", "extra claim"]) expect(serialized).not.toContain(secret);
    expect(projectReviewedProceduralKnowledge(data)!.entries).toHaveLength(1);
  });
  it.each([
    { claimId: "INVENTED" }, { claimType: "TECHNIQUE" }, { decision: "ACTIVE" }, { originalProvenance: "OBSERVED" },
    { reviewedByUserId: "owner-b" }, { reviewedAt: "not-a-date" }, { originalValue: { kind: "COMBING", occurrenceCount: 5 } },
    { originalValue: { kind: "CUTTING_ACTION", occurrenceCount: 2 } }, { decision: "PROFESSIONALLY_CORRECTED", correctedValue: " " },
    { decision: "PROFESSIONALLY_CORRECTED" }, { correctedValue: "unexpected correction" },
  ])("fails closed for invalid claim/review %j", patch => {
    const data = { ...input(), proceduralReview: { claims: { COMBING: { ...review(), ...patch } } } };
    expect(projectReviewedProceduralKnowledge(data)).toBeNull();
  });
  it.each([undefined, {}, [], { claims: [] }, { claims: { UNKNOWN: review() } }])("fails closed for malformed review state %j", proceduralReview => {
    expect(projectReviewedProceduralKnowledge({ ...input(), proceduralReview })).toBeNull();
  });
  it.each([-1, 0, 1.5, 2_147_483_648, NaN])("rejects invalid populated-review revision %s", proceduralReviewRevision => {
    expect(projectReviewedProceduralKnowledge({ ...input(), proceduralReviewRevision })).toBeNull();
  });
  it("rejects missing owner, invalid temporal evidence, and out-of-duration intervals", () => {
    expect(projectReviewedProceduralKnowledge({ ...input(), ownerUserId: "" })).toBeNull();
    expect(projectReviewedProceduralKnowledge({ ...input(), temporalEvidence: {} })).toBeNull();
    expect(projectReviewedProceduralKnowledge({ ...input(), temporalEvidence: { ...(input().temporalEvidence as object), sourceDurationSeconds: 1 } })).toBeNull();
  });
  it("reflects the latest decision without keeping a stale copy", () => {
    expect(projectReviewedProceduralKnowledge(input())!.entries).toHaveLength(1);
    const changed = { ...input(review({ decision: "PROFESSIONALLY_REJECTED" })), proceduralReviewRevision: 2 };
    expect(projectReviewedProceduralKnowledge(changed)!.entries).toEqual([]);
  });
  it("extends the canonical contract without adding owner knowledge to the global registry", () => {
    const before = computeProfessionalKnowledgeRegistryFingerprint(buildActiveProfessionalKnowledgeRegistry());
    const projected = projectReviewedProceduralKnowledge(input())!.entries;
    expect(summarizeProfessionalKnowledgeSnapshot(projected).countsByCategory.APPROVED_BUT_UNATTACHED).toBe(1);
    const registry = buildActiveProfessionalKnowledgeRegistry();
    expect(registry.some(e => e.kind === "REVIEWED_PROCEDURAL_CLAIM")).toBe(false);
    expect(computeProfessionalKnowledgeRegistryFingerprint(registry)).toBe(before);
  });
  it("locks status/scope at compile time and validates owner/provenance at runtime", () => {
    type Entry = Extract<ProfessionalKnowledgeEntry, { kind: "REVIEWED_PROCEDURAL_CLAIM" }>;
    // @ts-expect-error Reviewed owner knowledge cannot become active.
    const active: Entry["status"] = "ACTIVE";
    // @ts-expect-error A reviewed claim cannot acquire broad scope.
    const broad: Entry["scope"] = "ALL_CLAIMS";
    const entry = projectReviewedProceduralKnowledge(input())!.entries[0];
    for (const patch of [{ status: active }, { scope: broad }, { ownerUserId: "owner-b" }, { provenance: { ...entry.provenance, projectionVersion: "future" } }, { payload: { ...entry.payload, value: { kind: "COMBING", occurrenceCount: 8 } } }]) {
      expect(isValidProfessionalKnowledgeEntry({ ...entry, ...patch })).toBe(false);
    }
  });
});
