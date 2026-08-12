import { describe, expect, it } from "vitest";

import { formatOverallConfidenceLabel, resolveAnalysisResultLoadStatus } from "./analysis-result-logic";

describe("resolveAnalysisResultLoadStatus", () => {
  it("maps a 404 to not-found", () => {
    expect(resolveAnalysisResultLoadStatus({ ok: false, status: 404 })).toBe("not-found");
  });

  it("maps any other non-ok status to error", () => {
    expect(resolveAnalysisResultLoadStatus({ ok: false, status: 500 })).toBe("error");
    expect(resolveAnalysisResultLoadStatus({ ok: false, status: 401 })).toBe("error");
  });

  it("maps an ok response to ready", () => {
    expect(resolveAnalysisResultLoadStatus({ ok: true, status: 200 })).toBe("ready");
  });

  it("an owner-mismatched analysis (scoped 404 from the API) resolves the same as a truly missing one", () => {
    expect(resolveAnalysisResultLoadStatus({ ok: false, status: 404 })).toBe("not-found");
  });
});

describe("formatOverallConfidenceLabel", () => {
  it("labels the overall analysis score distinctly from any plan's own confidence", () => {
    expect(formatOverallConfidenceLabel(0.87)).toBe("Overall analysis confidence: 87%");
  });

  it("rounds to the nearest whole percent", () => {
    expect(formatOverallConfidenceLabel(0.625)).toBe("Overall analysis confidence: 63%");
  });
});
