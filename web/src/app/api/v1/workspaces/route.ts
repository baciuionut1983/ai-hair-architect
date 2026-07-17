import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { WorkspaceCreateRequest } from "@/lib/contracts";
import { createWorkspace, getSession, getWorkspacesForUser, sanitize } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaces = getWorkspacesForUser(sessionUser.id);
  return NextResponse.json({ workspaces }, { status: 200 });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<WorkspaceCreateRequest>;
  const name = sanitize(body.name);
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const workspace = createWorkspace(sessionUser.id, name);
  return NextResponse.json({ workspace }, { status: 201 });
}
