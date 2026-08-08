import { NextResponse } from "next/server";

import type { VideoLessonRecord } from "@/lib/contracts";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { getVideoLessonRecordById, isVideoLessonPersistenceError } from "@/lib/video-lesson-repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const record = await getVideoLessonRecordById(id);

    // Matches the existing cookie-auth ownership convention used by this
    // subsystem's siblings (clients/[id], consultations/[id]): a single 404
    // for both "doesn't exist" and "belongs to another user", not a
    // 404/403 split. That split is the convention of the separate,
    // Bearer-authenticated image-analyses/image-assets family instead.
    if (!record || record.ownerUserId !== sessionUser.id) {
      return NextResponse.json({ error: "Video lesson not found." }, { status: 404 });
    }

    const videoLesson: VideoLessonRecord = {
      id: record.id,
      ownerUserId: record.ownerUserId,
      topic: record.topic,
      level: record.level as VideoLessonRecord["level"],
      locale: record.locale as VideoLessonRecord["locale"],
      status: record.status as VideoLessonRecord["status"],
      recommendedLessonIds: record.recommendedLessonIds as string[],
      script: record.script,
      videoUrl: record.videoUrl,
      createdAt: record.createdAt.toISOString(),
      completedAt: null,
    };

    return NextResponse.json({ videoLesson }, { status: 200 });
  } catch (error) {
    if (isVideoLessonPersistenceError(error)) {
      return NextResponse.json({ error: error.code }, { status: error.httpStatus });
    }
    throw error;
  }
}
