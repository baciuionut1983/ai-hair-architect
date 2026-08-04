import { NextResponse } from "next/server";

import type { AuthRegisterRequest, AuthSessionResponse, UserRole } from "@/lib/contracts";
import { upsertPersistenceUser, createPersistenceSession } from "@/lib/auth-persistence";
import { hashPassword } from "@/lib/auth-security";
import { sendTransactionalEmail } from "@/lib/email-service";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";
import { createSession, createUser, findUserByEmail, sanitize } from "@/lib/milestone1-store";
import { resolveLocale } from "@/lib/i18n";

const allowedRoles = new Set<UserRole>(["professional", "salon", "consumer"]);

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

  const token = createSession(user.id);
  await createPersistenceSession(token, user.id);

  // sendTransactionalEmail is contractually guaranteed to never throw, but
  // this call is still wrapped defensively (matching the same discipline
  // applied at every other M25 trigger point) so a successful registration
  // can never be blocked by anything on the email side, even a future
  // regression of that contract.
  try {
    await sendTransactionalEmail({
      ownerUserId: user.id,
      category: "onboarding",
      eventType: "user.registered",
      recipientEmail: user.email,
      subject: "Welcome to AI Hair Architect",
      text: "Hi, your account has been created. You can now sign in and start using AI Hair Architect.",
      idempotencyKey: `onboarding.welcome:${user.id}`,
      relatedEntityType: "User",
      relatedEntityId: user.id,
    });
  } catch {
    // See comment above -- registration must succeed regardless.
  }

  const responsePayload: AuthSessionResponse = {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      locale: user.locale,
      createdAt: user.createdAt
    }
  };

  const response = NextResponse.json(responsePayload, { status: 201 });
  response.cookies.set("aha_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  });

  return response;
}
