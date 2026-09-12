import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  createUploadSession,
  findUploadSessionForOwner,
  transitionUploadSessionStatus,
} from "@/lib/professional-learning-upload-session-repository";

// Professional Skill Engine, Stage 8.5L3.1 -- real Postgres, no mocks,
// mirroring capture-set-repository.test.ts's own conventions exactly.
// Skips (never fails) when no database is configured.
const suite = process.env.DATABASE_URL ? describe : describe.skip;
const owners = new Set<string>();

suite("professional-learning-upload-session-repository (durable upload session domain layer)", () => {
  afterEach(async () => {
    const ownerUserIds = [...owners];
    await prisma.professionalLearningUploadSession.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.client.deleteMany({ where: { ownerUserId: { in: ownerUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ownerUserIds } } });
    owners.clear();
  });

  it("1/5. creates a session for an authenticated owner, with a server-generated storage key", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const sessionId = randomUUID();

    const session = await createUploadSession(ownerUserId, sessionId, baseInput(clientId));

    expect(session.id).toBe(sessionId);
    expect(session.ownerUserId).toBe(ownerUserId);
    expect(session.purpose).toBe("PROFESSIONAL_LEARNING");
    expect(session.mediaKind).toBe("VIDEO");
    expect(session.status).toBe("INITIATED");
  });

  it("4. User B cannot read User A's session (fail-closed, indistinguishable from not-found)", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const { ownerUserId: userB } = await createOwner();
    const session = await createUploadSession(userA, randomUUID(), baseInput(clientId));

    expect(await findUploadSessionForOwner(userA, session.id)).not.toBeNull();
    expect(await findUploadSessionForOwner(userB, session.id)).toBeNull();
  });

  it("14. a repeated initiate (same sessionId) is idempotent -- returns the already-persisted session, not a duplicate", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const sessionId = randomUUID();

    const first = await createUploadSession(ownerUserId, sessionId, baseInput(clientId));
    const second = await createUploadSession(ownerUserId, sessionId, baseInput(clientId));

    expect(second.id).toBe(first.id);
    await expect(prisma.professionalLearningUploadSession.count({ where: { ownerUserId } })).resolves.toBe(1);
  });

  it("transitionUploadSessionStatus only applies from the exact expected prior status (concurrency-safe guard)", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const session = await createUploadSession(ownerUserId, randomUUID(), baseInput(clientId));

    const wrongFrom = await transitionUploadSessionStatus(ownerUserId, session.id, { from: ["COMPLETING"], to: "COMPLETED" });
    expect(wrongFrom).toBeNull();

    const correct = await transitionUploadSessionStatus(ownerUserId, session.id, { from: ["INITIATED"], to: "UPLOADING" });
    expect(correct?.status).toBe("UPLOADING");
  });

  it("4. User B cannot transition User A's session", async () => {
    const { ownerUserId: userA, clientId } = await createOwnerAndClient();
    const { ownerUserId: userB } = await createOwner();
    const session = await createUploadSession(userA, randomUUID(), baseInput(clientId));

    const result = await transitionUploadSessionStatus(userB, session.id, { from: ["INITIATED"], to: "ABORTED" });
    expect(result).toBeNull();

    const stillInitiated = await findUploadSessionForOwner(userA, session.id);
    expect(stillInitiated?.status).toBe("INITIATED");
  });

  it("22. a terminal transition (e.g. to ABORTED) persists its own timestamp field", async () => {
    const { ownerUserId, clientId } = await createOwnerAndClient();
    const session = await createUploadSession(ownerUserId, randomUUID(), baseInput(clientId));

    const abortedAt = new Date();
    const aborted = await transitionUploadSessionStatus(ownerUserId, session.id, { from: ["INITIATED"], to: "ABORTED", data: { abortedAt } });

    expect(aborted?.status).toBe("ABORTED");
    expect(aborted?.abortedAt).not.toBeNull();
  });
});

function baseInput(clientId: string) {
  return {
    clientId,
    fileName: "demonstration.mp4",
    contentType: "video/mp4",
    expectedSizeBytes: 50 * 1024 * 1024,
    storageBucketAlias: "primary-videos",
    storageKey: "v1/learning-videos/test",
    providerUploadId: "provider-upload-id-1",
    partSizeBytes: 16 * 1024 * 1024,
  };
}

async function createOwner() {
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: { id: ownerUserId, email: `${ownerUserId}@upload-session-repository.test`, passwordHash: "test", role: "professional", locale: "en" },
  });
  return { ownerUserId };
}

async function createOwnerAndClient() {
  const { ownerUserId } = await createOwner();
  const clientId = randomUUID();
  await prisma.client.create({ data: { id: clientId, ownerUserId, fullName: "Upload Session Repository Client" } });
  return { ownerUserId, clientId };
}
