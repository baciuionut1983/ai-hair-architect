import { NextResponse } from "next/server";

import type { AgentOrchestrateRequest } from "@/lib/contracts";
import { checkRateLimit, ensureRequestId } from "@/lib/hardening";
import { createAuditEvent } from "@/lib/milestone1-store";
import { runAgentOrchestration } from "@/lib/milestone5-agent-orchestrator";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`agents-orchestrate:${sessionUser.id}`, 40, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const body = (await request.json()) as Partial<AgentOrchestrateRequest>;
  if (!body.taskType || !body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "Invalid orchestration payload." }, { status: 400 });
  }

  const requestId = ensureRequestId(body.requestId ?? request.headers.get("x-request-id"));

  const result = runAgentOrchestration({
    taskType: body.taskType,
    requestId,
    payload: body.payload
  });

  createAuditEvent({
    ownerUserId: sessionUser.id,
    requestId: result.requestId,
    module: "agents",
    action: "orchestration_executed",
    metadata: {
      taskType: body.taskType,
      steps: result.steps.length
    }
  });

  return NextResponse.json(result, { status: 200 });
}
