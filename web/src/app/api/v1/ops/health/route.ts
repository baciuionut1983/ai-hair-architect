import { NextResponse } from "next/server";

import {
  appointmentPersistenceUnavailableResponse,
  countAllAppointments,
  isAppointmentPersistenceError,
} from "@/lib/appointment-repository";
import {
  clientPersistenceUnavailableResponse,
  countActiveClients,
  isClientPersistenceError,
} from "@/lib/client-repository";
import {
  consultationPersistenceUnavailableResponse,
  countAllConsultations,
  isConsultationPersistenceError,
} from "@/lib/consultation-repository";
import { getOpsHealthSnapshot } from "@/lib/milestone1-store";
import {
  countAllNotifications,
  isNotificationPersistenceError,
  notificationPersistenceUnavailableResponse,
} from "@/lib/notification-repository";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [clientsCount, consultationsCount, appointmentsCount, notificationsCount] = await Promise.all([
      countActiveClients(),
      countAllConsultations(),
      countAllAppointments(),
      countAllNotifications(),
    ]);
    const health = getOpsHealthSnapshot(
      clientsCount,
      consultationsCount,
      appointmentsCount,
      notificationsCount,
    );
    return NextResponse.json({ health }, { status: 200 });
  } catch (error) {
    if (isClientPersistenceError(error)) return clientPersistenceUnavailableResponse();
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    if (isAppointmentPersistenceError(error)) return appointmentPersistenceUnavailableResponse();
    if (isNotificationPersistenceError(error)) return notificationPersistenceUnavailableResponse();
    throw error;
  }
}
