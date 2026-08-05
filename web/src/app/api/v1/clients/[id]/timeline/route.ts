import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  appointmentPersistenceUnavailableResponse,
  isAppointmentPersistenceError,
  listAppointmentsForOwner,
} from "@/lib/appointment-repository";
import { resolveOwnedClient } from "@/lib/client-repository";
import {
  clientFormulaPersistenceUnavailableResponse,
  isClientFormulaPersistenceError,
  listClientFormulasForOwner,
} from "@/lib/client-formula-repository";
import {
  clientPhotoPersistenceUnavailableResponse,
  isClientPhotoPersistenceError,
  listClientPhotosForOwner,
} from "@/lib/client-photo-repository";
import {
  clientTreatmentPersistenceUnavailableResponse,
  isClientTreatmentPersistenceError,
  listClientTreatmentsForOwner,
} from "@/lib/client-treatment-repository";
import {
  consultationPersistenceUnavailableResponse,
  isConsultationPersistenceError,
  listConsultationsForClient,
} from "@/lib/consultation-repository";
import type { ClientTimelineResponse, TimelineEntry } from "@/lib/contracts";
import { getSession } from "@/lib/milestone1-store";

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
  try {
    const client = await resolveOwnedClient(sessionUser.id, id);
    if (client instanceof Response) return client;
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const [consultations, appointments, photos, formulas, treatments] = await Promise.all([
      listConsultationsForClient(sessionUser.id, id),
      listAppointmentsForOwner(sessionUser.id, id),
      listClientPhotosForOwner(sessionUser.id, id),
      listClientFormulasForOwner(sessionUser.id, id),
      listClientTreatmentsForOwner(sessionUser.id, id),
    ]);
    const legacyTimeline: TimelineEntry[] = [
      ...photos.map((item) => ({
        id: item.id,
        kind: "photo" as const,
        createdAt: item.createdAt,
        title: item.caption || "Photo added",
        details: item.imageUrl,
      })),
      ...formulas.map((item) => ({
        id: item.id,
        kind: "formula" as const,
        createdAt: item.createdAt,
        title: item.formulaName,
        details: item.formulaDetails,
      })),
      ...treatments.map((item) => ({
        id: item.id,
        kind: "treatment" as const,
        createdAt: item.createdAt,
        title: item.treatmentName,
        details: item.treatmentDetails,
      })),
    ];
    const consultationTimeline = consultations.map<TimelineEntry>((item) => ({
      id: item.id,
      kind: "consultation",
      createdAt: item.createdAt,
      title: "Consultation",
      details: item.summary,
    }));
    const appointmentTimeline = appointments.map<TimelineEntry>((item) => ({
      id: item.id,
      kind: "appointment",
      createdAt: item.startsAt,
      title: item.title,
      details: item.notes,
    }));
    const response: ClientTimelineResponse = {
      photos,
      formulas,
      treatments,
      consultations,
      appointments,
      timeline: [...legacyTimeline, ...consultationTimeline, ...appointmentTimeline].sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.kind.localeCompare(right.kind) ||
          right.id.localeCompare(left.id),
      ),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (isAppointmentPersistenceError(error)) return appointmentPersistenceUnavailableResponse();
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    if (isClientPhotoPersistenceError(error)) return clientPhotoPersistenceUnavailableResponse();
    if (isClientFormulaPersistenceError(error)) return clientFormulaPersistenceUnavailableResponse();
    if (isClientTreatmentPersistenceError(error)) return clientTreatmentPersistenceUnavailableResponse();
    throw error;
  }
}
