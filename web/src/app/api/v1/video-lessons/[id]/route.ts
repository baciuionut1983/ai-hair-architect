import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSession, getVideoLessonByIdOwned } from "@/lib/milestone1-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const videoLesson = getVideoLessonByIdOwned(id, sessionUser.id);
  if (!videoLesson) {
    return NextResponse.json({ error: "Video lesson not found." }, { status: 404 });
  }

  return NextResponse.json({ videoLesson }, { status: 200 });
}
