import { randomUUID } from "crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasRealDatabase = Boolean(process.env.TEST_DATABASE_URL);

const prismaMocks = vi.hoisted(() => ({
  configured: true,
  videoLessonCreate: vi.fn(),
  videoLessonFindUnique: vi.fn(),
  videoLessonCount: vi.fn(),
}));

vi.mock("@/lib/prisma", async (importOriginal) => {
  if (process.env.TEST_DATABASE_URL) {
    return importOriginal();
  }
  return {
    isDatabaseConfigured: () => prismaMocks.configured,
    prisma: {
      videoLesson: {
        create: prismaMocks.videoLessonCreate,
        findUnique: prismaMocks.videoLessonFindUnique,
        count: prismaMocks.videoLessonCount,
      },
    },
  };
});

import {
  VIDEO_LESSON_STATUS_NOT_GENERATED,
  VideoLessonPersistenceError,
  countVideoLessonsForOwner,
  createVideoLessonRecord,
  getVideoLessonRecordById,
  isVideoLessonPersistenceError,
} from "./video-lesson-repository";

const unitSuite = hasRealDatabase ? describe.skip : describe;
const integrationSuite = hasRealDatabase ? describe : describe.skip;

unitSuite("video-lesson-repository (mocked)", () => {
  beforeEach(() => {
    prismaMocks.configured = true;
    prismaMocks.videoLessonCreate.mockReset();
    prismaMocks.videoLessonFindUnique.mockReset();
    prismaMocks.videoLessonCount.mockReset();
  });

  it("keeps the honest no-generation status constant exactly as frozen", () => {
    expect(VIDEO_LESSON_STATUS_NOT_GENERATED).toBe("not_generated");
  });

  it("creates a row with an honest status and null script/videoUrl, never fabricating either", async () => {
    const input = {
      ownerUserId: "owner-1",
      topic: "Color correction",
      level: "intermediate",
      locale: "en",
      recommendedLessonIds: ["lesson-1", "lesson-2"],
    };
    prismaMocks.videoLessonCreate.mockResolvedValue({ id: "video-1", ...input, status: VIDEO_LESSON_STATUS_NOT_GENERATED, script: null, videoUrl: null });

    await createVideoLessonRecord(input);

    expect(prismaMocks.videoLessonCreate).toHaveBeenCalledWith({
      data: {
        ownerUserId: "owner-1",
        topic: "Color correction",
        level: "intermediate",
        locale: "en",
        status: VIDEO_LESSON_STATUS_NOT_GENERATED,
        recommendedLessonIds: ["lesson-1", "lesson-2"],
        script: null,
        videoUrl: null,
      },
    });
  });

  it("returns the created row as-is", async () => {
    const created = {
      id: "video-1",
      ownerUserId: "owner-1",
      topic: "Color correction",
      level: "intermediate",
      locale: "en",
      status: VIDEO_LESSON_STATUS_NOT_GENERATED,
      recommendedLessonIds: [],
      script: null,
      videoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prismaMocks.videoLessonCreate.mockResolvedValue(created);

    await expect(
      createVideoLessonRecord({
        ownerUserId: "owner-1",
        topic: "Color correction",
        level: "intermediate",
        locale: "en",
        recommendedLessonIds: [],
      })
    ).resolves.toEqual(created);
  });

  it("throws VideoLessonPersistenceError on create when the database is not configured, never calling prisma", async () => {
    prismaMocks.configured = false;

    await expect(
      createVideoLessonRecord({
        ownerUserId: "owner-1",
        topic: "Color correction",
        level: "intermediate",
        locale: "en",
        recommendedLessonIds: [],
      })
    ).rejects.toBeInstanceOf(VideoLessonPersistenceError);
    expect(prismaMocks.videoLessonCreate).not.toHaveBeenCalled();
  });

  it("wraps an unexpected Prisma error from create into VideoLessonPersistenceError", async () => {
    prismaMocks.videoLessonCreate.mockRejectedValue(new Error("connection reset"));

    await expect(
      createVideoLessonRecord({
        ownerUserId: "owner-1",
        topic: "Color correction",
        level: "intermediate",
        locale: "en",
        recommendedLessonIds: [],
      })
    ).rejects.toBeInstanceOf(VideoLessonPersistenceError);
  });

  it("looks up a row by id and returns it when found", async () => {
    const row = { id: "video-1", ownerUserId: "owner-1" };
    prismaMocks.videoLessonFindUnique.mockResolvedValue(row);

    await expect(getVideoLessonRecordById("video-1")).resolves.toEqual(row);
    expect(prismaMocks.videoLessonFindUnique).toHaveBeenCalledWith({ where: { id: "video-1" } });
  });

  it("returns null when no row matches the id, without throwing", async () => {
    prismaMocks.videoLessonFindUnique.mockResolvedValue(null);

    await expect(getVideoLessonRecordById("missing")).resolves.toBeNull();
  });

  it("throws VideoLessonPersistenceError on getById when the database is not configured", async () => {
    prismaMocks.configured = false;

    await expect(getVideoLessonRecordById("video-1")).rejects.toBeInstanceOf(VideoLessonPersistenceError);
    expect(prismaMocks.videoLessonFindUnique).not.toHaveBeenCalled();
  });

  it("wraps an unexpected Prisma error from getById into VideoLessonPersistenceError", async () => {
    prismaMocks.videoLessonFindUnique.mockRejectedValue(new Error("connection reset"));

    await expect(getVideoLessonRecordById("video-1")).rejects.toBeInstanceOf(VideoLessonPersistenceError);
  });

  it("isVideoLessonPersistenceError distinguishes this error type from any other", () => {
    expect(isVideoLessonPersistenceError(new VideoLessonPersistenceError())).toBe(true);
    expect(isVideoLessonPersistenceError(new Error("other"))).toBe(false);
    expect(isVideoLessonPersistenceError("not an error")).toBe(false);
  });

  it("counts rows scoped to the given owner", async () => {
    prismaMocks.videoLessonCount.mockResolvedValue(3);

    await expect(countVideoLessonsForOwner("owner-1")).resolves.toBe(3);
    expect(prismaMocks.videoLessonCount).toHaveBeenCalledWith({ where: { ownerUserId: "owner-1" } });
  });

  it("throws VideoLessonPersistenceError on count when the database is not configured", async () => {
    prismaMocks.configured = false;

    await expect(countVideoLessonsForOwner("owner-1")).rejects.toBeInstanceOf(VideoLessonPersistenceError);
    expect(prismaMocks.videoLessonCount).not.toHaveBeenCalled();
  });
});

integrationSuite("video-lesson-repository (real Postgres)", () => {
  const owners = new Set<string>();

  afterEach(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.videoLesson.deleteMany({ where: { ownerUserId: { in: [...owners] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...owners] } } });
    owners.clear();
  });

  it("persists an honest row: not_generated status, null script and videoUrl, real recommendations", async () => {
    const ownerUserId = await createOwner(owners);

    const created = await createVideoLessonRecord({
      ownerUserId,
      topic: "Balayage foundations",
      level: "advanced",
      locale: "ro",
      recommendedLessonIds: ["lesson-a", "lesson-b"],
    });

    expect(created.status).toBe(VIDEO_LESSON_STATUS_NOT_GENERATED);
    expect(created.script).toBeNull();
    expect(created.videoUrl).toBeNull();
    expect(created.ownerUserId).toBe(ownerUserId);
    expect(created.topic).toBe("Balayage foundations");
    expect(created.level).toBe("advanced");
    expect(created.locale).toBe("ro");
    expect(created.recommendedLessonIds).toEqual(["lesson-a", "lesson-b"]);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  it("round-trips an empty recommendedLessonIds array", async () => {
    const ownerUserId = await createOwner(owners);

    const created = await createVideoLessonRecord({
      ownerUserId,
      topic: "No matches topic",
      level: "beginner",
      locale: "en",
      recommendedLessonIds: [],
    });

    expect(created.recommendedLessonIds).toEqual([]);
  });

  it("retrieves a previously created row by id with all fields intact", async () => {
    const ownerUserId = await createOwner(owners);
    const created = await createVideoLessonRecord({
      ownerUserId,
      topic: "Keratin aftercare",
      level: "intermediate",
      locale: "en",
      recommendedLessonIds: ["lesson-x"],
    });

    const fetched = await getVideoLessonRecordById(created.id);

    expect(fetched).toEqual(created);
  });

  it("returns null for a well-formed but non-existent id", async () => {
    await expect(getVideoLessonRecordById(randomUUID())).resolves.toBeNull();
  });

  it("creates independent rows on repeated calls for the same owner and topic (no dedup/idempotency at the data layer)", async () => {
    const ownerUserId = await createOwner(owners);
    const input = { ownerUserId, topic: "Repeat topic", level: "beginner", locale: "en", recommendedLessonIds: [] };

    const first = await createVideoLessonRecord(input);
    const second = await createVideoLessonRecord(input);

    expect(first.id).not.toBe(second.id);

    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.videoLesson.count({ where: { ownerUserId, topic: "Repeat topic" } });
    expect(count).toBe(2);
  });

  it("counts only the requesting owner's rows, ignoring other owners", async () => {
    const ownerA = await createOwner(owners);
    const ownerB = await createOwner(owners);
    await createVideoLessonRecord({ ownerUserId: ownerA, topic: "A1", level: "beginner", locale: "en", recommendedLessonIds: [] });
    await createVideoLessonRecord({ ownerUserId: ownerA, topic: "A2", level: "beginner", locale: "en", recommendedLessonIds: [] });
    await createVideoLessonRecord({ ownerUserId: ownerB, topic: "B1", level: "beginner", locale: "en", recommendedLessonIds: [] });

    await expect(countVideoLessonsForOwner(ownerA)).resolves.toBe(2);
    await expect(countVideoLessonsForOwner(ownerB)).resolves.toBe(1);
  });

  it("returns 0 for an owner with no video lessons", async () => {
    const ownerUserId = await createOwner(owners);
    await expect(countVideoLessonsForOwner(ownerUserId)).resolves.toBe(0);
  });

  it("fails closed with VideoLessonPersistenceError when ownerUserId references no real user (FK enforced)", async () => {
    await expect(
      createVideoLessonRecord({
        ownerUserId: randomUUID(),
        topic: "Orphaned request",
        level: "beginner",
        locale: "en",
        recommendedLessonIds: [],
      })
    ).rejects.toBeInstanceOf(VideoLessonPersistenceError);
  });

  it("blocks deleting a user who still owns a video lesson row (onDelete: Restrict)", async () => {
    const ownerUserId = await createOwner(owners);
    await createVideoLessonRecord({
      ownerUserId,
      topic: "Blocks owner deletion",
      level: "beginner",
      locale: "en",
      recommendedLessonIds: [],
    });

    const { prisma } = await import("@/lib/prisma");
    await expect(prisma.user.delete({ where: { id: ownerUserId } })).rejects.toBeTruthy();
  });
});

async function createOwner(owners: Set<string>): Promise<string> {
  const { prisma } = await import("@/lib/prisma");
  const ownerUserId = randomUUID();
  owners.add(ownerUserId);
  await prisma.user.create({
    data: {
      id: ownerUserId,
      email: `${ownerUserId}@video-lesson.test`,
      passwordHash: "test",
      role: "professional",
      locale: "en",
    },
  });
  return ownerUserId;
}
