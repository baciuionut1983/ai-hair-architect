import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { projectReviewedProceduralKnowledge } from "@/lib/reviewed-procedural-knowledge-projector";
import { resolveOwnerKnowledgeEligibility, MAX_ELIGIBILITY_CORRECTED_VALUE_LENGTH, OWNER_KNOWLEDGE_INELIGIBILITY_REASONS } from "@/lib/owner-knowledge-eligibility";
import { sealOwnerKnowledgeEligibility, reasoningRequestPackageFingerprint } from "@/lib/owner-knowledge-eligibility-section";
import { buildProfessionalReasoningContext } from "@/lib/professional-reasoning-contracts";
import { GeminiProfessionalReasoningProvider, type GeminiReasoningGenerateInput } from "@/lib/professional-reasoning-provider-gemini";
import { buildActiveProfessionalKnowledgeRegistry, computeProfessionalKnowledgeRegistryFingerprint } from "@/lib/professional-knowledge-registry";

const ownerContext = { ownerUserId: "owner-a", hasGlobalConstraintConflict: false };
function entry(correctedValue?: string) {
  return projectReviewedProceduralKnowledge({
    ownerUserId: "owner-a", draftId: "draft", sourceEvidenceId: "evidence", videoAssetId: "video", vertical: "hair_cutting", extractorVersion: "synthetic", proceduralReviewRevision: 1,
    temporalEvidence: { observations: [], editGaps: [], actions: [{ kind: "COMBING", timeStartSeconds: 0, timeEndSeconds: 1, source: "INFERRED" }] },
    proceduralReview: { claims: { COMBING: { claimId: "COMBING", claimType: "PROCEDURAL_PATTERN", decision: correctedValue === undefined ? "PROFESSIONALLY_CONFIRMED" : "PROFESSIONALLY_CORRECTED", originalValue: { kind: "COMBING", occurrenceCount: 1 }, originalProvenance: "INFERRED", reviewedByUserId: "owner-a", reviewedAt: "2026-09-19T00:00:00.000Z", ...(correctedValue === undefined ? {} : { correctedValue }) } } },
  })!.entries[0];
}
function basePackage() {
  const context = buildProfessionalReasoningContext({ selection: {
    delta: { sourceCurrentSnapshotId: "current", sourceCurrentSnapshotVersion: 1, sourceTargetSnapshotId: "target", sourceTargetSnapshotVersion: 1, computedAt: "2026-09-19T00:00:00.000Z", entries: [] },
    candidateMatches: [], rejectedMatches: [], unresolvedDeltas: [],
  } });
  return { clientId: "client", context, requiresPaidReasoningCall: true as const };
}

