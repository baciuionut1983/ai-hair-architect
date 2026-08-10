import { Prisma } from "@prisma/client";

import type { Locale, UserRole } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

interface PersistenceUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
  emailVerifiedAt: string | null;
}

function toLocale(value: string): Locale {
  return value === "ro" ? "ro" : "en";
}

export class AuthPersistenceUnavailableError extends Error {
  readonly code = "AUTH_PERSISTENCE_UNAVAILABLE";
  readonly httpStatus = 503;

  constructor() {
    super("Account data is temporarily unavailable.");
    this.name = "AuthPersistenceUnavailableError";
  }
}

export function isAuthPersistenceUnavailableError(error: unknown): error is AuthPersistenceUnavailableError {
  return error instanceof AuthPersistenceUnavailableError;
}

/**
 * Unlike every other function in this file (best-effort, non-fatal in
 * hybrid mode -- the in-memory store remains the primary source when
 * Postgres is unreachable), this one throws on failure instead of
 * swallowing it. It backs the M26 email-verification login gate, a real
 * authorization decision: "unable to confirm verification" must never be
 * silently treated the same as "genuinely verified".
 */
export async function findEmailVerifiedAtForUser(userId: string): Promise<Date | null> {
  if (!isDatabaseConfigured()) throw new AuthPersistenceUnavailableError();

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (!user) throw new AuthPersistenceUnavailableError();
    return user.emailVerifiedAt;
  } catch (error) {
    if (error instanceof AuthPersistenceUnavailableError) throw error;
    throw new AuthPersistenceUnavailableError();
  }
}

export async function findPersistenceUserByEmail(email: string): Promise<PersistenceUser | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role as UserRole,
      locale: toLocale(user.locale),
      createdAt: user.createdAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null
    };
  } catch {
    return null;
  }
}

export type CreatePersistenceUserResult =
  | { status: "created"; id: string }
  | { status: "conflict" }
  | { status: "skipped" };

/**
 * Register's only entry point for turning a brand-new signup into a
 * PostgreSQL row. Deliberately INSERT-only, never upsert -- a duplicate
 * email must never silently overwrite an existing account's
 * passwordHash/role/locale. Postgres's own unique constraint on User.email
 * is the real, race-safe conflict detector: two concurrent registrations
 * for the same email can both pass an earlier in-memory/persisted
 * pre-check, but only one INSERT can ever succeed here -- the loser gets
 * "conflict", never a silent overwrite and never a foreign-key crash
 * downstream (e.g. issuing an AuthToken for a userId that was never
 * actually committed).
 */
export async function createPersistenceUserExclusive(input: {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
}): Promise<CreatePersistenceUserResult> {
  if (!isDatabaseConfigured()) {
    return { status: "skipped" };
  }

  try {
    const created = await prisma.user.create({
      data: {
        id: input.id,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        locale: input.locale,
        createdAt: new Date(input.createdAt)
      }
    });
    return { status: "created", id: created.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { status: "conflict" };
    }
    throw new AuthPersistenceUnavailableError();
  }
}

export async function updatePersistencePasswordHash(userId: string, passwordHash: string): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });
  } catch {
    // Non-fatal in hybrid mode.
  }
}

export async function createPersistenceSession(token: string, userId: string): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await prisma.session.upsert({
      where: { token },
      create: {
        token,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      },
      update: {
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });
  } catch {
    // Non-fatal in hybrid mode.
  }
}

export async function revokePersistenceSessionToken(token: string): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await prisma.session.deleteMany({ where: { token } });
  } catch {
    // Non-fatal in hybrid mode.
  }
}

export async function findPersistenceUserBySessionToken(token: string): Promise<PersistenceUser | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date()) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      passwordHash: session.user.passwordHash,
      role: session.user.role as UserRole,
      locale: toLocale(session.user.locale),
      createdAt: session.user.createdAt.toISOString(),
      emailVerifiedAt: session.user.emailVerifiedAt ? session.user.emailVerifiedAt.toISOString() : null
    };
  } catch {
    return null;
  }
}

/**
 * M32 GO-2: the minimal, non-sensitive user shape production API routes
 * should authenticate against -- no passwordHash, no timestamps, nothing a
 * route has no business reading just to know who's calling.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  locale: Locale;
}

/**
 * Postgres-only session resolution: wraps findPersistenceUserBySessionToken
 * (real expiresAt enforced there) and strips it down to AuthenticatedUser.
 * No in-memory fallback, no second/parallel validation -- this is the one
 * place a session token is turned into "who is this," reused by both
 * image-pipeline-auth.ts and session-request-auth.ts so neither keeps its
 * own copy of this logic.
 */
export async function resolveAuthenticatedUserFromToken(token: string): Promise<AuthenticatedUser | null> {
  const persisted = await findPersistenceUserBySessionToken(token);
  if (!persisted) return null;

  return {
    id: persisted.id,
    email: persisted.email,
    role: persisted.role,
    locale: persisted.locale
  };
}
