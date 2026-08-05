import { describe, expect, it } from "vitest";

import { getConfidenceBadgeVariant } from "./plan-base";

describe("getConfidenceBadgeVariant", () => {
  it("returns success at or above 0.7", () => {
    expect(getConfidenceBadgeVariant(0.7)).toBe("success");
    expect(getConfidenceBadgeVariant(0.95)).toBe("success");
  });

  it("returns warning between 0.4 and just under 0.7", () => {
    expect(getConfidenceBadgeVariant(0.4)).toBe("warning");
    expect(getConfidenceBadgeVariant(0.69)).toBe("warning");
  });

  it("returns danger below 0.4", () => {
    expect(getConfidenceBadgeVariant(0.39)).toBe("danger");
    expect(getConfidenceBadgeVariant(0)).toBe("danger");
  });
});
