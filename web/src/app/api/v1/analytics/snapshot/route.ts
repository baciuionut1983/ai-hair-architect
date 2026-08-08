import { NextResponse } from "next/server";

import {
  appointmentPersistenceUnavailableResponse,
  countAppointmentsForOwner,
  countSentRemindersForOwner,
  isAppointmentPersistenceError,
} from "@/lib/appointment-repository";
import {
  clientPersistenceUnavailableResponse,
  isClientPersistenceError,
  listActiveClientIdsForOwner,
} from "@/lib/client-repository";
import {
  consultationPersistenceUnavailableResponse,
  countConsultationsForOwner,
  isConsultationPersistenceError,
} from "@/lib/consultation-repository";
import { getAnalyticsSnapshotForUser } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";
import { countVideoLessonsForOwner, isVideoLessonPersistenceError } from "@/lib/video-lesson-repository";

export async function GET() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await listActiveClientIdsForOwner(sessionUser.id);
    const [consultationsCount, appointmentsCount, remindersSentCount, generatedVideoLessonsCount] = await Promise.all([
      countConsultationsForOwner(sessionUser.id),
      countAppointmentsForOwner(sessionUser.id),
      countSentRemindersForOwner(sessionUser.id),
      countVideoLessonsForOwner(sessionUser.id),
    ]);
    const snapshot = getAnalyticsSnapshotForUser(
      sessionUser.id,
      consultationsCount,
      appointmentsCount,
      remindersSentCount,
      generatedVideoLessonsCount,
    );
    return NextResponse.json({ snapshot }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    if (isAppointmentPersistenceError(error)) return appointmentPersistenceUnavailableResponse();
    if (isVideoLessonPersistenceError(error)) {
      return NextResponse.json({ error: "VIDEO_LESSON_PERSISTENCE_UNAVAILABLE" }, { status: 503 });
    }
    throw error;
  }
}
