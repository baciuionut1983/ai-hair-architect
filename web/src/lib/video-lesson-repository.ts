import type { VideoLesson } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const VIDEO_LESSON_PERSISTENCE_ERROR_CODE = "VIDEO_LESSON_PERSISTENCE_UNAVAILABLE";

// M22: no real AI generation exists yet, so every row created by this
// repository's write path stays in this state. Kept as a plain string (not
// a native Prisma enum) alongside the still-valid but currently-unemitted
// "queued" | "processing" | "completed" | "failed" vocabulary already
// defined in contracts.ts, so a future milestone that adds real generation
// can start emitting those values without another migration.
export const VIDEO_LESSON_STATUS_NOT_GENERATED = "not_generated";

export class VideoLessonPersistenceError extends Error {
  readonly code = VIDEO_LESSON_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Video lesson data is temporarily unavailable.");
    this.name = "VideoLessonPersistenceError";
  }
}

export interface CreateVideoLessonInput {
  ownerUserId: string;
  topic: string;
  level: string;
  locale: string;
  recommendedLessonIds: string[];
}

/**
 * Creates a VideoLesson row honestly: status is always
 * VIDEO_LESSON_STATUS_NOT_GENERATED and script/videoUrl are always null --
 * this repository never fabricates a script or a video URL. Real
 * recommendations (computed by the caller from academy content) are the
 * only generated data this function persists alongside the request itself.
 */
export async function createVideoLessonRecord(input: CreateVideoLessonInput): Promise<VideoLesson> {
  return runVideoLessonQuery(() =>
    prisma.videoLesson.create({
      data: {
        ownerUserId: input.ownerUserId,
        topic: input.topic,
        level: input.level,
        locale: input.locale,
        status: VIDEO_LESSON_STATUS_NOT_GENERATED,
        recommendedLessonIds: input.recommendedLessonIds,
        script: null,
        videoUrl: null,
      },
    })
  );
}

/**
 * Plain lookup by id, deliberately not scoped to an owner. Ownership
 * enforcement (and the resulting not-found vs. forbidden distinction) is a
 * route-layer decision for GO-3, not a data-access concern -- this
 * primitive stays neutral so that decision isn't pre-empted here.
 */
export async function getVideoLessonRecordById(id: string): Promise<VideoLesson | null> {
  return runVideoLessonQuery(() => prisma.videoLesson.findUnique({ where: { id } }));
}

/**
 * Matches the countXForOwner convention already used by the analytics
 * snapshot route (countConsultationsForOwner, countAppointmentsForOwner,
 * countSentRemindersForOwner) so the video lesson count can join the same
 * Promise.all instead of being read from the in-memory store.
 */
export async function countVideoLessonsForOwner(ownerUserId: string): Promise<number> {
  return runVideoLessonQuery(() => prisma.videoLesson.count({ where: { ownerUserId } }));
}

export function isVideoLessonPersistenceError(error: unknown): error is VideoLessonPersistenceError {
  return error instanceof VideoLessonPersistenceError;
}

async function runVideoLessonQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new VideoLessonPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof VideoLessonPersistenceError) {
      throw error;
    }
    throw new VideoLessonPersistenceError();
  }
}
