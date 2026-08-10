import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import type { AuthRegisterRequest, AuthRegisterResponse, UserRole } from "@/lib/contracts";
import { createPersistenceUserExclusive, findPersistenceUserByEmail } from "@/lib/auth-persistence";
import { hashPassword } from "@/lib/auth-security";
import { issueAuthToken } from "@/lib/auth-token-repository";
import { buildVerificationEmailHtml } from "@/lib/email-verification-html";
import { sendTransactionalEmail } from "@/lib/email-service";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";
import { resolveLocale } from "@/lib/i18n";
import { findUserByEmail, sanitize, upsertUser } from "@/lib/milestone1-store";

const allowedRoles = new Set<UserRole>(["professional", "salon", "consumer"]);
const EMAIL_VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AuthRegisterRequest>;

  const email = sanitize(body.email).toLowerCase();
  const password = sanitize(body.password);
  const role = body.role;
  const locale = resolveLocale(body.locale);

  if (!email || !email.includes("@") || password.length < 8 || !role || !allowedRoles.has(role)) {
    return NextResponse.json({ error: "Invalid register payload." }, { status: 400 });
  }

  const ip = getRequestClientIp(request);
  const limiter = checkRateLimit(`auth-register:${ip}:${email}`, 8, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  // The in-memory check alone is not reliable across process restarts --
  // Railway redeploys reset it, Postgres does not -- so both sources must
  // agree the email is free before any write is attempted.
  if (findUserByEmail(email) || (await findPersistenceUserByEmail(email))) {
    return NextResponse.json({ error: "Email already registered." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const candidateId = randomUUID();
  const createdAt = new Date().toISOString();

  // INSERT-only, never upsert -- a duplicate email must never silently
  // overwrite an existing account's password. Postgres's unique constraint
  // on User.email is the real, race-safe authority: the lookup above
  // narrows the common case, but only this insert's outcome can be trusted
  // when two registrations for the same email race each other.
  let persistedUserId: string;
  try {
    const result = await createPersistenceUserExclusive({ id: candidateId, email, passwordHash, role, locale, createdAt });

    if (result.status === "conflict") {
      return NextResponse.json({ error: "Email already registered." }, { status: 409 });
    }

    persistedUserId = result.status === "created" ? result.id : candidateId;
  } catch {
    return NextResponse.json({ error: "Account data is temporarily unavailable." }, { status: 503 });
  }

  // Sync the in-memory store only now that persistence has confirmed (or
  // intentionally skipped, in DB-less dev mode) this exact id -- never
  // before, so a losing race participant's request never leaves a stray,
  // Postgres-inconsistent entry behind for a later request in this process
  // to pick up.
  const user = upsertUser({ id: persistedUserId, email, passwordHash, role, locale, createdAt });

  // M26: no session is created here. The account exists but User.emailVerifiedAt
  // stays null (see schema.prisma -- no column default) until the owner clicks
  // the link below; only then can they sign in, through the normal, separate
  // login flow. Issuing the token and sending the email must never block
  // registration itself -- the account already exists at this point regardless,
  // and a fresh verification email can always be requested via
  // resend-verification-email.
  try {
    const issued = await issueAuthToken(user.id, "email_verification", EMAIL_VERIFICATION_TOKEN_TTL_MS);
    const verifyUrl = `${resolveAppBaseUrl()}/verify-email?token=${issued.rawToken}`;

    await sendTransactionalEmail({
      ownerUserId: user.id,
      category: "security",
      eventType: "user.email_verification_requested",
      recipientEmail: user.email,
      subject: "Verify your email for AI Hair Architect",
      text: `Hi, thanks for creating an account. Please verify your email address by visiting: ${verifyUrl}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
      html: buildVerificationEmailHtml({
        introText: "Hi, thanks for creating an account. Please verify your email address to finish setting up your AI Hair Architect account.",
        verifyUrl,
        expiryNote: "This link expires in 24 hours. If you didn't create this account, you can ignore this email."
      }),
      idempotencyKey: `security.email_verification:${issued.tokenId}`,
      relatedEntityType: "AuthToken",
      relatedEntityId: issued.tokenId
    });
  } catch {
    // See comment above -- registration must succeed regardless.
  }

  const responsePayload: AuthRegisterResponse = {
    message: "Account created. Please check your email to verify your address before signing in.",
    email: user.email,
    emailVerificationRequired: true
  };

  return NextResponse.json(responsePayload, { status: 201 });
}

function resolveAppBaseUrl(): string {
  return process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
}
