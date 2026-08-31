import { NextResponse } from "next/server";

import { runVideoDemonstrationRecoverySweepForRuntime } from "@/lib/video-worker-runtime";
import { authenticateVideoWorkerRequest } from "@/lib/video-worker-auth";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

// Real AI Video Demonstration, Stage 3 (task §4/§16) -- the scheduler-
// facing recovery trigger. Deliberately NOT session-authenticated -- a
// scheduled job has no human session to present. Secured instead by
// authenticateVideoWorkerRequest's shared-secret check (mirrors
// retention-automation-auth.ts's own established mechanism), which fails
// closed (401/503) if the secret is missing or wrong, never silently
// proceeding as an unauthenticated no-op. A normal authenticated user
// (even a real owner) has no path to this endpoint's effect at all --
// there is no session-based access to it, by design.
//
// Each invocation finds every generation due for work (task §4) and
// advances each one exactly one step via the SAME
// executeVideoDemonstrationGeneration orchestrator every direct /execute
// call already uses -- no separate worker-only logic exists that could
// diverge from the interactive path's own safety guarantees.
export async function POST(request: Request) {
  const auth = authenticateVideoWorkerRequest(request);

  if (auth === "not_configured") {
    return NextResponse.json(
      { error: "VIDEO_DEMONSTRATION_WORKER_NOT_CONFIGURED", message: "Video Demonstration recovery worker is not configured in this environment." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (auth === "unauthorized") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  try {
    const result = await runVideoDemonstrationRecoverySweepForRuntime();
    return NextResponse.json({ result }, { status: 200, headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Video Demonstration recovery sweep failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
