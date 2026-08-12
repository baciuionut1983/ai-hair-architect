import { describe, expect, it } from "vitest";

import { resolveAnalysisResultLoadStatus } from "./analysis-result-logic";

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
