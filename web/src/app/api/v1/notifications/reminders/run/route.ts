import { NextResponse } from "next/server";

import {
  AppointmentConcurrencyError,
  appointmentPersistenceUnavailableResponse,
  executeDueAppointmentRemindersForOwner,
  isAppointmentPersistenceError,
} from "@/lib/appointment-repository";
import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(request: Request) {
  const guardResponse = guardBusinessPersistence("notifications", request);
  if (guardResponse) return guardResponse;

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await executeDueAppointmentRemindersForOwner(sessionUser.id);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AppointmentConcurrencyError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.httpStatus });
    }
    if (isAppointmentPersistenceError(error)) return appointmentPersistenceUnavailableResponse();
    throw error;
  }
}
