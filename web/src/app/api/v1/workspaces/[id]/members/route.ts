import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { WorkspaceAddMemberRequest } from "@/lib/contracts";
import { addWorkspaceMember, getSession, sanitize } from "@/lib/milestone1-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

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
