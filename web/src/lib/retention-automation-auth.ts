import { timingSafeEqual } from "crypto";

// M37: authenticates a non-interactive, machine-to-machine caller (a
// scheduler) for the retention automation trigger. Deliberately NOT built
// on authenticateSessionRequest()/authenticateSessionUser() -- those
// authenticate a specific human's session, which a scheduled job has none
// of, and reusing them would mean either minting a long-lived, unexpiring
// user session for a "robot" (a real security smell) or leaving the route
// effectively unauthenticated. This is the first machine-to-machine
// caller in this codebase, so it gets its own, narrowly-scoped mechanism:
// a single shared secret, compared in constant time, read fresh from the
// environment on every call (never cached) so a rotated/removed secret
// takes effect immediately without a redeploy-triggered process restart
// being the only way to pick it up.

export type RetentionAutomationAuthResult = "authorized" | "unauthorized" | "not_configured";

const AUTH_HEADER_PATTERN = /^Bearer (.+)$/;

export function authenticateRetentionAutomationRequest(request: Request): RetentionAutomationAuthResult {
  const configuredToken = (process.env.RETENTION_AUTOMATION_TOKEN ?? "").trim();
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
  // timingSafeEqual throws on a length mismatch rather than returning
  // false, and comparing lengths first would itself leak timing
  // information proportional to the secret's length -- so both buffers
  // are padded to the same fixed size before the real comparison, and a
  // length mismatch is folded into the same constant-time path rather
  // than an early, timing-observable return.
  const length = Math.max(bufferA.length, bufferB.length, 32);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufferA.copy(paddedA);
  bufferB.copy(paddedB);
  const lengthsMatch = bufferA.length === bufferB.length;
  const contentsMatch = timingSafeEqual(paddedA, paddedB);
  return lengthsMatch && contentsMatch;
}
