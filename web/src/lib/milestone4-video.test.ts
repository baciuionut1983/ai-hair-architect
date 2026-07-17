import { describe, expect, it } from "vitest";

import {
  createVideoLessonJob,
  createUser,
  findRecommendedLessonIds,
  getVideoLessonByIdOwned,
  processVideoLessonJob
} from "./milestone1-store";

describe("milestone4 video pipeline", () => {
  it("queues and completes video lesson generation", () => {
    const user = createUser({
      email: `m4-video-${Date.now()}@example.com`,
      password: "password123",
      role: "professional",
      locale: "en"
    });

    const recommendedLessonIds = findRecommendedLessonIds("color");
    const queued = createVideoLessonJob({
      ownerUserId: user.id,
      topic: "Color correction",
      level: "intermediate",
      locale: "en",
      recommendedLessonIds
    });

    expect(queued.status).toBe("queued");

    const processed = processVideoLessonJob(queued.id);
    expect(processed?.status).toBe("completed");
    expect(processed?.videoUrl).toContain(queued.id);

    const loaded = getVideoLessonByIdOwned(queued.id, user.id);
    expect(loaded?.id).toBe(queued.id);
  });
});
