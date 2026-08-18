import { timingSafeEqual } from "crypto";

// AI Usage & Cost Metering Phase 1: authenticates the internal AI-usage
// report endpoint. This app's User.role today is only ever "professional"
// | "salon" | "consumer" (see contracts.ts's UserRole) -- there is no real
// admin role a live account can hold, so a platform-wide cost report
// cannot honestly be gated on one. Deliberately mirrors
// retention-automation-auth.ts's own established shared-secret pattern
// (the first machine/internal caller in this codebase) rather than
// resurrecting the dormant, pre-M26 bearer-token session lookup in
// src/middleware/analytics-auth.ts -- that surface predates this app's
// current authenticateSessionRequest()-based session model, is unreferenced
// by any live UI, and was not adopted here specifically to avoid building
// new instrumentation on top of a deprecated auth path. A single shared
// secret, compared in constant time, read fresh from the environment on
// every call (never cached) so a rotated/removed secret takes effect
// immediately.

export type AiUsageReportAuthResult = "authorized" | "unauthorized" | "not_configured";

const AUTH_HEADER_PATTERN = /^Bearer (.+)$/;

export function authenticateAiUsageReportRequest(request: Request): AiUsageReportAuthResult {
  const configuredToken = (process.env.AI_USAGE_REPORT_TOKEN ?? "").trim();
  if (!configuredToken) {
    // Fail closed: an unset/empty secret must never be treated as "no
    // auth required" -- every request is rejected, regardless of what
    // header it presents.
    return "not_configured";
  }

  const header = request.headers.get("authorization") ?? "";
  const match = AUTH_HEADER_PATTERN.exec(header);
  if (!match) {
    return "unauthorized";
  }

  const presentedToken = match[1];
  if (!constantTimeEquals(presentedToken, configuredToken)) {
    return "unauthorized";
  }

  return "authorized";
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  const length = Math.max(bufferA.length, bufferB.length, 32);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufferA.copy(paddedA);
  bufferB.copy(paddedB);
  const lengthsMatch = bufferA.length === bufferB.length;
  const contentsMatch = timingSafeEqual(paddedA, paddedB);
  return lengthsMatch && contentsMatch;
}
