import { NextResponse } from "next/server";

import { hashPassword } from "@/lib/auth-security";
import { claimAuthToken, findValidAuthToken } from "@/lib/auth-token-repository";
import type { AuthGenericAckResponse, ResetPasswordRequest } from "@/lib/contracts";
import { revokeAllSessionsForUser, sanitize, updateUserPasswordHash } from "@/lib/milestone1-store";
import { prisma } from "@/lib/prisma";

class TokenClaimFailedError extends Error {}

const INVALID_OR_EXPIRED_RESPONSE = { error: "Invalid or expired reset link." } as const;

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ResetPasswordRequest>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const newPassword = sanitize(body.newPassword);

  if (!token || newPassword.length < 8) {
    return NextResponse.json(INVALID_OR_EXPIRED_RESPONSE, { status: 400 });
  }

  const valid = await findValidAuthToken(token, "password_reset");
  if (!valid) {
    return NextResponse.json(INVALID_OR_EXPIRED_RESPONSE, { status: 400 });
  }

  const now = new Date();
  const newPasswordHash = await hashPassword(newPassword);

  try {
    // Everything that must be true together -- the token consumed, the
    // password changed, every Postgres session revoked -- happens in one
    // transaction. A failure anywhere rolls back the whole thing: the token
    // can never be burned without the password actually changing, and the
    // password can never change while old Postgres sessions remain valid.
    await prisma.$transaction(async (tx) => {
      const claimed = await claimAuthToken(valid.id, "password_reset", now, tx);
      if (!claimed) {
        throw new TokenClaimFailedError();
      }

      await tx.user.update({ where: { id: valid.userId }, data: { passwordHash: newPasswordHash } });

      // Defense in depth: issueAuthToken already guarantees at most one
      // unused password_reset token exists per user at issue time, so this
      // should normally affect zero rows beyond the one just claimed above.
      await tx.authToken.deleteMany({
        where: { userId: valid.userId, purpose: "password_reset", usedAt: null }
      });

      await tx.session.deleteMany({ where: { userId: valid.userId } });
    });
  } catch (error) {
    if (error instanceof TokenClaimFailedError) {
      return NextResponse.json(INVALID_OR_EXPIRED_RESPONSE, { status: 400 });
    }
    return NextResponse.json({ error: "Password reset failed." }, { status: 503 });
  }

  // The Postgres side is already committed at this point; keep the
  // in-memory hybrid store consistent with it. No new session is created --
  // the user must sign in again with their new password.
  updateUserPasswordHash(valid.userId, newPasswordHash);
  revokeAllSessionsForUser(valid.userId);

  const response: AuthGenericAckResponse = {
    message: "Your password has been reset. Please sign in with your new password."
  };
  return NextResponse.json(response, { status: 200 });
}
