import { createHash, randomBytes } from "crypto";

import { Prisma, type AuthTokenPurpose } from "@prisma/client";

import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const AUTH_TOKEN_PERSISTENCE_ERROR_CODE = "AUTH_TOKEN_PERSISTENCE_UNAVAILABLE";

const RAW_TOKEN_BYTES = 32; // 256 bits of entropy

export class AuthTokenPersistenceError extends Error {
  readonly code = AUTH_TOKEN_PERSISTENCE_ERROR_CODE;
  readonly httpStatus = 503;

  constructor() {
    super("Authentication token data is temporarily unavailable.");
    this.name = "AuthTokenPersistenceError";
  }
}

export type AuthTokenDb = Pick<Prisma.TransactionClient, "authToken">;

export interface IssuedAuthToken {
  rawToken: string;
  tokenId: string;
  expiresAt: Date;
}

export interface ValidatedAuthToken {
  id: string;
  userId: string;
  purpose: AuthTokenPurpose;
}

export function hashAuthToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Deletes any existing unused token for this exact (userId, purpose) pair
 * before creating the new one, atomically -- at most one active token per
 * user+purpose ever exists, so issuing a new one (including via resend)
 * always invalidates whatever was pending before it. The raw token is
 * returned exactly once, to be emailed immediately by the caller; it is
 * never persisted anywhere, only its hash.
 */
export async function issueAuthToken(
  userId: string,
  purpose: AuthTokenPurpose,
  ttlMs: number,
  now: Date = new Date(),
): Promise<IssuedAuthToken> {
  return runAuthTokenQuery(() =>
    prisma.$transaction(async (tx) => {
      await tx.authToken.deleteMany({ where: { userId, purpose, usedAt: null } });

      const rawToken = randomBytes(RAW_TOKEN_BYTES).toString("hex");
      const tokenHash = hashAuthToken(rawToken);
      const expiresAt = new Date(now.getTime() + ttlMs);

      const created = await tx.authToken.create({
        data: { userId, purpose, tokenHash, expiresAt },
      });

      return { rawToken, tokenId: created.id, expiresAt };
    }),
  );
}

/**
 * Fail-closed lookup. A mismatch on any single condition -- not found,
 * wrong purpose, already used, expired -- resolves to null with no
 * distinction exposed to the caller. A verification token must never
 * validate for a password reset or vice versa.
 */
export async function findValidAuthToken(
  rawToken: string,
  purpose: AuthTokenPurpose,
  now: Date = new Date(),
): Promise<ValidatedAuthToken | null> {
  return runAuthTokenQuery(async () => {
    const tokenHash = hashAuthToken(rawToken);
    const row = await prisma.authToken.findUnique({ where: { tokenHash } });

    if (
      !row ||
      row.purpose !== purpose ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }

    return { id: row.id, userId: row.userId, purpose: row.purpose };
  });
}

/**
 * Atomic single-use claim: an updateMany guarded by usedAt: null, so two
 * concurrent claims of the same token can never both succeed. Accepts an
 * optional transaction client so a caller that must bundle this with
 * another write (marking a user verified, changing a password, revoking
 * sessions) can do so in one all-or-nothing transaction -- the token is
 * only durably consumed if the whole transaction, including the protected
 * action, commits.
 */
export async function claimAuthToken(
  tokenId: string,
  purpose: AuthTokenPurpose,
  now: Date = new Date(),
  db: AuthTokenDb = prisma,
): Promise<boolean> {
  return runAuthTokenQuery(async () => {
    const claimed = await db.authToken.updateMany({
      where: { id: tokenId, purpose, usedAt: null },
      data: { usedAt: now },
    });
    return claimed.count === 1;
  });
}

export function isAuthTokenPersistenceError(error: unknown): error is AuthTokenPersistenceError {
  return error instanceof AuthTokenPersistenceError;
}

async function runAuthTokenQuery<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) throw new AuthTokenPersistenceError();

  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthTokenPersistenceError) throw error;
    throw new AuthTokenPersistenceError();
  }
}
