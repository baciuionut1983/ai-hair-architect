import { NextResponse } from "next/server";

import { getPushPreference, upsertPushPreference } from "@/lib/milestone1-store";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preference = getPushPreference(sessionUser.id);
  return NextResponse.json({ preference }, { status: 200 });
}

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    enabled?: boolean;
    channels?: Array<"in_app" | "email" | "push">;
  };

  const channels: Array<"in_app" | "email" | "push"> = Array.isArray(body.channels)
    ? body.channels.filter(
      (entry): entry is "in_app" | "email" | "push" =>
        entry === "in_app" || entry === "email" || entry === "push"
    )
    : ["in_app"];

  const preference = upsertPushPreference({
    userId: sessionUser.id,
    enabled: body.enabled !== false,
    channels: channels.length > 0 ? channels : ["in_app"]
  });

  return NextResponse.json({ preference }, { status: 200 });
}
