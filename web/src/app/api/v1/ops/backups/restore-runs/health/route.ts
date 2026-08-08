import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { buildRestoreGovernanceHealth } from "@/lib/backup-v13-restore-observability";
import { ensureRequestId } from "@/lib/hardening";
import { authenticateSessionRequest } from "@/lib/session-request-auth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,120}$/;

export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers?.get?.("x-request-id") ?? null);

  try {
    const sessionUser = await authenticateSessionRequest();

    if (!sessionUser) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", requestId },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const response = await buildRestoreGovernanceHealth({
      ownerUserId: sessionUser.id,
      requestId,
    });

    return NextResponse.json(response, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[RESTORE_HEALTH_UNAVAILABLE]", { requestId, error });
    return NextResponse.json(
      { error: "BACKUP_RESTORE_HEALTH_UNAVAILABLE", requestId },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function resolveRequestId(headerValue: string | null): string {
  const normalized = ensureRequestId(headerValue);
  return REQUEST_ID_REGEX.test(normalized) ? normalized : randomUUID();
}
