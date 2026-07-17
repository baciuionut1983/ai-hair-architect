import { NextResponse } from "next/server";

import type { AuthLoginRequest, AuthSessionResponse } from "@/lib/contracts";
import {
  createPersistenceSession,
  findPersistenceUserByEmail,
  updatePersistencePasswordHash
} from "@/lib/auth-persistence";
import { hashPassword, isBcryptHash, verifyPassword } from "@/lib/auth-security";
import { checkRateLimit, getRequestClientIp } from "@/lib/hardening";
import {
  createSession,
  findUserByEmail,
  sanitize,
  updateUserPasswordHash,
  upsertUser
} from "@/lib/milestone1-store";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<AuthLoginRequest>;

  const email = sanitize(body.email).toLowerCase();
  const password = sanitize(body.password);

  const ip = getRequestClientIp(request);
  const limiter = checkRateLimit(`auth-login:${ip}:${email}`, 10, 60_000);
  if (!limiter.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  let user = findUserByEmail(email);
  if (!user) {
    const persisted = await findPersistenceUserByEmail(email);
    if (persisted) {
      user = upsertUser({
        id: persisted.id,
        email: persisted.email,
        passwordHash: persisted.passwordHash,
        role: persisted.role,
        locale: persisted.locale,
        createdAt: persisted.createdAt
      });
    }
  }

  if (!user) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  let isValid = false;
  if (isBcryptHash(user.passwordHash)) {
    isValid = await verifyPassword(password, user.passwordHash);
  } else if (user.passwordHash === password) {
    // Upgrade legacy plaintext credential on successful login.
    const upgraded = await hashPassword(password);
    updateUserPasswordHash(user.id, upgraded);
    await updatePersistencePasswordHash(user.id, upgraded);
    isValid = true;
  }

  if (!isValid) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = createSession(user.id);
  await createPersistenceSession(token, user.id);

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

  const response = NextResponse.json(responsePayload, { status: 200 });
  response.cookies.set("aha_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60
  });

  return response;
}
