import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPushPreference, getSession, upsertPushPreference } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preference = getPushPreference(sessionUser.id);
  return NextResponse.json({ preference }, { status: 200 });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

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
