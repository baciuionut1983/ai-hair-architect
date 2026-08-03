import type { Locale, UserRole } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

const BEARER_PREFIX = "Bearer ";

export interface AuthenticatedBillingOwner {
  id: string;
  email: string;
  role: UserRole;
  locale: Locale;
}

/**
 * Canonical M19 session check: Authorization: Bearer <token> resolved against
 * prisma.session only -- no cookie, no milestone1-store fallback. expiresAt
 * must be strictly in the future; any missing token, missing session, expired
 * session, or lookup failure resolves to null so callers never proceed to a
 * Stripe call or billing write on an invalid session.
 */
export async function authenticateBillingSessionOwner(
  request: Request,
): Promise<AuthenticatedBillingOwner | null> {
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

function toLocale(value: string): Locale {
  return value === "ro" ? "ro" : "en";
}
