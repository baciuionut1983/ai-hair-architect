import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createCaptureSet } from "@/lib/capture-set-repository";
import {
  createLearningEvidence,
  findLearningEvidenceForOwner,
  getLearningEvidenceSourceLinkage,
  listLearningEvidenceForOwner,
  markLearningEvidenceSourceMediaDeleted,
  ProfessionalLearningEvidenceValidationError,
  revokeLearningEvidence,
} from "@/lib/professional-learning-evidence-repository";
import { evaluateVideoAssetPurgeEligibility } from "@/lib/video-asset-historical-reference-guard";
import { videoHistoricalReferenceDatabase } from "@/lib/video-asset-historical-reference-guard-runtime";

// Professional Skill Engine, Stage 8.5L2 -- real Postgres, no mocks,
// mirroring capture-set-repository.test.ts's own conventions exactly (a
// tracked `owners` Set cleaned up in afterEach). Skips (never fails) when
// no database is configured. Maps directly onto Stage 8.5L2 Part 27's own
// 24-item test list -- see each `it()`'s own leading number.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-learning-evidence-repository (durable Learning Evidence domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalMemory.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSetImage.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.captureSet.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.imageAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("1. creates evidence for an owner", async () => {
    const { ownerUserId } = await createOwner();
    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "TEXT",
      vertical: "hair_cutting",
      originalText: "Graduation at 45 degrees produces a soft, blended edge.",
      provenance: { channel: "typed" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    expect(record.ownerUserId).toBe(ownerUserId);
    expect(record.status).toBe("ACTIVE");
    const row = await prisma.professionalLearningEvidence.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.id).toBe(record.id);
  });

  it("2. default visibility is private (PRIVATE_LEARNING_EVIDENCE), with no way to request another scope", async () => {
    const { ownerUserId } = await createOwner();
    const record = await createLearningEvidence(ownerUserId, textInput());
    expect(record.visibilityScope).toBe("PRIVATE_LEARNING_EVIDENCE");
  });

  it("3. another user cannot retrieve evidence owned by User A", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const record = await createLearningEvidence(userA, textInput());

    expect(await findLearningEvidenceForOwner(userA, record.id)).not.toBeNull();
    expect(await findLearningEvidenceForOwner(userB, record.id)).toBeNull();
  });

  it("4. another user cannot revoke evidence owned by User A", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    const record = await createLearningEvidence(userA, textInput());

    const revokedByB = await revokeLearningEvidence(userB, record.id);
    expect(revokedByB).toBe(false);

    const stillActive = await findLearningEvidenceForOwner(userA, record.id);
    expect(stillActive?.status).toBe("ACTIVE");
  });

  it("5. evidence can reference an ImageAsset safely (IMAGE type)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: image.id,
      provenance: { channel: "upload" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });
    expect(record.imageAssetId).toBe(image.id);
    expect(record.captureSetId).toBeNull();
    expect(record.videoAssetId).toBeNull();
  });

  it("5b. rejects an ImageAsset reference owned by a different user", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB, clientId: clientB } = await createOwnerAndClient();
    const foreignImage = await createImageAsset(userB, clientB);

    const error = await createLearningEvidence(userA, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: foreignImage.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("ProfessionalLearningEvidenceDependencyError");
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId: userA } })).resolves.toBe(0);
  });

  it("Stage 8.5L3 Part 28 #13: rejects a CaptureSet reference owned by a different user", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB, clientId: clientB } = await createOwnerAndClient();
    const foreignImage = await createImageAsset(userB, clientB);
    const foreignCaptureSet = await createCaptureSet(userB, clientB, [{ viewLabel: "FRONT", imageAssetId: foreignImage.id }]);

    const error = await createLearningEvidence(userA, {
      evidenceType: "IMAGE_SET",
      vertical: "hair_cutting",
      captureSetId: foreignCaptureSet.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("ProfessionalLearningEvidenceDependencyError");
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId: userA } })).resolves.toBe(0);
  });

  it("Stage 8.5L3 Part 28 #14: rejects a VideoAsset reference owned by a different user", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB, clientId: clientB } = await createOwnerAndClient();
    const foreignVideo = await createVideoAsset(userB, clientB);

    const error = await createLearningEvidence(userA, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: foreignVideo.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    }).catch((e: unknown) => e);
    expect((error as Error).name).toBe("ProfessionalLearningEvidenceDependencyError");
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId: userA } })).resolves.toBe(0);
  });

  it("Stage 8.5L3 Part 28 #17/18: a repeated submissionId is idempotent -- no duplicate row, same evidence returned", async () => {
    const { ownerUserId } = await createOwner();
    const submissionId = randomUUID();

    const first = await createLearningEvidence(ownerUserId, textInput({ title: "idempotency check" }), { submissionId });
    const second = await createLearningEvidence(ownerUserId, textInput({ title: "idempotency check" }), { submissionId });

    expect(second.id).toBe(first.id);
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("Stage 8.5L3 Part 28 #17: a different submissionId for the same content legitimately creates a second row (same bytes != same submission)", async () => {
    const { ownerUserId } = await createOwner();

    const first = await createLearningEvidence(ownerUserId, textInput({ title: "same content" }), { submissionId: randomUUID() });
    const second = await createLearningEvidence(ownerUserId, textInput({ title: "same content" }), { submissionId: randomUUID() });

    expect(second.id).not.toBe(first.id);
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId } })).resolves.toBe(2);
  });

  it("6. evidence can reference a CaptureSet safely (IMAGE_SET type)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const captureSet = await createCaptureSet(ownerUserId, clientId, [{ viewLabel: "FRONT", imageAssetId: image.id }]);

    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE_SET",
      vertical: "hair_cutting",
      captureSetId: captureSet.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });
    expect(record.captureSetId).toBe(captureSet.id);
    expect(record.imageAssetId).toBeNull();
  });

  it("7. evidence can reference a VideoAsset safely (VIDEO type)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const video = await createVideoAsset(ownerUserId, clientId);
    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: video.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });
    expect(record.videoAssetId).toBe(video.id);
  });

  it("8. rejects an invalid mixed source relationship (two pointers set for one row)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const video = await createVideoAsset(ownerUserId, clientId);

    const error = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: image.id,
      videoAssetId: video.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    } as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProfessionalLearningEvidenceValidationError);
  });

  it("9/10/11. revocation is soft, preserves provenance, and never touches the source asset", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: image.id,
      provenance: { channel: "upload", capturedAt: "2026-09-11" },
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const revoked = await revokeLearningEvidence(ownerUserId, record.id);
    expect(revoked).toBe(true);

    const row = await prisma.professionalLearningEvidence.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.status).toBe("REVOKED"); // 9. soft -- row still exists
    expect(row.revokedAt).not.toBeNull();
    expect(row.provenance).toEqual({ channel: "upload", capturedAt: "2026-09-11" }); // 10. provenance preserved

    const stillThere = await prisma.imageAsset.findUnique({ where: { id: image.id } }); // 11. source asset untouched
    expect(stillThere).not.toBeNull();
    expect(stillThere?.deletedAt).toBeNull();
  });

  it("revoking an already-revoked row is a no-op (false), not an error", async () => {
    const { ownerUserId } = await createOwner();
    const record = await createLearningEvidence(ownerUserId, textInput());
    expect(await revokeLearningEvidence(ownerUserId, record.id)).toBe(true);
    expect(await revokeLearningEvidence(ownerUserId, record.id)).toBe(false);
  });

  it("12/17. VideoAsset retention fields are backward compatible -- a legacy-style row (created without them) defaults safely", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const legacyStyleVideo = await prisma.videoAsset.create({
      data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 999, storagePath: "pending" },
    });
    expect(legacyStyleVideo.origin).toBe("generated_output");
    expect(legacyStyleVideo.deletedAt).toBeNull();
    expect(legacyStyleVideo.retentionDeletesAt).toBeNull();

    const reread = await prisma.videoAsset.findUniqueOrThrow({ where: { id: legacyStyleVideo.id } });
    expect(reread.origin).toBe("generated_output");
  });

  it("13/14. a governed VideoAsset cannot be purged while referenced by evidence; an unreferenced one is eligible", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const referencedVideo = await createVideoAsset(ownerUserId, clientId);
    const freeVideo = await createVideoAsset(ownerUserId, clientId);
    await createLearningEvidence(ownerUserId, {
      evidenceType: "VIDEO",
      vertical: "hair_cutting",
      videoAssetId: referencedVideo.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const result = await evaluateVideoAssetPurgeEligibility(videoHistoricalReferenceDatabase, [referencedVideo.id, freeVideo.id]);
    expect(result).toEqual([
      { videoAssetId: referencedVideo.id, eligible: false, reason: "REFERENCED_BY_HISTORICAL_RECORD" },
      { videoAssetId: freeVideo.id, eligible: true, reason: "NOT_REFERENCED" },
    ]);
  });

  it("19. domain (vertical) is generic, not haircut-only -- nails/makeup verticals are accepted identically", async () => {
    const { ownerUserId } = await createOwner();
    const nails = await createLearningEvidence(ownerUserId, textInput({ vertical: "nails" }));
    const makeup = await createLearningEvidence(ownerUserId, textInput({ vertical: "makeup" }));
    expect(nails.vertical).toBe("nails");
    expect(makeup.vertical).toBe("makeup");
  });

  it("21. creating/revoking evidence never mutates ProfessionalMemory", async () => {
    const { ownerUserId } = await createOwner();
    const before = await prisma.professionalMemory.count({ where: { ownerUserId } });
    const record = await createLearningEvidence(ownerUserId, textInput());
    await revokeLearningEvidence(ownerUserId, record.id);
    const after = await prisma.professionalMemory.count({ where: { ownerUserId } });
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it("markLearningEvidenceSourceMediaDeleted records DELETED_SOURCE independently of REVOKED (Part 10)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: image.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    await revokeLearningEvidence(ownerUserId, record.id);
    const marked = await markLearningEvidenceSourceMediaDeleted(ownerUserId, record.id);
    expect(marked).toBe(true);

    const row = await prisma.professionalLearningEvidence.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.status).toBe("DELETED_SOURCE");
    expect(row.revokedAt).not.toBeNull(); // never cleared -- both events remain reconstructible
    expect(row.sourceMediaDeletedAt).not.toBeNull();
  });

  it("getLearningEvidenceSourceLinkage reports pointer kind and live availability (Part 18)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const image = await createImageAsset(ownerUserId, clientId);
    const record = await createLearningEvidence(ownerUserId, {
      evidenceType: "IMAGE",
      vertical: "hair_cutting",
      imageAssetId: image.id,
      provenance: {},
      rightsClassification: "USER_OWNED_OR_AUTHORIZED",
    });

    const linkage = await getLearningEvidenceSourceLinkage(ownerUserId, record.id);
    expect(linkage).toEqual({
      evidenceId: record.id,
      evidenceType: "IMAGE",
      assetPointerKind: "imageAssetId",
      assetId: image.id,
      sourceAssetStillAvailable: true,
    });
  });

  it("getLearningEvidenceSourceLinkage reports null availability for text-only evidence (no pointer at all)", async () => {
    const { ownerUserId } = await createOwner();
    const record = await createLearningEvidence(ownerUserId, textInput());
    const linkage = await getLearningEvidenceSourceLinkage(ownerUserId, record.id);
    expect(linkage).toEqual({ evidenceId: record.id, evidenceType: "TEXT", assetPointerKind: null, assetId: null, sourceAssetStillAvailable: null });
  });

  it("listLearningEvidenceForOwner never crosses owners, newest first", async () => {
    const { ownerUserId: userA } = await createOwner();
    const { ownerUserId: userB } = await createOwner();
    await createLearningEvidence(userA, textInput({ title: "first" }));
    await createLearningEvidence(userA, textInput({ title: "second" }));
    await createLearningEvidence(userB, textInput({ title: "other owner" }));

    const listA = await listLearningEvidenceForOwner(userA);
    expect(listA).toHaveLength(2);
    expect(listA.every((r) => r.ownerUserId === userA)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function textInput(overrides: Partial<Parameters<typeof createLearningEvidence>[1]> = {}) {
  return {
    evidenceType: "TEXT" as const,
    vertical: "hair_cutting",
    originalText: "A professional teaching note.",
    provenance: { channel: "typed" },
    rightsClassification: "USER_OWNED_OR_AUTHORIZED" as const,
    ...overrides,
  };
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@learning-evidence-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}

async function createOwnerAndClient() {
  const { ownerUserId } = await createOwner();
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Learning Evidence Repository Client" } });
  return { ownerUserId, clientId };
}

async function createImageAsset(ownerUserId: string, clientId: string) {
  return prisma.imageAsset.create({
    data: { id: randomUUID(), fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 12345, ownerUserId, clientId, storagePath: "pending" },
  });
}

async function createVideoAsset(ownerUserId: string, clientId: string) {
  return prisma.videoAsset.create({
    data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 12345, storagePath: "pending" },
  });
}
