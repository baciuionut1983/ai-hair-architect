import { NextResponse } from "next/server";

import { findPersistenceUserByEmail } from "@/lib/auth-persistence";
import { issueAuthToken } from "@/lib/auth-token-repository";
import type { AuthGenericAckResponse, ResendVerificationEmailRequest } from "@/lib/contracts";
import { sendTransactionalEmail } from "@/lib/email-service";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";
import { sanitize } from "@/lib/milestone1-store";

const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// M26: this response is identical no matter whether the account exists, is
// already verified, or the lookup/issue/send step fails below -- a caller
// probing emails must learn nothing. Rate limiting is this repo's only
// available anti-abuse control here (in-memory, per-process, keyed on
// ip+email); it is a disclosed residual risk, not a claim of real
// distributed protection -- see M26_CLOSURE_REPORT.md.
const GENERIC_RESPONSE: AuthGenericAckResponse = {
  message: "If an account with that email exists and is not yet verified, a verification link has been sent."
};

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ResendVerificationEmailRequest>;
  const email = sanitize(body.email).toLowerCase();

  const ip = getRequestClientIp(request);
  const limiter = checkRateLimit(`auth-resend-verification:${ip}:${email}`, 5, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  if (email && email.includes("@")) {
    try {
      // Deliberately the real-Postgres lookup, not the in-memory
      // findUserByEmail -- that cache is process-local and can be cold for
      // a genuinely-existing account (e.g. after a restart), which would
      // make this endpoint silently and incorrectly no-op for real users.
      const user = await findPersistenceUserByEmail(email);
      if (user && !user.emailVerifiedAt) {
        // issueAuthToken deletes any prior unused email_verification token
        // for this user before creating the new one, so at most one stays
        // active regardless of how many times this is called.
        const issued = await issueAuthToken(user.id, "email_verification", EMAIL_VERIFICATION_TOKEN_TTL_MS);
        const verifyUrl = `${resolveAppBaseUrl()}/verify-email?token=${issued.rawToken}`;

        await sendTransactionalEmail({
          ownerUserId: user.id,
          category: "security",
          eventType: "user.email_verification_requested",
          recipientEmail: user.email,
          subject: "Verify your email for AI Hair Architect",
          text: `Please verify your email address by visiting: ${verifyUrl}\n\nThis link expires in 24 hours. If you didn't request this, you can ignore this email.`,
          idempotencyKey: `security.email_verification:${issued.tokenId}`,
          relatedEntityType: "AuthToken",
          relatedEntityId: issued.tokenId
        });
      }
    } catch {
      // Never let a lookup/issuance/send failure change the response --
      // that would itself leak account existence or verification state.
    }
  }

  return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
}

function resolveAppBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
}
