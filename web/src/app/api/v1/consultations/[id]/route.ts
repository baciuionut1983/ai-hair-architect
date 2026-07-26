import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  consultationPersistenceUnavailableResponse,
  findConsultationForOwner,
  isConsultationPersistenceError,
} from "@/lib/consultation-repository";
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
    const consultation = await findConsultationForOwner(sessionUser.id, id);
    if (!consultation) {
      return NextResponse.json({ error: "Consultation not found." }, { status: 404 });
    }
    return NextResponse.json({ consultation }, { status: 200 });
  } catch (error) {
    if (isConsultationPersistenceError(error)) return consultationPersistenceUnavailableResponse();
    throw error;
  }
}