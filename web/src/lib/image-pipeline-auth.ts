import type { NextRequest } from "next/server";

import { resolveAuthenticatedUserFromToken } from "@/lib/auth-persistence";
import type { AuthenticatedSessionUser } from "@/lib/session-auth";
import { authenticateSessionUser } from "@/lib/session-auth";

const SESSION_COOKIE_NAME = "aha_session";

export type PipelineAuthenticatedUser = AuthenticatedSessionUser;

/**
 * M31 GO-4: fail-closed dual resolver for the image-upload/image-analysis
 * pipeline's 7 routes. Two credentials are accepted:
 *
 *  - a cookie session, validated against the real Postgres `Session` row
 *    via resolveAuthenticatedUserFromToken (M32 GO-2: the same shared
 *    resolver every other production route authenticates cookies through,
 *    expiresAt enforced). The in-memory session in milestone1-store.ts is
 *    deliberately never consulted here -- it has no expiry at all, and
 *    accepting it on these routes would silently weaken the expiry
 *    guarantee Bearer already enforces today.
 *  - a Bearer token, validated by the existing, unmodified
 *    authenticateSessionUser (same Postgres `Session` table, same
 *    expiresAt check).
 *
 * If only one credential is presented, it alone must be valid. If both are
 * presented, both must be valid and must resolve to the same user --
 * presenting one valid and one invalid/mismatched credential is rejected
 * outright rather than silently falling back to the valid one.
 */
export async function resolvePipelineAuth(
  request: NextRequest,
): Promise<PipelineAuthenticatedUser | null> {
  const cookieToken = request.cookies?.get(SESSION_COOKIE_NAME)?.value || null;
  const bearerPresented = Boolean(request.headers.get("Authorization"));

  const cookieUser = cookieToken ? await resolveAuthenticatedUserFromToken(cookieToken) : null;
  const bearerUser = bearerPresented ? await authenticateSessionUser(request) : null;

  if (cookieToken && bearerPresented) {
    if (!cookieUser || !bearerUser) return null;
    if (cookieUser.id !== bearerUser.id) return null;
    return cookieUser;
  }

  if (cookieToken) return cookieUser;
  if (bearerPresented) return bearerUser;
  return null;
}
