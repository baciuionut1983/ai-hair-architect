import { NextResponse } from "next/server";

import { claimAuthToken, findValidAuthToken } from "@/lib/auth-token-repository";
import type { VerifyEmailRequest, VerifyEmailResponse } from "@/lib/contracts";
import { prisma } from "@/lib/prisma";

class TokenClaimFailedError extends Error {}

const INVALID_OR_EXPIRED_RESPONSE = { error: "Invalid or expired verification link." } as const;

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<VerifyEmailRequest>;
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!token) {
    return NextResponse.json(INVALID_OR_EXPIRED_RESPONSE, { status: 400 });
  }

  const valid = await findValidAuthToken(token, "email_verification");
  if (!valid) {
    return NextResponse.json(INVALID_OR_EXPIRED_RESPONSE, { status: 400 });
  }

  const now = new Date();
  try {
    // The claim and the User update happen in one transaction: the token
    // is only durably marked used if emailVerifiedAt is actually set. A
    // torn state (token burned, verification didn't happen) is not
    // possible -- either both commit or neither does.
    await prisma.$transaction(async (tx) => {
      const claimed = await claimAuthToken(valid.id, "email_verification", now, tx);
      if (!claimed) {
        throw new TokenClaimFailedError();
      }
      await tx.user.update({ where: { id: valid.userId }, data: { emailVerifiedAt: now } });
    });
  } catch (error) {
    if (error instanceof TokenClaimFailedError) {
      return NextResponse.json(INVALID_OR_EXPIRED_RESPONSE, { status: 400 });
    }
    return NextResponse.json({ error: "Verification failed." }, { status: 503 });
  }

  const response: VerifyEmailResponse = {
    verified: true,
    message: "Your email has been verified. You can now sign in."
  };
  return NextResponse.json(response, { status: 200 });
}
