import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import {
  AppointmentConcurrencyError,
  appointmentPersistenceUnavailableResponse,
  executeDueAppointmentRemindersForOwner,
  isAppointmentPersistenceError,
} from "@/lib/appointment-repository";
import { getSession } from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const guardResponse = guardBusinessPersistence("notifications", request);
  if (guardResponse) return guardResponse;

  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

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
