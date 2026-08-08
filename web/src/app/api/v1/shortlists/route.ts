import { NextResponse } from "next/server";

import { resolveOwnedClient } from "@/lib/client-repository";
import type { ShortlistCreateRequest } from "@/lib/contracts";
import { createShortlist, sanitize } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<ShortlistCreateRequest>;
  const title = sanitize(body.title);
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  const clientId = sanitize(body.clientId);
  if (clientId) {
    const client = await resolveOwnedClient(sessionUser.id, clientId);
    if (client instanceof Response) return client;
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
  }

  const shortlist = createShortlist({
    ownerUserId: sessionUser.id,
    clientId,
    title,
    productIds: Array.isArray(body.productIds) ? body.productIds : [],
    supplierIds: Array.isArray(body.supplierIds) ? body.supplierIds : []
  });

  return NextResponse.json({ shortlist }, { status: 201 });
}
