import type { Locale, UserRole } from "@/lib/contracts";
import { parseLanguageCode } from "@/lib/language-registry";
import { prisma } from "@/lib/prisma";

const BEARER_PREFIX = "Bearer ";

export interface AuthenticatedSessionUser {
  id: string;
  email: string;
  role: UserRole;
  locale: Locale;
}

/**
 * Generic Bearer + prisma.session authentication, with no billing semantics.
 * expiresAt must be strictly in the future; any missing/malformed token,
 * missing session, expired session, missing user, or lookup failure resolves
 * to null so callers fail closed before reaching any business logic.
 */
export async function authenticateSessionUser(
  request: Request,
): Promise<AuthenticatedSessionUser | null> {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) return null;

  const token = header.slice(BEARER_PREFIX.length).trim();
  if (!token) return null;

  try {
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session || !session.user) return null;
    if (!(session.expiresAt.getTime() > Date.now())) return null;

    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role as UserRole,
      locale: toLocale(session.user.locale),
    };
  } catch {
    return null;
  }
}

// Regression risk this replaces: an earlier version hardcoded
// `value === "ro" ? "ro" : "en"`, which would have silently coerced any
// OTHER real language (e.g. a stored "ar") back to "en" on every read.
function toLocale(value: string): Locale {
  return parseLanguageCode(value);
}
