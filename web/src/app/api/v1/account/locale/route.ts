import { NextResponse } from "next/server";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

// Lets a signed-in stylist persist their own language choice server-side
// (User.locale already exists -- see contracts.ts's Locale -- this is
// simply the first write path for it since registration). A concrete,
// non-"auto" selector value is the only thing ever sent here: "Auto" is a
// purely client-side/local preference (see consultation-chat-logic.ts's
// LANGUAGE_SELECTION_STORAGE_KEY), never written to the account, since
// there is no "auto" value in the Locale type to persist. Mirrors
// push/preferences's POST self-upsert shape and
// updatePersistencePasswordHash's single-field prisma.user.update pattern.
export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { locale?: string };
  if (body.locale !== "en" && body.locale !== "ro") {
    return NextResponse.json({ error: "locale must be \"en\" or \"ro\"." }, { status: 400 });
  }

  // Same fail-closed convention as voice-transcript/route.ts: a persistence
  // problem is reported as a clear 503, never a silently-degraded 200.
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "ACCOUNT_PERSISTENCE_UNAVAILABLE", message: "Your language preference could not be saved right now." },
      { status: 503 },
    );
  }

  try {
    await prisma.user.update({ where: { id: sessionUser.id }, data: { locale: body.locale } });
  } catch {
    return NextResponse.json(
      { error: "ACCOUNT_PERSISTENCE_UNAVAILABLE", message: "Your language preference could not be saved right now." },
      { status: 503 },
    );
  }

  return NextResponse.json({ locale: body.locale }, { status: 200 });
}
