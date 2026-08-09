import { NextResponse } from "next/server";

import { randomUUID } from "crypto";

import { ImageAssetRetentionError, runImageAssetRetentionPurgeForUser } from "@/lib/image-asset-retention-runtime";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const sessionUser = await authenticateSessionRequest();

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "REQUEST_INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return NextResponse.json(
      { error: "REQUEST_INVALID_JSON", message: "Request body must be a JSON object." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const body = rawBody as {
    dryRun?: boolean;
    confirmationToken?: string;
    executionIdempotencyKey?: string;
    reason?: string;
  };

  const dryRun = body.dryRun !== false;

  try {
    const result = await runImageAssetRetentionPurgeForUser({
      ownerUserId: sessionUser.id,
      dryRun,
      confirmationToken: body.confirmationToken,
      executionIdempotencyKey: body.executionIdempotencyKey,
      reason: body.reason,
      correlationRequestId: randomUUID(),
    });

    return NextResponse.json({ result }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof ImageAssetRetentionError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Image asset retention execution failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
