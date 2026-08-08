import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ authenticateSessionRequest: vi.fn() }));
const storeMock = vi.hoisted(() => ({
  findRecommendedLessonIds: vi.fn(),
  sanitize: vi.fn((value: unknown) => (typeof value === "string" ? value.trim() : "")),
}));
const repositoryMock = vi.hoisted(() => ({
  createVideoLessonRecord: vi.fn(),
  isVideoLessonPersistenceError: vi.fn(),
}));

vi.mock("@/lib/session-request-auth", () => authMock);
vi.mock("@/lib/milestone1-store", () => storeMock);
vi.mock("@/lib/video-lesson-repository", () => repositoryMock);

import { POST } from "./route";

const OWNER_A = { id: "owner-1", email: "owner-a@example.com", role: "professional", locale: "en" };

function invoke(body: unknown): Promise<Response> {
  const request = new Request("http://localhost/api/v1/video-lessons/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.authenticateSessionRequest.mockResolvedValue(OWNER_A);
  storeMock.sanitize.mockImplementation((value: unknown) => (typeof value === "string" ? value.trim() : ""));
  storeMock.findRecommendedLessonIds.mockReturnValue(["lesson-1"]);
  repositoryMock.isVideoLessonPersistenceError.mockReturnValue(false);
});

describe("POST /api/v1/video-lessons/generate", () => {
  it("returns 401 without a cookie, never touching the repository", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ topic: "Color correction" });

    expect(response.status).toBe(401);
    expect(repositoryMock.createVideoLessonRecord).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown or expired session (no in-memory fallback)", async () => {
    authMock.authenticateSessionRequest.mockResolvedValue(null);

    const response = await invoke({ topic: "Color correction" });

    expect(response.status).toBe(401);
  });

  it("returns 400 when topic is missing, never touching the repository", async () => {
    storeMock.sanitize.mockReturnValue("");

    const response = await invoke({});

    expect(response.status).toBe(400);
    expect(repositoryMock.createVideoLessonRecord).not.toHaveBeenCalled();
  });

  it("creates an honest not_generated record and returns 201, never fabricating a script or videoUrl", async () => {
    const createdAt = new Date("2026-08-04T10:00:00.000Z");
    repositoryMock.createVideoLessonRecord.mockResolvedValue({
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

    const response = await invoke({ topic: "Color correction" });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.videoLesson).toEqual({
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
    });
    expect(repositoryMock.createVideoLessonRecord).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      topic: "Color correction",
      level: "intermediate",
      locale: "en",
      recommendedLessonIds: ["lesson-1"],
    });
  });

  it("defaults level to intermediate and locale to en when not provided", async () => {
    repositoryMock.createVideoLessonRecord.mockResolvedValue({
      id: "video-1",
      ownerUserId: "owner-1",
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

    await invoke({ topic: "Color correction" });

    expect(repositoryMock.createVideoLessonRecord).toHaveBeenCalledWith(
      expect.objectContaining({ level: "intermediate", locale: "en" })
    );
  });

  it("is not idempotent: repeated calls each create an independent record", async () => {
    repositoryMock.createVideoLessonRecord.mockResolvedValue({
      id: "video-1",
      ownerUserId: "owner-1",
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

    await invoke({ topic: "Color correction" });
    await invoke({ topic: "Color correction" });

    expect(repositoryMock.createVideoLessonRecord).toHaveBeenCalledTimes(2);
  });

  it("returns the persistence error's own status when the repository is unavailable", async () => {
    const error = Object.assign(new Error("unavailable"), { code: "VIDEO_LESSON_PERSISTENCE_UNAVAILABLE", httpStatus: 503 });
    repositoryMock.createVideoLessonRecord.mockRejectedValue(error);
    repositoryMock.isVideoLessonPersistenceError.mockImplementation((value: unknown) => value === error);

    const response = await invoke({ topic: "Color correction" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "VIDEO_LESSON_PERSISTENCE_UNAVAILABLE" });
  });
});
