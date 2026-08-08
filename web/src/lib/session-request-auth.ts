import { cookies } from "next/headers";

import type { AuthenticatedUser } from "@/lib/auth-persistence";
import { resolveAuthenticatedUserFromToken } from "@/lib/auth-persistence";

const SESSION_COOKIE_NAME = "aha_session";

/**
 * M32 GO-2: the single, Postgres-only entry point production API routes
 * should use to authenticate a cookie-session request. Reads the same
 * `aha_session` cookie every legacy route already reads via next/headers'
 * `cookies()`, then resolves it exclusively through
 * resolveAuthenticatedUserFromToken -- no in-memory fallback, no second
 * validation path. A missing cookie, an unknown token, an expired session,
 * or persistence being unavailable all resolve to null identically; the
 * caller is expected to treat null as 401, matching every route this
 * replaces.
 */
export async function authenticateSessionRequest(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!token) return null;

  return resolveAuthenticatedUserFromToken(token);
}
