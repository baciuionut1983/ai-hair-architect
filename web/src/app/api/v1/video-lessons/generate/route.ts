import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { VideoLessonGenerateRequest } from "@/lib/contracts";
import {
  createVideoLessonJob,
  findRecommendedLessonIds,
  getSession,
  processVideoLessonJob,
  sanitize
} from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<VideoLessonGenerateRequest>;
  const topic = sanitize(body.topic);
  if (!topic) {
    return NextResponse.json({ error: "topic is required." }, { status: 400 });
  }

  const level =
    body.level === "beginner" || body.level === "advanced" ? body.level : "intermediate";
  const locale = body.locale === "ro" ? "ro" : "en";

  const recommendedLessonIds = findRecommendedLessonIds(topic);
  const queued = createVideoLessonJob({
    ownerUserId: sessionUser.id,
    topic,
    level,
    locale,
    recommendedLessonIds
  });

  const processed = processVideoLessonJob(queued.id);
  if (!processed) {
    return NextResponse.json({ error: "Video generation failed." }, { status: 500 });
  }

  return NextResponse.json({ videoLesson: processed }, { status: 201 });
}
