import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import type { CreateMultipartUploadInput, CompleteMultipartUploadInput, ListPartsInput, MultipartUploadPart, PresignUploadPartInput, AbortMultipartUploadInput } from "@/lib/object-storage";
import { findUploadSessionForOwner, transitionUploadSessionStatus } from "@/lib/professional-learning-upload-session-repository";
import {
  abortVideoUploadSession,
  completeVideoUploadSession,
  initiateVideoUploadSession,
  listUploadedParts,
  requestUploadPartUrl,
  UploadSessionProviderError,
  UploadSessionStateError,
  UploadSessionValidationError,
  type VideoMultipartStorageDependencies,
} from "@/lib/professional-learning-video-multipart-upload-service";

// Professional Skill Engine, Stage 8.5L3.1 -- real Postgres for the
// session/evidence/asset rows (no mocking library, matching this repo's
// own established convention), a HAND-BUILT FAKE for the S3 multipart
// provider (no real/mock S3-compatible service exists in this
// environment -- see this stage's own final report). The fake faithfully
// reproduces the ONE real S3 behavior this orchestration depends on
// completely: CompleteMultipartUpload fails if a reported ETag does not
// match what was actually "uploaded" for that part.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

interface FakeUpload {
  key: string;
  contentType: string;
  parts: Map<number, { etag: string; sizeBytes: number }>;
  completed: boolean;
}

interface FakeObject {
  sizeBytes: number;
  contentType: string;
  versionId: string;
  etag: string;
}

function createFakeMultipartStorage() {
  const uploads = new Map<string, FakeUpload>();
  const objects = new Map<string, FakeObject>();
  let counter = 0;

  const storage: VideoMultipartStorageDependencies["storage"] = {
    createMultipartUpload: async (input: CreateMultipartUploadInput) => {
      counter += 1;
      const uploadId = `fake-upload-${counter}`;
      uploads.set(uploadId, { key: input.key, contentType: input.contentType, parts: new Map(), completed: false });
      return { bucketAlias: "primary-videos", key: input.key, uploadId };
    },
    presignUploadPart: async (input: PresignUploadPartInput, expiresInSeconds: number) =>
      `https://fake-s3.test/${input.key}?uploadId=${input.uploadId}&partNumber=${input.partNumber}&expires=${expiresInSeconds}`,
    listParts: async (input: ListPartsInput): Promise<readonly MultipartUploadPart[]> => {
      const upload = uploads.get(input.uploadId);
      if (!upload) throw new Error("NoSuchUpload");
      return [...upload.parts.entries()].map(([partNumber, part]) => ({ partNumber, etag: part.etag }));
    },
    completeMultipartUpload: async (input: CompleteMultipartUploadInput) => {
      const upload = uploads.get(input.uploadId);
      if (!upload || upload.completed) throw new Error("NoSuchUpload");
      // The real S3 behavior this fake exists to reproduce: reject if any
      // reported part does not match what was actually uploaded.
      for (const part of input.parts) {
        const real = upload.parts.get(part.partNumber);
        if (!real || real.etag !== part.etag) throw new Error("InvalidPart");
      }
      upload.completed = true;
      const totalSize = input.parts.reduce((sum, part) => sum + (upload.parts.get(part.partNumber)?.sizeBytes ?? 0), 0);
      objects.set(input.key, { sizeBytes: totalSize, contentType: upload.contentType, versionId: "fake-version-1", etag: "fake-composite-etag" });
      return { bucketAlias: "primary-videos", key: input.key, versionId: "fake-version-1", etag: "fake-composite-etag" };
    },
    abortMultipartUpload: async (input: AbortMultipartUploadInput) => {
      uploads.delete(input.uploadId);
    },
    head: async (input: { bucketAlias: string; key: string }) => {
      const object = objects.get(input.key);
      if (!object) throw new Error("NotFound");
      return { bucketAlias: input.bucketAlias, key: input.key, versionId: object.versionId, etag: object.etag, contentSha256: null, sizeBytes: object.sizeBytes, contentType: object.contentType };
    },
  };

  return {
    storage,
    // Test-only helper simulating the browser's own direct-to-S3 part
    // upload (the one thing this application never does itself).
    simulateBrowserUploadPart(uploadId: string, partNumber: number, sizeBytes: number): string {
      const upload = uploads.get(uploadId);
      if (!upload) throw new Error("no such upload in fake");
      const etag = `fake-etag-${uploadId}-${partNumber}`;
      upload.parts.set(partNumber, { etag, sizeBytes });
      return etag;
    },
  };
}

