import { NextResponse } from "next/server";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { readReviewedProceduralKnowledge, ReviewedProceduralKnowledgeReadError } from "@/lib/reviewed-procedural-knowledge-service";

export async function GET(_request: Request, context: { params: Promise<{ draftId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await authenticateSessionRequest();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  const { draftId } = await context.params;
  try {
    const projection = await readReviewedProceduralKnowledge(user.id, draftId);
    return NextResponse.json({ projection }, { headers });
  } catch (error) {
    if (error instanceof ReviewedProceduralKnowledgeReadError) return NextResponse.json({ error: error.code }, { status: error.httpStatus, headers });
    throw error;
  }
}
