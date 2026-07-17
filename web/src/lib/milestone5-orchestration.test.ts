import { describe, expect, it } from "vitest";

import { runAgentOrchestration } from "./milestone5-agent-orchestrator";

describe("milestone5 orchestration", () => {
  it("returns deterministic multi-agent steps and output envelope", () => {
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
    expect(result.output.taskType).toBe("consultation");
  });
});
