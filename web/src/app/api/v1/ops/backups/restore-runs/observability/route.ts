import { randomUUID } from "crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  buildRestoreGovernanceObservability,
  OBSERVABILITY_RECENT_LIMIT_INVALID,
  OBSERVABILITY_WINDOW_UNSUPPORTED,
  parseObservabilityQuery,
} from "@/lib/backup-v13-restore-observability";
import { ensureRequestId } from "@/lib/hardening";
import { resolveOpsSessionUserReadOnly } from "@/lib/ops-persistence";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,120}$/;

export async function GET(request: Request) {
  const requestId = resolveRequestId(request.headers?.get?.("x-request-id") ?? null);

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("aha_session")?.value ?? null;
    const sessionUser = await resolveOpsSessionUserReadOnly(token);

    if (!sessionUser) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", requestId },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const url = new URL(request.url);

    let query: ReturnType<typeof parseObservabilityQuery>;
    try {
      query = parseObservabilityQuery(url.searchParams);
    } catch (error) {
      if (error instanceof Error && error.message === OBSERVABILITY_WINDOW_UNSUPPORTED) {
        return NextResponse.json(
          { error: OBSERVABILITY_WINDOW_UNSUPPORTED, requestId },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      if (error instanceof Error && error.message === OBSERVABILITY_RECENT_LIMIT_INVALID) {
        return NextResponse.json(
          { error: OBSERVABILITY_RECENT_LIMIT_INVALID, requestId },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        { error: OBSERVABILITY_WINDOW_UNSUPPORTED, requestId },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const response = await buildRestoreGovernanceObservability({
      ownerUserId: sessionUser.id,
      requestId,
      window: query.window,
      recentLimit: query.recentLimit,
    });

    return NextResponse.json(response, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[RESTORE_OBSERVABILITY_UNAVAILABLE]", { requestId, error });
    return NextResponse.json(
      { error: "BACKUP_RESTORE_OBSERVABILITY_UNAVAILABLE", requestId },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

function resolveRequestId(headerValue: string | null): string {
  const normalized = ensureRequestId(headerValue);
  return REQUEST_ID_REGEX.test(normalized) ? normalized : randomUUID();
}
