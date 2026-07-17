import { describe, expect, it } from "vitest";

import { getAcademyCategories, getAcademyLessonById, getAcademyLessons } from "./milestone1-store";

describe("milestone4 academy module", () => {
  it("loads taxonomy categories and category lessons", () => {
    const categories = getAcademyCategories();
    expect(categories.length).toBeGreaterThan(3);

    const colorCategory = categories.find((entry) => entry.key === "color");
    expect(colorCategory).toBeDefined();

    const lessons = getAcademyLessons(colorCategory?.id);
    expect(lessons.length).toBeGreaterThan(0);

    const lesson = getAcademyLessonById(lessons[0].id);
    expect(lesson?.id).toBe(lessons[0].id);
  });
});
