import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const repositoryMock = vi.hoisted(() => ({
  getVideoLessonRecordById: vi.fn(),
  isVideoLessonPersistenceError: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/video-lesson-repository", () => repositoryMock);

import { GET } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

function invoke(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/v1/video-lessons/${id}`, { method: "GET" });
  return GET(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  repositoryMock.isVideoLessonPersistenceError.mockReturnValue(false);
});

describe("GET /api/v1/video-lessons/[id]", () => {
  it("returns 401 without a cookie, never touching the repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("video-1");

    expect(response.status).toBe(401);
    expect(repositoryMock.getVideoLessonRecordById).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke("video-1");

    expect(response.status).toBe(401);
  });

  it("returns 404 when no record exists for the id", async () => {
    repositoryMock.getVideoLessonRecordById.mockResolvedValue(null);

    const response = await invoke("missing");

    expect(response.status).toBe(404);
  });

  it("returns the same 404 (not 403) when the record belongs to another owner", async () => {
    repositoryMock.getVideoLessonRecordById.mockResolvedValue({
      id: "video-1",
      ownerUserId: "someone-else",
      topic: "Color correction",
      level: "intermediate",
      locale: "en",
      status: "not_generated",
      recommendedLessonIds: [],
      script: null,
      videoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await invoke("video-1");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Video lesson not found." });
  });

  it("returns 200 with the honest record shape when owned by the caller", async () => {
    const createdAt = new Date("2026-08-04T10:00:00.000Z");
    repositoryMock.getVideoLessonRecordById.mockResolvedValue({
      id: "video-1",
      ownerUserId: "owner-1",
      topic: "Color correction",
      level: "intermediate",
      locale: "en",
      status: "not_generated",
      recommendedLessonIds: ["lesson-1"],
      script: null,
      videoUrl: null,
      createdAt,
      updatedAt: createdAt,
    });

    const response = await invoke("video-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      videoLesson: {
        id: "video-1",
        ownerUserId: "owner-1",
        topic: "Color correction",
        level: "intermediate",
        locale: "en",
        status: "not_generated",
        recommendedLessonIds: ["lesson-1"],
        script: null,
        videoUrl: null,
        createdAt: createdAt.toISOString(),
        completedAt: null,
      },
    });
  });

  it("returns the persistence error's own status when the repository is unavailable", async () => {
    const error = Object.assign(new Error("unavailable"), { code: "VIDEO_LESSON_PERSISTENCE_UNAVAILABLE", httpStatus: 503 });
    repositoryMock.getVideoLessonRecordById.mockRejectedValue(error);
    repositoryMock.isVideoLessonPersistenceError.mockImplementation((value: unknown) => value === error);

    const response = await invoke("video-1");

    expect(response.status).toBe(503);
  });
});
