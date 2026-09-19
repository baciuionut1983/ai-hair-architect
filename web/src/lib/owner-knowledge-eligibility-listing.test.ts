import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveImageFile, deleteImageFile } from "@/lib/image-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { createDraft, transitionDraftStatus } from "@/lib/professional-learning-draft-repository";
import { submitProceduralClaimReview } from "@/lib/professional-learning-procedural-review-service";
import * as projectionService from "@/lib/reviewed-procedural-knowledge-service";
import { listOwnerKnowledgeEligibility, MAX_ELIGIBILITY_DRAFTS } from "@/lib/owner-knowledge-eligibility-listing";
import { createDraftCurrentState, createDraftTargetState, confirmSnapshot, prepareReasoningRequestPackage } from "@/lib/professional-brain-orchestrator";
import { HEAD_ZONES } from "@/lib/technical-visual-map-validators";
import { buildUnassessedGlobalEntry, buildUnassessedZoneEntry } from "@/lib/hair-state-snapshot-validators";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners: string[] = [];
const files: string[] = [];
async function ownerFixture() {
  const owner = randomUUID(); owners.push(owner);
  await prisma.user.create({ data: { id: owner, email: `${owner}@t1-6-1.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const client = await prisma.client.create({ data: { ownerUserId: owner, fullName: "Synthetic eligibility client" } });
  return { owner, clientId: client.id };
}
async function knowledgeFixture(owner: string, clientId: string) {
  const videoId = randomUUID(); const bytes = Buffer.from("synthetic-video-source");
  const storagePath = await saveImageFile(owner, videoId, "test.mp4", bytes); files.push(storagePath);
  await prisma.videoAsset.create({ data: { id: videoId, ownerUserId: owner, clientId, origin: "uploaded_source", storagePath, mimeType: "video/mp4", sizeBytes: bytes.length } });
  const evidence = await createLearningEvidence(owner, { evidenceType: "VIDEO", vertical: "hair_cutting", videoAssetId: videoId, provenance: { channel: "synthetic" }, rightsClassification: "USER_OWNED_OR_AUTHORIZED" });
  const draft = await createDraft(owner, randomUUID(), {
    sourceEvidenceId: evidence.id, extractorVersion: "synthetic", discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "POSSIBLE_NEW_SKILL", comparedSkillId: null, extraction: {}, conflictDetail: null, createdByUserId: owner,
    temporalEvidence: { observations: [], editGaps: [], actions: [{ kind: "COMBING", source: "INFERRED", timeStartSeconds: 0, timeEndSeconds: 1 }] },
  });
  await transitionDraftStatus(owner, draft.id, "READY_FOR_REVIEW"); await transitionDraftStatus(owner, draft.id, "APPROVED");
  await submitProceduralClaimReview({ ownerUserId: owner, reviewedByUserId: owner, draftId: draft.id, claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", expectedProceduralReviewRevision: 0 });
  return { draftId: draft.id, evidenceId: evidence.id, videoId };
}
const listing = (ownerUserId: string) => listOwnerKnowledgeEligibility({ ownerUserId, hasGlobalConstraintConflict: false });
suite("T1.6.1 owner listing / single preparation integration (local Postgres)", () => {
  afterEach(async () => {
    vi.useRealTimers(); vi.restoreAllMocks();
    for (const file of files.splice(0)) await deleteImageFile(file);
    await prisma.hairStateSnapshotEvidence.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.hairStateSnapshot.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } }); owners.length = 0;
  });
  it("A sees only A; B sees only B; unknown owner receives nothing", async () => {
    const a = await ownerFixture(); const b = await ownerFixture();
    const ka = await knowledgeFixture(a.owner, a.clientId); const kb = await knowledgeFixture(b.owner, b.clientId);
    const ra = await listing(a.owner); const rb = await listing(b.owner);
    expect(ra).toHaveLength(1); expect(rb).toHaveLength(1);
    expect(ra[0].reference?.draftId).toBe(ka.draftId); expect(rb[0].reference?.draftId).toBe(kb.draftId);
    expect(JSON.stringify(rb)).not.toContain(a.owner); expect(JSON.stringify(rb)).not.toContain(ka.draftId);
    expect(await listing(randomUUID())).toEqual([]);
  });
  it("changed/rejected/UNKNOWN review is recomputed and never silently cached", async () => {
    const a = await ownerFixture(); const k = await knowledgeFixture(a.owner, a.clientId);
    const first = await listing(a.owner);
    await submitProceduralClaimReview({ ownerUserId: a.owner, reviewedByUserId: a.owner, draftId: k.draftId, claimId: "COMBING", decision: "PROFESSIONALLY_CORRECTED", correctedValue: "synthetic change", expectedProceduralReviewRevision: 1 });
    const second = await listing(a.owner);
    expect(second[0].reference?.proceduralReviewRevision).toBe(2);
    expect(second[0].reference?.contentFingerprint).not.toBe(first[0].reference?.contentFingerprint);
    let revision = 2;
    for (const decision of ["PROFESSIONALLY_REJECTED", "PROFESSIONALLY_UNKNOWN"] as const) {
      await submitProceduralClaimReview({ ownerUserId: a.owner, reviewedByUserId: a.owner, draftId: k.draftId, claimId: "COMBING", decision, expectedProceduralReviewRevision: revision++ });
      expect(await listing(a.owner)).toEqual([]);
    }
  });
  it("revoked evidence and superseded draft contribute no knowledge", async () => {
    const a = await ownerFixture(); const k = await knowledgeFixture(a.owner, a.clientId);
    await prisma.professionalLearningEvidence.update({ where: { id: k.evidenceId }, data: { status: "REVOKED" } });
    expect(await listing(a.owner)).toEqual([]);
    await prisma.professionalLearningDraft.update({ where: { id: k.draftId }, data: { status: "SUPERSEDED" } });
    expect(await listing(a.owner)).toEqual([]);
  });
  it("detects revision changes during listing and returns no stale section", async () => {
    const a = await ownerFixture(); const k = await knowledgeFixture(a.owner, a.clientId);
    const realRead = projectionService.readReviewedProceduralKnowledge;
    vi.spyOn(projectionService, "readReviewedProceduralKnowledge").mockImplementationOnce(async (owner, id) => {
      const result = await realRead(owner, id);
      await submitProceduralClaimReview({ ownerUserId: owner, reviewedByUserId: owner, draftId: id, claimId: "COMBING", decision: "PROFESSIONALLY_REJECTED", expectedProceduralReviewRevision: 1 });
      return result;
    });
    await expect(listing(a.owner)).rejects.toMatchObject({ code: "KNOWLEDGE_LISTING_CHANGED" });
    expect(k.draftId).toBeTruthy();
  });
  it("does not turn a storage/database outage into an empty eligible input", async () => {
    const a = await ownerFixture(); await knowledgeFixture(a.owner, a.clientId);
    vi.spyOn(projectionService, "readReviewedProceduralKnowledge").mockRejectedValueOnce(new projectionService.ReviewedProceduralKnowledgeReadError("PROJECTION_READ_UNAVAILABLE", 503));
    await expect(listing(a.owner)).rejects.toMatchObject({ httpStatus: 503 });
  });
  it("rejects a foreign projection even if a read dependency violates its contract", async () => {
    const a = await ownerFixture(); const b = await ownerFixture(); await knowledgeFixture(a.owner, a.clientId);
    const kb = await knowledgeFixture(b.owner, b.clientId);
    const foreign = await projectionService.readReviewedProceduralKnowledge(b.owner, kb.draftId);
    vi.spyOn(projectionService, "readReviewedProceduralKnowledge").mockResolvedValueOnce(foreign);
    await expect(listing(a.owner)).rejects.toMatchObject({ code: "KNOWLEDGE_OWNER_MISMATCH" });
  });
  it("fails explicitly instead of truncating an oversized listing", async () => {
    const a = await ownerFixture();
    await prisma.professionalLearningDraft.createMany({ data: Array.from({ length: MAX_ELIGIBILITY_DRAFTS + 1 }, () => ({
      ownerUserId: a.owner, sourceEvidenceId: randomUUID(), extractorVersion: "synthetic-overflow", status: "APPROVED",
      discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "POSSIBLE_NEW_SKILL", extraction: {}, createdByUserId: a.owner,
    })) });
    await expect(listing(a.owner)).rejects.toMatchObject({ code: "KNOWLEDGE_LISTING_LIMIT_EXCEEDED" });
  });
  it("preparation adds only the sealed sibling section, writes nothing, and keeps provider context bit-for-bit", async () => {
    const a = await ownerFixture(); const b = await ownerFixture();
    const payload = { globalState: buildUnassessedGlobalEntry(), zones: HEAD_ZONES.map(zone => buildUnassessedZoneEntry(zone)) };
    const current = await createDraftCurrentState(a.owner, a.clientId, { payload }); await confirmSnapshot(a.owner, a.clientId, current.id, null);
    const target = await createDraftTargetState(a.owner, a.clientId, payload); await confirmSnapshot(a.owner, a.clientId, target.id, null);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-19T12:00:00.000Z"));
    const empty = await prepareReasoningRequestPackage(a.owner, a.clientId);
    expect(empty.knowledgeEligibility).toBeUndefined(); expect(empty.requestFingerprint).toBeUndefined();
    await knowledgeFixture(a.owner, a.clientId);
    const before = await prisma.professionalLearningDraft.findMany({ where: { ownerUserId: a.owner } });
    const prepared = await prepareReasoningRequestPackage(a.owner, a.clientId);
    expect(prepared.knowledgeEligibility?.evaluations).toHaveLength(1);
    expect(prepared.knowledgeEligibility?.ownerUserId).toBe(a.owner);
    expect(prepared.knowledgeEligibility?.evaluations[0].eligible).toBe(false);
    expect(JSON.stringify(prepared.context)).toBe(JSON.stringify(empty.context));
    expect(prepared.candidateSkillCount).toBe(empty.candidateSkillCount);
    expect(prepared.unresolvedDeltaCount).toBe(empty.unresolvedDeltaCount);
    expect(await prisma.professionalLearningDraft.findMany({ where: { ownerUserId: a.owner } })).toEqual(before);
    expect(await prisma.professionalReasoningProposal.count({ where: { ownerUserId: a.owner } })).toBe(0);
    await expect(prepareReasoningRequestPackage(b.owner, a.clientId)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
