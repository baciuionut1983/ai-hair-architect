import { describe, expect, it } from "vitest";

import { getButtonClasses } from "./button";

describe("getButtonClasses", () => {
  it("defaults to the primary variant", () => {
    expect(getButtonClasses()).toContain("bg-accent");
  });

  it("returns secondary variant classes", () => {
    expect(getButtonClasses("secondary")).toContain("bg-surface-alt");
  });

  it("returns danger variant classes", () => {
    expect(getButtonClasses("danger")).toContain("bg-danger");
  });

  it("returns ghost variant classes", () => {
    expect(getButtonClasses("ghost")).toContain("bg-transparent");
  });

  it("appends a caller-provided className", () => {
    expect(getButtonClasses("primary", "w-full")).toContain("w-full");
  });

  it("always includes the shared focus-visible ring for accessibility", () => {
    expect(getButtonClasses("ghost")).toContain("focus-visible:ring-2");
  });
});