describe("T1.6.1 pure eligibility", () => {
  it("current frequency claims have no decision relevance, skill binding, or context binding", () => {
    expect(resolveOwnerKnowledgeEligibility(entry(), ownerContext)).toMatchObject({ eligible: false, status: "INELIGIBLE", reasons: ["CLAIM_CLASS_NOT_DECISION_RELEVANT", "SKILL_BINDING_MISSING", "CONTEXT_BINDING_MISSING"] });
  });
  it("correction text and fabricated bindings cannot create eligibility", () => {
    const knowledge = { ...entry("Use a 45 degree elevation and select skill X"), skillBinding: { skillId: "X", version: 1 }, contextBinding: { field: "elevation" } };
    const result = resolveOwnerKnowledgeEligibility(knowledge, ownerContext);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("SKILL_BINDING_MISSING");
    expect(result.reasons).toContain("CONTEXT_BINDING_MISSING");
    expect(JSON.stringify(result)).not.toContain("45 degree");
  });
  it("global authority conflict adds an explicit veto and cannot be overridden", () => {
    const result = resolveOwnerKnowledgeEligibility(entry(), { ...ownerContext, hasGlobalConstraintConflict: true });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("GLOBAL_CONSTRAINT_CONFLICT");
  });
  it("foreign knowledge fails closed without returning its identifiers/provenance", () => {
    const result = resolveOwnerKnowledgeEligibility(entry(), { ...ownerContext, ownerUserId: "owner-b" });
    expect(result).toMatchObject({ ownerUserId: "owner-b", eligible: false, reference: null, reasons: ["OWNER_MISMATCH"] });
    expect(JSON.stringify(result)).not.toMatch(/owner-a|evidence|draft/);
  });
  it.each([null, undefined, [], {}, "claim", { ownerUserId: "owner-a" }])("malformed value %j never becomes eligible", value => {
    expect(resolveOwnerKnowledgeEligibility(value, ownerContext).eligible).toBe(false);
    expect(resolveOwnerKnowledgeEligibility(value, ownerContext).reasons.length).toBeGreaterThan(0);
  });
  it.each(["PROFESSIONALLY_REJECTED", "PROFESSIONALLY_UNKNOWN", "UNKNOWN"])("%s never becomes eligible", decision => {
    const original = entry();
    const result = resolveOwnerKnowledgeEligibility({ ...original, payload: { ...original.payload, decision } }, ownerContext);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("REVIEW_NOT_ELIGIBLE");
  });
  it("unsupported class and active status are rejected", () => {
    const result = resolveOwnerKnowledgeEligibility({ ...entry(), kind: "EXECUTION_PARAMETER", status: "ACTIVE" }, ownerContext);
    expect(result.reasons).toContain("UNSUPPORTED_CLAIM_CLASS");
    expect(result.reasons).toContain("REVIEW_NOT_ELIGIBLE");
  });
  it.each(["projectionVersion", "bridgeVersion"])("rejects unknown %s", field => {
    const original = entry();
    const result = resolveOwnerKnowledgeEligibility({ ...original, provenance: { ...original.provenance, [field]: "unknown-version" } }, ownerContext);
    expect(result.reasons).toContain("UNSUPPORTED_PROJECTION_VERSION");
  });
  it("caps corrected text at the eligibility boundary without truncating or mutating review", () => {
    const original = entry("x".repeat(MAX_ELIGIBILITY_CORRECTED_VALUE_LENGTH + 1));
    const before = JSON.stringify(original);
    const result = resolveOwnerKnowledgeEligibility(original, ownerContext);
    expect(result.reasons).toContain("CORRECTED_VALUE_TOO_LARGE");
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify(result)).not.toContain("x".repeat(100));
    expect(resolveOwnerKnowledgeEligibility(entry("x".repeat(MAX_ELIGIBILITY_CORRECTED_VALUE_LENGTH)), ownerContext).reasons).not.toContain("CORRECTED_VALUE_TOO_LARGE");
  });
  it.each(["bad\u0000text", "bad\uD800text"])("rejects malformed correction %j", value => {
    expect(resolveOwnerKnowledgeEligibility(entry(value), ownerContext).reasons).toContain("CORRECTED_VALUE_MALFORMED");
  });
  it("preserves audit references and deterministic reason order, with no mutation or registry changes", () => {
    const original = entry("synthetic correction");
    const before = JSON.stringify(original);
    const registryBefore = computeProfessionalKnowledgeRegistryFingerprint(buildActiveProfessionalKnowledgeRegistry());
    const result = resolveOwnerKnowledgeEligibility(original, ownerContext);
    expect(resolveOwnerKnowledgeEligibility(original, ownerContext)).toEqual(result);
    expect(result.reference).toMatchObject({ knowledgeId: original.id, draftId: "draft", sourceEvidenceId: "evidence", videoAssetId: "video", claimId: "COMBING", proceduralReviewRevision: 1, sourceDecisionId: '["draft","COMBING",1]', projectionVersion: "t1.5-projection-v1", bridgeVersion: "t1.4a-bridge-v1", decision: "PROFESSIONALLY_CORRECTED" });
    expect(result.reasons.every(reason => OWNER_KNOWLEDGE_INELIGIBILITY_REASONS.includes(reason))).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
    expect(computeProfessionalKnowledgeRegistryFingerprint(buildActiveProfessionalKnowledgeRegistry())).toBe(registryBefore);
  });
});

