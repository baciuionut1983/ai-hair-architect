import { describe, expect, it } from "vitest";

import {
  buildAnalysisRequest,
  canStartAnalysis,
  collectClarificationAnswers,
  DEFAULT_ANALYSIS_FORM,
  getRelevantFieldGroup,
  hasAnyClarificationAnswer
} from "./analysis-form-logic";

describe("getRelevantFieldGroup", () => {
  it("maps reshape to the cut field group", () => {
    expect(getRelevantFieldGroup("reshape")).toBe("cut");
  });

  it("maps cover and lighten to the color field group", () => {
    expect(getRelevantFieldGroup("cover")).toBe("color");
    expect(getRelevantFieldGroup("lighten")).toBe("color");
  });

  it("maps treat to the treatment field group", () => {
    expect(getRelevantFieldGroup("treat")).toBe("treatment");
  });

  it("maps the ambiguous refresh/correct goals, and no selection, to none", () => {
    expect(getRelevantFieldGroup("refresh")).toBe("none");
    expect(getRelevantFieldGroup("correct")).toBe("none");
    expect(getRelevantFieldGroup("")).toBe("none");
  });
});

describe("canStartAnalysis", () => {
  it("is false without a goal", () => {
    expect(canStartAnalysis(DEFAULT_ANALYSIS_FORM)).toBe(false);
  });

  it("is true once a goal is selected", () => {
    expect(canStartAnalysis({ ...DEFAULT_ANALYSIS_FORM, goal: "refresh" })).toBe(true);
  });
});

describe("buildAnalysisRequest", () => {
  it("returns null when no goal is selected", () => {
    expect(buildAnalysisRequest("client-1", DEFAULT_ANALYSIS_FORM)).toBeNull();
  });

  it("always includes the base required fields", () => {
    const request = buildAnalysisRequest("client-1", { ...DEFAULT_ANALYSIS_FORM, goal: "refresh" });
    expect(request).toEqual({
      clientId: "client-1",
      goal: "refresh",
      hairType: "medium",
      density: "medium",
      porosity: "medium"
    });
  });

  it("includes only cut fields for goal=reshape, omitting empty ones", () => {
    const request = buildAnalysisRequest("client-1", {
      ...DEFAULT_ANALYSIS_FORM,
      goal: "reshape",
      targetShape: "precision_bob",
      hairCondition: "virgin_healthy",
      desiredColorResult: "gray_coverage" // color field, must be dropped for a cut-group goal
    });

    expect(request).toEqual({
      clientId: "client-1",
      goal: "reshape",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      targetShape: "precision_bob",
      hairCondition: "virgin_healthy"
    });
  });

  it("includes only color fields (plus hairCondition) for goal=cover", () => {
    const request = buildAnalysisRequest("client-1", {
      ...DEFAULT_ANALYSIS_FORM,
      goal: "cover",
      desiredColorResult: "gray_coverage",
      grayPercentage: "high",
      targetShape: "precision_bob" // cut field, must be dropped for a color-group goal
    });

    expect(request).toEqual({
      clientId: "client-1",
      goal: "cover",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      desiredColorResult: "gray_coverage",
      grayPercentage: "high"
    });
  });

  it("includes only treatment fields (plus hairCondition) for goal=treat", () => {
    const request = buildAnalysisRequest("client-1", {
      ...DEFAULT_ANALYSIS_FORM,
      goal: "treat",
      treatmentGoalDetail: "hydration",
      scalpCondition: "dry",
      hairCondition: "fragile_breakage"
    });

    expect(request).toEqual({
      clientId: "client-1",
      goal: "treat",
      hairType: "medium",
      density: "medium",
      porosity: "medium",
      treatmentGoalDetail: "hydration",
      scalpCondition: "dry",
      hairCondition: "fragile_breakage"
    });
  });

  it("omits every conditional field for the ambiguous refresh/correct goals", () => {
    const request = buildAnalysisRequest("client-1", {
      ...DEFAULT_ANALYSIS_FORM,
      goal: "correct",
      targetShape: "precision_bob",
      desiredColorResult: "gray_coverage",
      treatmentGoalDetail: "hydration"
    });

    expect(request).toEqual({
      clientId: "client-1",
      goal: "correct",
      hairType: "medium",
      density: "medium",
      porosity: "medium"
    });
  });
});

describe("collectClarificationAnswers", () => {
  // Position-preserving: the backend (analyzeWithClarifications) matches
  // answers[i] against the question shown at index i. Dropping a blank
  // entry here would shift every later answer onto the wrong question.
  it("trims each answer but keeps blanks at their original index", () => {
    expect(collectClarificationAnswers(["  yes  ", "", "   ", "no bleach"])).toEqual(["yes", "", "", "no bleach"]);
  });

  it("returns an array of empty strings (not []) when every answer is blank", () => {
    expect(collectClarificationAnswers(["", "  "])).toEqual(["", ""]);
  });

  it("returns an empty array for an empty input array", () => {
    expect(collectClarificationAnswers([])).toEqual([]);
  });
});

describe("hasAnyClarificationAnswer", () => {
  it("is true when at least one answer is non-empty", () => {
    expect(hasAnyClarificationAnswer(["", "no bleach", ""])).toBe(true);
  });

  it("is false when every answer is empty", () => {
    expect(hasAnyClarificationAnswer(["", ""])).toBe(false);
  });

  it("is false for an empty array", () => {
    expect(hasAnyClarificationAnswer([])).toBe(false);
  });
});
