import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { beginRetentionExecutionScope, endRetentionExecutionScope, getSession, isRetentionExecutionScopeActive, runRetentionJobForUser } from "@/lib/milestone1-store";

const RETENTION_EXECUTION_CONFIRMATION_TOKEN = "CONFIRM_RETENTION_EXECUTION";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  const sessionUser = getSession(token);

  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    olderThanDays?: number;
    dryRun?: boolean;
    confirmationToken?: string;
  };

  const olderThanDays = Number.isFinite(body.olderThanDays) ? Math.max(1, Number(body.olderThanDays)) : 30;
  const dryRun = body.dryRun !== false;

  if (!dryRun && body.confirmationToken !== RETENTION_EXECUTION_CONFIRMATION_TOKEN) {
    return NextResponse.json(
      { error: "CONFIRMATION_REQUIRED", message: "Explicit confirmation is required to execute retention." },
      { status: 400 },
    );
  }

  const retentionScope = sessionUser.id;

  if (!dryRun && isRetentionExecutionScopeActive(retentionScope)) {
    return NextResponse.json(
      { error: "RETENTION_CONFLICT", message: "A retention execution is already running for this scope." },
      { status: 409 },
    );
  }

  if (!dryRun) {
    const acquired = beginRetentionExecutionScope(retentionScope);
    if (!acquired) {
      return NextResponse.json(
        { error: "RETENTION_CONFLICT", message: "A retention execution is already running for this scope." },
        { status: 409 },
      );
    }

    try {
      const result = runRetentionJobForUser({
        userId: sessionUser.id,
        olderThanDays,
        dryRun,
      });

      return NextResponse.json({ result }, { status: 200 });
    } finally {
      endRetentionExecutionScope(retentionScope);
    }
  }

  const result = runRetentionJobForUser({
    userId: sessionUser.id,
    olderThanDays,
    dryRun,
  });

  return NextResponse.json({ result }, { status: 200 });
}
