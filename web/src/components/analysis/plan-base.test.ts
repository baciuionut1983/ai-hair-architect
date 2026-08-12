import { describe, expect, it } from "vitest";

import { formatPlanConfidenceLabel, getConfidenceBadgeVariant } from "./plan-base";

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

describe("formatPlanConfidenceLabel", () => {
  it("labels a haircut plan's confidence distinctly from the overall analysis score", () => {
    expect(formatPlanConfidenceLabel("Haircut plan", 0.76)).toBe("Haircut plan confidence: 76%");
  });

  it("labels a color plan", () => {
    expect(formatPlanConfidenceLabel("Color plan", 0.9)).toBe("Color plan confidence: 90%");
  });

  it("labels a treatment plan", () => {
    expect(formatPlanConfidenceLabel("Treatment plan", 0.58)).toBe("Treatment plan confidence: 58%");
  });

  it("rounds to the nearest whole percent", () => {
    expect(formatPlanConfidenceLabel("Haircut plan", 0.865)).toBe("Haircut plan confidence: 87%");
    expect(formatPlanConfidenceLabel("Haircut plan", 0.601)).toBe("Haircut plan confidence: 60%");
  });
});
