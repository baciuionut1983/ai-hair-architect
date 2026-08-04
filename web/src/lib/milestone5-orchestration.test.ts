import { describe, expect, it } from "vitest";

import { runAgentOrchestration } from "./milestone5-agent-orchestrator";

describe("milestone5 orchestration", () => {
  it("never reports status ok: every step is honestly skipped since no real agent runs", () => {
    const result = runAgentOrchestration({
      taskType: "consultation",
      requestId: "req-123",
      payload: { goal: "refresh", risk: "low" }
    });

    expect(result.requestId).toBe("req-123");
    expect(result.steps.length).toBe(4);
    expect(result.steps.map((item) => item.agent)).toEqual([
      "planner",
      "safety",
      "domain",
      "formatter"
    ]);
    for (const step of result.steps) {
      expect(step.status).toBe("skipped");
      expect(step.summary.toLowerCase()).toContain("no real");
    }
  });

  it("never claims a safety check passed", () => {
    const result = runAgentOrchestration({
      taskType: "analysis",
      payload: {}
    });

    const safetyStep = result.steps.find((item) => item.agent === "safety");
    expect(safetyStep?.status).toBe("skipped");
    expect(safetyStep?.summary).not.toMatch(/passed|checks passed/i);
  });

  it("never fabricates a confidence score or a recommendation", () => {
    const result = runAgentOrchestration({
      taskType: "marketplace",
      payload: { anything: true }
    });

    expect(result.output).not.toHaveProperty("confidence");
    expect(result.output).not.toHaveProperty("recommendation");
    expect(result.output.status).toBe("not_available");
    expect(result.output.taskType).toBe("marketplace");
  });

  it("generates a requestId when none is provided", () => {
    const result = runAgentOrchestration({ taskType: "analysis", payload: {} });
    expect(result.requestId).toEqual(expect.any(String));
    expect(result.requestId.length).toBeGreaterThan(0);
  });

  it("trims a blank requestId and generates a new one instead of returning empty", () => {
    const result = runAgentOrchestration({ taskType: "analysis", requestId: "   ", payload: {} });
    expect(result.requestId.trim().length).toBeGreaterThan(0);
    expect(result.requestId).not.toBe("   ");
  });

  it("is deterministic in shape across different payloads (no hidden state, no side effects)", () => {
    const first = runAgentOrchestration({ taskType: "analysis", requestId: "same-id", payload: { a: 1 } });
    const second = runAgentOrchestration({ taskType: "analysis", requestId: "same-id", payload: { b: 2, c: 3 } });

    expect(first.steps).toEqual(second.steps);
    expect(first.output).toEqual(second.output);
  });
});