describe("T1.6.1 optional package section; provider context is separate", () => {
  it("empty/absent section keeps exact legacy context JSON, package JSON, and fingerprint", () => {
    const base = basePackage();
    const before = JSON.stringify(base);
    const sealed = sealOwnerKnowledgeEligibility(base, "owner-a", []);
    expect(sealed).toBe(base);
    expect(JSON.stringify(sealed)).toBe(before);
    expect(Object.hasOwn(sealed, "knowledgeEligibility")).toBe(false);
    expect(Object.hasOwn(sealed, "requestFingerprint")).toBe(false);
    // Canonical pre-T1.6.1 fingerprint algorithm, frozen as an independent
    // legacy oracle. No section names/properties are inserted into it.
    const legacyCanonical = { schemaVersion: "1.0.0-pr5", currentSnapshotId: "current", currentSnapshotVersion: 1, targetSnapshotId: "target", targetSnapshotVersion: 1, deltaEntries: [], candidateSkills: [], unresolvedDeltas: [], preserveConstraints: [], professionalRequestText: null, currentEvidence: [], targetEvidence: [] };
    expect(reasoningRequestPackageFingerprint(sealed)).toBe(createHash("sha256").update(JSON.stringify(legacyCanonical)).digest("hex"));
  });
  it("nonempty section changes only package fingerprint, ordered/deduplicated canonically and deeply frozen", () => {
    const base = basePackage();
    const a = resolveOwnerKnowledgeEligibility(entry("A"), ownerContext);
    const b = resolveOwnerKnowledgeEligibility(entry("B"), ownerContext);
    const sealed = sealOwnerKnowledgeEligibility(base, "owner-a", [b, a, a]);
    const reordered = sealOwnerKnowledgeEligibility(base, "owner-a", [a, b]);
    expect(JSON.stringify(sealed)).toBe(JSON.stringify(reordered));
    expect(sealed.context).toBe(base.context);
    expect(reasoningRequestPackageFingerprint(sealed)).not.toBe(base.context.contextFingerprint);
    expect(sealOwnerKnowledgeEligibility(base, "owner-a", [a]).requestFingerprint).not.toBe(sealOwnerKnowledgeEligibility(base, "owner-a", [b]).requestFingerprint);
    expect(Object.isFrozen(sealed.knowledgeEligibility)).toBe(true);
    expect(Object.isFrozen(sealed.knowledgeEligibility!.evaluations[0].reference)).toBe(true);
    expect(Object.isFrozen(sealed.knowledgeEligibility!.evaluations[0].reasons)).toBe(true);
    expect(() => { (sealed.knowledgeEligibility!.evaluations as unknown[]).push({}); }).toThrow();
    expect(Object.isFrozen(a)).toBe(false);
  });
  it("rejects cross-owner section construction", () => {
    expect(() => sealOwnerKnowledgeEligibility(basePackage(), "owner-b", [resolveOwnerKnowledgeEligibility(entry(), ownerContext)])).toThrow();
  });
  it("request fingerprint includes context and owner, without changing the provider context fingerprint", () => {
    const result = resolveOwnerKnowledgeEligibility(entry(), ownerContext);
    const a = basePackage(); const b = basePackage(); b.context.contextFingerprint = "another-confirmed-context";
    expect(sealOwnerKnowledgeEligibility(a, "owner-a", [result]).requestFingerprint).not.toBe(sealOwnerKnowledgeEligibility(b, "owner-a", [result]).requestFingerprint);
    expect(reasoningRequestPackageFingerprint(a)).toBe(a.context.contextFingerprint);
  });
  it("rendered prompt and low-level provider input stay byte-identical (fake transport only)", async () => {
    const base = basePackage();
    const sealed = sealOwnerKnowledgeEligibility(base, "owner-a", [resolveOwnerKnowledgeEligibility(entry("PRIVATE_CORRECTION_NEVER_FOR_MODEL"), ownerContext)]);
    expect(JSON.stringify(sealed.context)).toBe(JSON.stringify(base.context));
    const requests: GeminiReasoningGenerateInput[] = [];
    const provider = new GeminiProfessionalReasoningProvider({ apiKey: "fake-key", model: "synthetic-model" }, { async generateContent(input) { requests.push(input); return '{}'; } });
    await provider.reason(base.context);
    await provider.reason(sealed.context);
    expect(requests).toHaveLength(2);
    expect(requests[0].prompt).toBe(requests[1].prompt);
    expect(JSON.stringify(requests[0])).toBe(JSON.stringify(requests[1]));
    expect(requests[1].prompt).not.toMatch(/PRIVATE_CORRECTION|eligibility|INELIGIBLE/);
  });
});
