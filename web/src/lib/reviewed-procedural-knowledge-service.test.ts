import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { saveImageFile, deleteImageFile } from "@/lib/image-storage";
import { createLearningEvidence } from "@/lib/professional-learning-evidence-repository";
import { createDraft, transitionDraftStatus } from "@/lib/professional-learning-draft-repository";
import { submitProceduralClaimReview } from "@/lib/professional-learning-procedural-review-service";
import { readReviewedProceduralKnowledge } from "@/lib/reviewed-procedural-knowledge-service";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners: string[] = [];
const files: string[] = [];

async function fixture() {
  const owner = randomUUID();
  owners.push(owner);
  await prisma.user.create({ data: { id: owner, email: `${owner}@t1-5.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const client = await prisma.client.create({ data: { ownerUserId: owner, fullName: "T1.5 synthetic source" } });
  const videoId = randomUUID();
  const bytes = Buffer.from("synthetic-test-video");
  const storagePath = await saveImageFile(owner, videoId, "test.mp4", bytes);
  files.push(storagePath);
  await prisma.videoAsset.create({ data: { id: videoId, ownerUserId: owner, clientId: client.id, origin: "uploaded_source", storagePath, mimeType: "video/mp4", sizeBytes: bytes.length } });
  const evidence = await createLearningEvidence(owner, { evidenceType: "VIDEO", vertical: "hair_cutting", videoAssetId: videoId, rightsClassification: "USER_OWNED_OR_AUTHORIZED", provenance: { channel: "test" } });
  const draft = await createDraft(owner, randomUUID(), {
    sourceEvidenceId: evidence.id, extractorVersion: "t1.5-test-v1", discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "POSSIBLE_NEW_SKILL", comparedSkillId: null,
    extraction: { techniqueCandidate: { value: "SIBLING_AI_MUST_NOT_LEAK", source: "INFERRED" } }, conflictDetail: null, createdByUserId: owner,
    temporalEvidence: { observations: [], actions: [{ kind: "COMBING", timeStartSeconds: 0, timeEndSeconds: 2, source: "INFERRED" }], editGaps: [] },
  });
  await transitionDraftStatus(owner, draft.id, "READY_FOR_REVIEW");
  await transitionDraftStatus(owner, draft.id, "APPROVED");
  await submitProceduralClaimReview({ ownerUserId: owner, reviewedByUserId: owner, draftId: draft.id, claimId: "COMBING", decision: "PROFESSIONALLY_CONFIRMED", expectedProceduralReviewRevision: 0 });
  return { owner, clientId: client.id, videoId, evidenceId: evidence.id, draftId: draft.id, storagePath };
}

suite("T1.5 read-only owner service (real local Postgres and local source)", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const file of files.splice(0)) await deleteImageFile(file);
    await prisma.professionalLearningDraft.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: owners } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
    owners.length = 0;
  });
  it("reads reviewed knowledge without changing draft, evidence, or asset; fetches no extraction", async () => {
    const f = await fixture();
    const snapshot = async () => Promise.all([
      prisma.professionalLearningDraft.findUnique({ where: { id: f.draftId } }),
      prisma.professionalLearningEvidence.findUnique({ where: { id: f.evidenceId } }),
      prisma.videoAsset.findUnique({ where: { id: f.videoId } }),
    ]);
    const before = await snapshot();
    const result = await readReviewedProceduralKnowledge(f.owner, f.draftId);
    expect(result.ownerUserId).toBe(f.owner);
    expect(result.entries).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SIBLING_AI_MUST_NOT_LEAK");
    expect(await snapshot()).toEqual(before);
  });
  it("owner A cannot read owner B's draft and storage is never touched", async () => {
    const a = await fixture();
    const b = await fixture();
    const probe = vi.fn();
    await expect(readReviewedProceduralKnowledge(a.owner, b.draftId, probe)).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND", httpStatus: 404 });
    await expect(readReviewedProceduralKnowledge(a.owner, randomUUID(), probe)).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND", httpStatus: 404 });
    expect(probe).not.toHaveBeenCalled();
  });
  it("revalidates draft -> evidence owner even when a soft pointer names an existing foreign evidence", async () => {
    const a = await fixture(); const b = await fixture();
    await prisma.professionalLearningDraft.update({ where: { id: a.draftId }, data: { sourceEvidenceId: b.evidenceId, extractorVersion: "t1.5-foreign-link-test" } });
    await expect(readReviewedProceduralKnowledge(a.owner, a.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it("revalidates evidence -> asset owner even when the foreign asset exists", async () => {
    const a = await fixture(); const b = await fixture();
    await prisma.professionalLearningEvidence.update({ where: { id: a.evidenceId }, data: { videoAssetId: b.videoId } });
    await expect(readReviewedProceduralKnowledge(a.owner, a.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it.each(["SUPERSEDED", "DRAFT", "READY_FOR_REVIEW", "REJECTED", "REANALYZING", "INVALID_STATUS"])("rejects draft lifecycle %s", async status => {
    const f = await fixture();
    await prisma.professionalLearningDraft.update({ where: { id: f.draftId }, data: { status } });
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it.each([
    { status: "REVOKED" }, { status: "DELETED_SOURCE" }, { status: "INVALID" }, { revokedAt: new Date() }, { sourceMediaDeletedAt: new Date() },
    { visibilityScope: "PUBLIC" }, { rightsClassification: "INVALID" }, { parentEvidenceId: randomUUID() }, { provenance: Prisma.JsonNull },
    { videoAssetId: randomUUID() },
  ])("rejects inactive or invalid evidence %j", async data => {
    const f = await fixture();
    await prisma.professionalLearningEvidence.update({ where: { id: f.evidenceId }, data });
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it.each([{ deletedAt: new Date() }, { origin: "generated_output" }, { mimeType: "image/png" }, { storageBackend: "unknown" }, { storagePath: "pending" }])("rejects deleted/incompatible source %j", async data => {
    const f = await fixture();
    await prisma.videoAsset.update({ where: { id: f.videoId }, data });
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it("fails closed for a deleted client or inaccessible file", async () => {
    const f = await fixture();
    await deleteImageFile(f.storagePath);
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
    await prisma.client.update({ where: { id: f.clientId }, data: { deletedAt: new Date() } });
    const probe = vi.fn();
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId, probe)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
    expect(probe).not.toHaveBeenCalled();
  });
  it("does not treat another owner's local path as an accessible source", async () => {
    const a = await fixture(); const b = await fixture();
    await prisma.videoAsset.update({ where: { id: a.videoId }, data: { storagePath: b.storagePath } });
    await expect(readReviewedProceduralKnowledge(a.owner, a.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it("detects missing evidence and a supersession pointer despite APPROVED status", async () => {
    const f = await fixture();
    await prisma.professionalLearningDraft.update({ where: { id: f.draftId }, data: { supersededByDraftId: randomUUID() } });
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
    await prisma.professionalLearningDraft.update({ where: { id: f.draftId }, data: { supersededByDraftId: null, sourceEvidenceId: randomUUID() } });
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it("reads the last persisted decision: CONFIRMED -> CORRECTED -> UNKNOWN -> REJECTED", async () => {
    const f = await fixture();
    expect((await readReviewedProceduralKnowledge(f.owner, f.draftId)).entries).toHaveLength(1);
    let revision = 1;
    for (const decision of ["PROFESSIONALLY_CORRECTED", "PROFESSIONALLY_UNKNOWN", "PROFESSIONALLY_REJECTED"] as const) {
      await submitProceduralClaimReview({ ownerUserId: f.owner, reviewedByUserId: f.owner, draftId: f.draftId, claimId: "COMBING", decision, expectedProceduralReviewRevision: revision++, ...(decision === "PROFESSIONALLY_CORRECTED" ? { correctedValue: "Three occurrences" } : {}) });
      const result = await readReviewedProceduralKnowledge(f.owner, f.draftId);
      expect(result.proceduralReviewRevision).toBe(revision);
      expect(result.entries).toHaveLength(decision === "PROFESSIONALLY_CORRECTED" ? 1 : 0);
      expect(result.professionallyUndetermined).toHaveLength(decision === "PROFESSIONALLY_UNKNOWN" ? 1 : 0);
    }
  });
  it("rejects a review changed during source I/O instead of returning stale knowledge", async () => {
    const f = await fixture();
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId, async () => {
      await submitProceduralClaimReview({ ownerUserId: f.owner, reviewedByUserId: f.owner, draftId: f.draftId, claimId: "COMBING", decision: "PROFESSIONALLY_REJECTED", expectedProceduralReviewRevision: 1 });
      return true;
    })).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE", httpStatus: 409 });
    expect((await readReviewedProceduralKnowledge(f.owner, f.draftId)).entries).toEqual([]);
  });
  it("rejects revocation during source I/O", async () => {
    const f = await fixture();
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId, async () => {
      await prisma.professionalLearningEvidence.update({ where: { id: f.evidenceId }, data: { status: "REVOKED" } });
      return true;
    })).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
  });
  it("does not sanitize malformed persisted reviews into missing review", async () => {
    const f = await fixture();
    await prisma.professionalLearningDraft.update({ where: { id: f.draftId }, data: { proceduralReview: { claims: { COMBING: { decision: "INVALID" } } } } });
    await expect(readReviewedProceduralKnowledge(f.owner, f.draftId)).rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE" });
    await prisma.professionalLearningDraft.update({ where: { id: f.draftId }, data: { proceduralReview: Prisma.DbNull } });
    expect(await readReviewedProceduralKnowledge(f.owner, f.draftId)).toMatchObject({ reviewState: "MISSING", entries: [], professionallyUndetermined: [] });
  });
  it("returns a safe 503 without database error details", async () => {
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("private database details"));
    await expect(readReviewedProceduralKnowledge("owner", "draft")).rejects.toMatchObject({ code: "PROJECTION_READ_UNAVAILABLE", httpStatus: 503, message: "PROJECTION_READ_UNAVAILABLE" });
  });
});
