import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type { ClientConsultationsResponse } from "@/lib/contracts";
import { getConsultationsForClientByUser, getSession } from "@/lib/milestone1-store";

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
  const consultations = getConsultationsForClientByUser(id, sessionUser.id);

  const response: ClientConsultationsResponse = { consultations };
  return NextResponse.json(response, { status: 200 });
}
