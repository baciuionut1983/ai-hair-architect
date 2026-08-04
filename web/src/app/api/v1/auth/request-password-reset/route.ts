import { NextResponse } from "next/server";

import { findPersistenceUserByEmail } from "@/lib/auth-persistence";
import { issueAuthToken } from "@/lib/auth-token-repository";
import type { AuthGenericAckResponse, RequestPasswordResetRequest } from "@/lib/contracts";
import { sendTransactionalEmail } from "@/lib/email-service";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";
import { sanitize } from "@/lib/milestone1-store";

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// M26: identical response whether or not the account exists -- a caller
// probing emails must learn nothing. Rate limiting is this repo's only
// available anti-abuse control here (in-memory, per-process, keyed on
// ip+email); disclosed residual risk, not a claim of real distributed
// protection -- see M26_CLOSURE_REPORT.md.
const GENERIC_RESPONSE: AuthGenericAckResponse = {
  message: "If an account with that email exists, a password reset link has been sent."
};

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<RequestPasswordResetRequest>;
  const email = sanitize(body.email).toLowerCase();

  const ip = getRequestClientIp(request);
  const limiter = checkRateLimit(`auth-request-password-reset:${ip}:${email}`, 5, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  if (email && email.includes("@")) {
    try {
      const user = await findPersistenceUserByEmail(email);
      if (user) {
        // issueAuthToken deletes any prior unused password_reset token for
        // this user before creating the new one -- at most one stays active.
        const issued = await issueAuthToken(user.id, "password_reset", PASSWORD_RESET_TOKEN_TTL_MS);
        const resetUrl = `${resolveAppBaseUrl()}/reset-password?token=${issued.rawToken}`;

        await sendTransactionalEmail({
          ownerUserId: user.id,
          category: "security",
          eventType: "user.password_reset_requested",
          recipientEmail: user.email,
          subject: "Reset your AI Hair Architect password",
          text: `We received a request to reset your password. Visit: ${resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, you can ignore this email -- your password will not change.`,
          idempotencyKey: `security.password_reset:${issued.tokenId}`,
          relatedEntityType: "AuthToken",
          relatedEntityId: issued.tokenId
        });
      }
    } catch {
      // Never let a lookup/issuance/send failure change the response --
      // that would itself leak account existence.
    }
  }

  return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
}

function resolveAppBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
}
