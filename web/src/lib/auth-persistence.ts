import type { Locale, UserRole } from "@/lib/contracts";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

interface PersistenceUser {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
}

function toLocale(value: string): Locale {
  return value === "ro" ? "ro" : "en";
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
      createdAt: user.createdAt.toISOString()
    };
  } catch {
    return null;
  }
}

export async function upsertPersistenceUser(input: {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  locale: Locale;
  createdAt: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await prisma.user.upsert({
      where: { email: input.email.toLowerCase() },
      create: {
        id: input.id,
        email: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
        role: input.role,
        locale: input.locale,
        createdAt: new Date(input.createdAt)
      },
      update: {
        passwordHash: input.passwordHash,
        role: input.role,
        locale: input.locale
      }
    });
  } catch {
    // In-memory mode remains available when DB is unreachable.
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
      createdAt: session.user.createdAt.toISOString()
    };
  } catch {
    return null;
  }
}
