import { NextResponse } from "next/server";

import { getPushQueueForUser, sanitize } from "@/lib/milestone1-store";
import { enqueuePersistentPushNotification } from "@/lib/ops-persistence";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export async function GET() {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queue = getPushQueueForUser(sessionUser.id);
  return NextResponse.json({ queue }, { status: 200 });
}

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    channel?: "in_app" | "email" | "push";
    title?: string;
    body?: string;
  };

  const channel = body.channel === "email" || body.channel === "push" ? body.channel : "in_app";
  const title = sanitize(body.title);
  const content = sanitize(body.body);

  if (!title || !content) {
    return NextResponse.json({ error: "title and body are required." }, { status: 400 });
  }

  const item = await enqueuePersistentPushNotification({
    userId: sessionUser.id,
    channel,
    title,
    body: content
  });

  return NextResponse.json({ item }, { status: 201 });
}
