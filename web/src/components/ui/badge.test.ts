import { describe, expect, it } from "vitest";

import { getBadgeClasses } from "./badge";

describe("getBadgeClasses", () => {
  it("defaults to the neutral variant", () => {
    expect(getBadgeClasses()).toContain("bg-surface-alt");
  });

  it("returns success variant classes", () => {
    expect(getBadgeClasses("success")).toContain("text-success");
  });

  it("returns warning variant classes", () => {
    expect(getBadgeClasses("warning")).toContain("text-warning");
  });

  it("returns danger variant classes", () => {
    expect(getBadgeClasses("danger")).toContain("text-danger");
  });

  it("appends a caller-provided className", () => {
    expect(getBadgeClasses("neutral", "ml-2")).toContain("ml-2");
  });
});
