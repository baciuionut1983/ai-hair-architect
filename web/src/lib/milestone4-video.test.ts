import { describe, expect, it } from "vitest";

import { findRecommendedLessonIds } from "./milestone1-store";

describe("findRecommendedLessonIds", () => {
  it("returns academy lessons matching the topic keyword", () => {
    const recommendedLessonIds = findRecommendedLessonIds("color");
    expect(Array.isArray(recommendedLessonIds)).toBe(true);
  });

  it("returns at most 3 lesson ids", () => {
    const recommendedLessonIds = findRecommendedLessonIds("a");
    expect(recommendedLessonIds.length).toBeLessThanOrEqual(3);
  });
});
