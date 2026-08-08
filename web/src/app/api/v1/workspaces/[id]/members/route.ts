import { NextResponse } from "next/server";

import type { WorkspaceAddMemberRequest } from "@/lib/contracts";
import { addWorkspaceMember, sanitize } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json()) as Partial<WorkspaceAddMemberRequest>;
  const userId = sanitize(body.userId);
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const role = body.role === "manager" ? "manager" : "stylist";
  const membership = addWorkspaceMember({
    workspaceId: id,
    actorUserId: sessionUser.id,
    userId,
    role
  });

  if (!membership) {
    return NextResponse.json({ error: "Cannot add member with current permissions or invalid user." }, { status: 403 });
  }

  return NextResponse.json({ membership }, { status: 201 });
}
