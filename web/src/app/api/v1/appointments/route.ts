import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { AppointmentCreateRequest } from "@/lib/contracts";
import { createAppointment, getAppointmentsForUser, getClientOwnedByUser, getSession, sanitize } from "@/lib/milestone1-store";

function normalizeReminderMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24 * 60;
  }
  return Math.round(parsed);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || undefined;
  const appointments = getAppointmentsForUser(sessionUser.id, clientId);
  return NextResponse.json({ appointments }, { status: 200 });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

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

  const client = getClientOwnedByUser(clientId, sessionUser.id);
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

  const appointment = createAppointment({
    ownerUserId: sessionUser.id,
    clientId: client.id,
    title,
    startsAt,
    reminderMinutesBefore: normalizeReminderMinutes(body.reminderMinutesBefore),
    reminderType,
    notes
  });

  return NextResponse.json({ appointment }, { status: 201 });
}
