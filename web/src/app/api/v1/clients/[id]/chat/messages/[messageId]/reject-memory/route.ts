import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import {
  isConsultationMessagePersistenceError,
  markConsultationMessageMemoryDecision,
} from "@/lib/consultation-message-repository";
import { checkRateLimit } from "@/lib/hardening";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Regression: rejecting a proposedMemory card never called any API at all --
// the candidate simply never got persisted, which is the correct fail-closed
// default for the memory itself, but left no record that a decision was
// ever made. On the next reload, the same card reappeared with active
// Confirm/Edit/Reject buttons, indistinguishable from a message no one had
// looked at yet. This route is the missing write: it records "rejected" on
// the message so the History/Consult AI reload is driven by the real,
// persisted decision, never a client-side guess that resets on every mount.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
) {
  const user = await authenticateSessionRequest();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limiter = checkRateLimit(`reject-memory:${user.id}`, 30, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  const { id, messageId } = await context.params;
  const client = await resolveOwnedClient(user.id, id);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  try {
    const rejected = await markConsultationMessageMemoryDecision(user.id, id, messageId, "rejected");
    if (!rejected) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }
    return NextResponse.json({ rejected: true }, { status: 200 });
  } catch (error) {
    if (isConsultationMessagePersistenceError(error)) {
      return NextResponse.json(
        { error: "CONSULTATION_MESSAGE_PERSISTENCE_UNAVAILABLE", message: "Conversation data is temporarily unavailable." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
