import { timingSafeEqual } from "crypto";

// Real AI Video Demonstration, Stage 3 (task §16): authenticates a
// non-interactive, machine-to-machine caller (a scheduler) for the Video
// Demonstration recovery worker trigger. Deliberately a near-verbatim
// mirror of retention-automation-auth.ts's own established mechanism
// (the first machine-to-machine caller in this codebase) rather than a
// new pattern: a scheduled job has no human session to authenticate the
// way authenticateSessionRequest() does, and reusing THAT would mean
// either minting a long-lived, unexpiring user session for a "robot" (a
// real security smell) or leaving the route effectively unauthenticated.
// A single shared secret, compared in constant time, read fresh from the
// environment on every call (never cached) so a rotated/removed secret
// takes effect immediately without a redeploy-triggered process restart
// being the only way to pick it up.

export type VideoWorkerAuthResult = "authorized" | "unauthorized" | "not_configured";

const AUTH_HEADER_PATTERN = /^Bearer (.+)$/;

export function authenticateVideoWorkerRequest(request: Request): VideoWorkerAuthResult {
  const configuredToken = (process.env.VIDEO_DEMONSTRATION_WORKER_TOKEN ?? "").trim();
  if (!configuredToken) {
    // Fail closed: an unset/empty secret must never be treated as "no
    // auth required" -- every request is rejected, regardless of what
    // header it presents. A normal user must never be able to say
    // "process all jobs" (task §16) -- this is the one and only door, and
    // it defaults shut.
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
