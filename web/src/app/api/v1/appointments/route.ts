import { NextResponse } from "next/server";

import {
  AppointmentDependencyError,
  appointmentPersistenceUnavailableResponse,
  createAppointmentForOwner,
  isAppointmentPersistenceError,
  listAppointmentsForOwner,
} from "@/lib/appointment-repository";
import { guardBusinessPersistence } from "@/lib/business-persistence-guards";
import { resolveOwnedClient } from "@/lib/client-repository";
import type { AppointmentCreateRequest } from "@/lib/contracts";
import { sanitize } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

function normalizeReminderMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24 * 60;
  }
  return Math.round(parsed);
}

export async function GET(request: Request) {
  const blockedResponse = guardBusinessPersistence("appointments", request);
  if (blockedResponse) {
    return blockedResponse;
  }

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || undefined;
  try {
    const appointments = await listAppointmentsForOwner(sessionUser.id, clientId);
    return NextResponse.json({ appointments }, { status: 200 });
  } catch (error) {
    if (isAppointmentPersistenceError(error)) return appointmentPersistenceUnavailableResponse();
    throw error;
  }
}

export async function POST(request: Request) {
  const blockedResponse = guardBusinessPersistence("appointments", request);
  if (blockedResponse) {
    return blockedResponse;
  }

  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<AppointmentCreateRequest>;
  const clientId = sanitize(body.clientId);
  const title = sanitize(body.title);
  const startsAt = sanitize(body.startsAt);
  const notes = sanitize(body.notes);

  if (!clientId || !title || !startsAt) {
    return NextResponse.json({ error: "clientId, title and startsAt are required." }, { status: 400 });
  }

  const client = await resolveOwnedClient(sessionUser.id, clientId);
  if (client instanceof Response) return client;
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  if (Number.isNaN(Date.parse(startsAt))) {
    return NextResponse.json({ error: "startsAt must be a valid ISO date." }, { status: 400 });
  }

  const reminderType =
    body.reminderType === "follow_up" || body.reminderType === "maintenance"
      ? body.reminderType
      : "appointment";

  try {
    const appointment = await createAppointmentForOwner(sessionUser.id, {
      clientId: client.id,
      title,
      startsAt: new Date(startsAt),
      reminderMinutesBefore: normalizeReminderMinutes(body.reminderMinutesBefore),
      reminderType,
      notes
    });
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof AppointmentDependencyError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (isAppointmentPersistenceError(error)) return appointmentPersistenceUnavailableResponse();
    throw error;
  }
}
