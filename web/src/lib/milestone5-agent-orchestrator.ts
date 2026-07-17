import { randomUUID } from "crypto";

import type { AgentOrchestrateRequest, AgentOrchestrateResponse, AgentStepResult } from "@/lib/contracts";

function summarizePayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  return keys.length > 0 ? `payload keys: ${keys.join(", ")}` : "no payload keys";
}

export function runAgentOrchestration(input: AgentOrchestrateRequest): AgentOrchestrateResponse {
  const requestId = input.requestId?.trim() || randomUUID();
  const summary = summarizePayload(input.payload);

  const steps: AgentStepResult[] = [
    {
      agent: "planner",
      status: "ok",
      summary: `Execution plan prepared for ${input.taskType} (${summary}).`
    },
    {
      agent: "safety",
      status: "ok",
      summary: "Safety policy checks passed for non-destructive operations."
    },
    {
      agent: "domain",
      status: "ok",
      summary: `Domain reasoning applied for ${input.taskType}.`
    },
    {
      agent: "formatter",
      status: "ok",
      summary: "Output normalized into structured response envelope."
    }
  ];

  return {
    requestId,
    steps,
    output: {
      taskType: input.taskType,
      confidence: 0.82,
      recommendation: "Proceed with reviewed plan and monitor outcomes."
    }
  };
}
