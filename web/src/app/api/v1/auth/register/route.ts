import { NextResponse } from "next/server";

import type { AuthRegisterRequest, AuthRegisterResponse, UserRole } from "@/lib/contracts";
import { upsertPersistenceUser } from "@/lib/auth-persistence";
import { hashPassword } from "@/lib/auth-security";
import { issueAuthToken } from "@/lib/auth-token-repository";
import { sendTransactionalEmail } from "@/lib/email-service";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";
import { resolveLocale } from "@/lib/i18n";
import { createUser, findUserByEmail, sanitize } from "@/lib/milestone1-store";

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

  if (findUserByEmail(email)) {
    return NextResponse.json({ error: "Email already registered." }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = createUser({ email, password: passwordHash, role, locale });
  await upsertPersistenceUser({
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    locale: user.locale,
    createdAt: user.createdAt
  });

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
