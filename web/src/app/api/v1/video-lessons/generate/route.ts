import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { VideoLessonGenerateRequest, VideoLessonRecord } from "@/lib/contracts";
import { findRecommendedLessonIds, getSession, sanitize } from "@/lib/milestone1-store";
import { createVideoLessonRecord, isVideoLessonPersistenceError } from "@/lib/video-lesson-repository";

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

  try {
    const created = await createVideoLessonRecord({
      ownerUserId: sessionUser.id,
      topic,
      level,
      locale,
      recommendedLessonIds,
    });

    // Honest by construction: createVideoLessonRecord never fabricates a
    // script or videoUrl, and always persists status "not_generated" -- no
    // real video generation capability exists yet (M22).
    const videoLesson: VideoLessonRecord = {
      id: created.id,
      ownerUserId: created.ownerUserId,
      topic: created.topic,
      level,
      locale,
      status: created.status as VideoLessonRecord["status"],
      recommendedLessonIds: created.recommendedLessonIds as string[],
      script: created.script,
      videoUrl: created.videoUrl,
      createdAt: created.createdAt.toISOString(),
      completedAt: null,
    };

    return NextResponse.json({ videoLesson }, { status: 201 });
  } catch (error) {
    if (isVideoLessonPersistenceError(error)) {
      return NextResponse.json({ error: error.code }, { status: error.httpStatus });
    }
    throw error;
  }
}