suite("professional-learning-video-multipart-upload-service (real Postgres + fake S3)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningEvidence.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.videoAsset.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.professionalLearningUploadSession.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("8. initiates a real session and a real (fake) provider multipart upload", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();

    const { session, plan } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId), { storage: fake.storage });

    expect(session.status).toBe("INITIATED");
    expect(session.providerUploadId).toBeTruthy();
    expect(plan.partCount).toBe(1);
  });

  it("9/10. requesting a part URL twice for the same part is safe (retry), and transitions to UPLOADING", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId), { storage: fake.storage });

    const first = await requestUploadPartUrl(ownerUserId, session.id, 1, { storage: fake.storage });
    const second = await requestUploadPartUrl(ownerUserId, session.id, 1, { storage: fake.storage });

    expect(first.url).toContain("partNumber=1");
    expect(second.url).toContain("partNumber=1");
    const updated = await findUploadSessionForOwner(ownerUserId, session.id);
    expect(updated?.status).toBe("UPLOADING");
  });

  it("11. rejects an out-of-range part number", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId), { storage: fake.storage });

    const error = await requestUploadPartUrl(ownerUserId, session.id, 99, { storage: fake.storage }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadSessionValidationError);
    expect((error as UploadSessionValidationError).code).toBe("PART_NUMBER_OUT_OF_RANGE");
  });

  it("3. User B cannot request a part URL for User A's session", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const { ownerUserId: userB } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(userA, randomUUID(), initInput(clientId), { storage: fake.storage });

    const error = await requestUploadPartUrl(userB, session.id, 1, { storage: fake.storage }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadSessionStateError);
    expect((error as UploadSessionStateError).code).toBe("SESSION_NOT_FOUND");
  });

  it("12/17/18/19/26. a real, correct part list completes: object verified, VideoAsset(origin=uploaded_source) and evidence are created once", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const sizeBytes = 2048;
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId, sizeBytes), { storage: fake.storage });
    const etag = fake.simulateBrowserUploadPart(session.providerUploadId!, 1, sizeBytes);

    const { evidence } = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag }] }, { storage: fake.storage });

    expect(evidence.evidenceType).toBe("VIDEO");
    expect(evidence.visibilityScope).toBe("PRIVATE_LEARNING_EVIDENCE");
    const asset = await prisma.videoAsset.findUniqueOrThrow({ where: { id: evidence.videoAssetId! } });
    expect(asset.origin).toBe("uploaded_source");
    expect(asset.sizeBytes).toBe(sizeBytes);

    const completedSession = await findUploadSessionForOwner(ownerUserId, session.id);
    expect(completedSession?.status).toBe("COMPLETED");
    expect(completedSession?.evidenceId).toBe(evidence.id);

    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("13. rejects completion with a missing part -- the full plan must be covered exactly once", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const size = 32 * 1024 * 1024; // spans 2 parts at the fixed 16MB part size
    const { session, plan } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId, size), { storage: fake.storage });
    expect(plan.partCount).toBe(2);
    const etag1 = fake.simulateBrowserUploadPart(session.providerUploadId!, 1, plan.partSizeBytes);
    fake.simulateBrowserUploadPart(session.providerUploadId!, 2, plan.lastPartSizeBytes);

    const error = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag: etag1 }] }, { storage: fake.storage }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadSessionValidationError);
    expect((error as UploadSessionValidationError).code).toBe("INCOMPLETE_PARTS_LIST");
    await expect(prisma.videoAsset.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("14. rejects completion with a forged ETag -- the provider itself rejects it, never merely trusted client-side", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId), { storage: fake.storage });
    fake.simulateBrowserUploadPart(session.providerUploadId!, 1, 1024);

    const error = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag: "forged-etag-never-really-uploaded" }] }, { storage: fake.storage }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(UploadSessionProviderError);
    expect((error as UploadSessionProviderError).code).toBe("PROVIDER_COMPLETE_FAILED");
    const failed = await findUploadSessionForOwner(ownerUserId, session.id);
    expect(failed?.status).toBe("FAILED");
    await expect(prisma.videoAsset.count({ where: { ownerUserId } })).resolves.toBe(0);
  });

  it("16. rejects completion when the verified object size does not match the declared size", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId, 2048), { storage: fake.storage });
    // Uploads fewer real bytes than declared -- the fake's own head()
    // reports the REAL assembled size, exposing the mismatch.
    const etag = fake.simulateBrowserUploadPart(session.providerUploadId!, 1, 100);

    const error = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag }] }, { storage: fake.storage }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadSessionValidationError);
    expect((error as UploadSessionValidationError).code).toBe("SIZE_MISMATCH");
    const failed = await findUploadSessionForOwner(ownerUserId, session.id);
    expect(failed?.status).toBe("FAILED");
  });

  it("20. completion retry after success is idempotent -- returns the SAME evidence, never a duplicate", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId, 1024), { storage: fake.storage });
    const etag = fake.simulateBrowserUploadPart(session.providerUploadId!, 1, 1024);

    const first = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag }] }, { storage: fake.storage });
    const second = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag }] }, { storage: fake.storage });

    expect(second.evidence.id).toBe(first.evidence.id);
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId } })).resolves.toBe(1);
    await expect(prisma.videoAsset.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("21. a retry after DB finalization already recorded the VideoAsset never creates a second one", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId, 1024), { storage: fake.storage });
    const etag = fake.simulateBrowserUploadPart(session.providerUploadId!, 1, 1024);

    // Simulate "storage completed, VideoAsset created, but the process
    // crashed before the final COMPLETED transition" -- move the session
    // to COMPLETING with a videoAssetId already recorded, exactly the
    // shape a real partial-DB-finalization failure would leave behind.
    const video = await prisma.videoAsset.create({
      data: { id: randomUUID(), ownerUserId, clientId, mimeType: "video/mp4", sizeBytes: 1024, storagePath: session.storageKey, origin: "uploaded_source" },
    });
    await transitionUploadSessionStatus(ownerUserId, session.id, { from: ["INITIATED"], to: "COMPLETING", data: { videoAssetId: video.id } });

    const { evidence } = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag }] }, { storage: fake.storage });

    expect(evidence.videoAssetId).toBe(video.id);
    await expect(prisma.videoAsset.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("9. resume: listUploadedParts reports exactly the parts the fake provider actually has", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId, 32 * 1024 * 1024), { storage: fake.storage });
    fake.simulateBrowserUploadPart(session.providerUploadId!, 1, 16 * 1024 * 1024);

    const parts = await listUploadedParts(ownerUserId, session.id, { storage: fake.storage });

    expect(parts.map((p) => p.partNumber)).toEqual([1]);
  });

  it("23/24. abort marks the session ABORTED, aborts the provider upload, and creates no evidence", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const fake = createFakeMultipartStorage();
    const { session } = await initiateVideoUploadSession(ownerUserId, randomUUID(), initInput(clientId), { storage: fake.storage });

    await abortVideoUploadSession(ownerUserId, session.id, { storage: fake.storage });

    const aborted = await findUploadSessionForOwner(ownerUserId, session.id);
    expect(aborted?.status).toBe("ABORTED");
    expect(aborted?.abortedAt).not.toBeNull();
    await expect(prisma.professionalLearningEvidence.count({ where: { ownerUserId } })).resolves.toBe(0);

    // A completion attempt on an aborted session must fail, never
    // silently succeed.
    const error = await completeVideoUploadSession(ownerUserId, session.id, { parts: [{ partNumber: 1, etag: "x" }] }, { storage: fake.storage }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadSessionStateError);
    expect((error as UploadSessionStateError).code).toBe("SESSION_TERMINAL");
  });
});

function initInput(clientId: string, expectedSizeBytes = 1024) {
  return { clientId, fileName: "demonstration.mp4", contentType: "video/mp4", expectedSizeBytes };
}

async function createOwnerAndClient() {
  const ownerUserId = randomUUID();
  const clientId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@video-multipart-upload-service.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Video Multipart Upload Service Client" } });
  return { ownerUserId, clientId };
}
