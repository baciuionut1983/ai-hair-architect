import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { ClientTimelineResponse } from "@/lib/contracts";
import {
  getAppointmentsForUser,
  getClientOwnedByUser,
  getClientTimelineByUser,
  getConsultationsForClientByUser,
  getFormulasForClientByUser,
  getPhotosForClientByUser,
  getSession,
  getTreatmentsForClientByUser
} from "@/lib/milestone1-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const client = getClientOwnedByUser(id, sessionUser.id);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const response: ClientTimelineResponse = {
    photos: getPhotosForClientByUser(id, sessionUser.id),
    formulas: getFormulasForClientByUser(id, sessionUser.id),
    treatments: getTreatmentsForClientByUser(id, sessionUser.id),
    consultations: getConsultationsForClientByUser(id, sessionUser.id),
    appointments: getAppointmentsForUser(sessionUser.id, id),
    timeline: getClientTimelineByUser(id, sessionUser.id)
  };

  return NextResponse.json(response, { status: 200 });
}
