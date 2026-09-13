import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createLearningEvidence, revokeLearningEvidence, markLearningEvidenceSourceMediaDeleted } from "@/lib/professional-learning-evidence-repository";
import { resolveLearningVideoEvidenceForSegmentation } from "./professional-learning-video-evidence-resolver";

// AI Hair Architect, Professional Skill Engine Stage 8.5L5 -- real
// Postgres proof that VIDEO evidence resolution for segmentation
// preserves ownership, PRIVATE_LEARNING_EVIDENCE, and the evidence
// lifecycle exactly (Section 46/51/52/53/54, test matrix 49-55). Zero
// real AI calls; only prisma reads/writes via the EXISTING, unmodified
// evidence repository.

const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-learning-video-evidence-resolver (Stage 8.5L5)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("resolves real, ACTIVE, owned VIDEO evidence", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: video.id,
      provenance: { channel: "upload", purpose: "PROFESSIONAL_LEARNING" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const result = await resolveLearningVideoEvidenceForSegmentation(ownerUserId, evidence.id);
    expect(result).toEqual({ status: "resolved", evidenceId: evidence.id, videoAssetId: video.id });
  });

  it("Section 51/52 IDOR: another owner's video evidence resolves as not-found, never leaking existence", async () => {
    const { ownerUserId: ownerA, clientId: clientA } = await createOwnerAndClient();
    const { ownerUserId: ownerB } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerA, clientA);
    const evidence = await createLearningEvidence(ownerA, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: video.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const result = await resolveLearningVideoEvidenceForSegmentation(ownerB, evidence.id);
    expect(result).toEqual({ status: "unavailable", reason: "EVIDENCE_NOT_FOUND" });
  });

  it("a nonexistent evidence id resolves identically to a cross-owner one (no existence leak)", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const result = await resolveLearningVideoEvidenceForSegmentation(ownerUserId, randomUUID());
    expect(result).toEqual({ status: "unavailable", reason: "EVIDENCE_NOT_FOUND" });
  });

  it("rejects non-VIDEO evidence (e.g. TEXT) -- never silently segments the wrong evidence type", async () => {
    const { ownerUserId } = await createOwnerAndClient();
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "Some professional description.",
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const result = await resolveLearningVideoEvidenceForSegmentation(ownerUserId, evidence.id);
    expect(result).toEqual({ status: "unavailable", reason: "NOT_VIDEO_EVIDENCE" });
  });

  it("Section 53 revoked evidence: a REVOKED VIDEO evidence row can never be segmented", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: video.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });
    await revokeLearningEvidence(ownerUserId, evidence.id);

    const result = await resolveLearningVideoEvidenceForSegmentation(ownerUserId, evidence.id);
    expect(result).toEqual({ status: "unavailable", reason: "EVIDENCE_NOT_ACTIVE" });
  });

  it("Section 54 deleted-source evidence: a DELETED_SOURCE VIDEO evidence row can never be segmented", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    const evidence = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: video.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });
    await markLearningEvidenceSourceMediaDeleted(ownerUserId, evidence.id);

    const result = await resolveLearningVideoEvidenceForSegmentation(ownerUserId, evidence.id);
    expect(result).toEqual({ status: "unavailable", reason: "EVIDENCE_NOT_ACTIVE" });
  });
});

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({ data: { id: ownerUserId, email: `${ownerUserId}@l5-video-evidence-resolver.test`, passwordHash: "test", role: "professional", locale: "en" } });
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "L5 Evidence Resolver Client" } });
  return { ownerUserId, clientId };
}

async function createVideoAsset(ownerUserId: string, clientId: string) {
  return prisma.videoAsset.create({
    data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 12345, storagePath: "pending", origin: "uploaded_source" },
  });
}
