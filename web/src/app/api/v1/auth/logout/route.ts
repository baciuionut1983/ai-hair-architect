import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { revokePersistenceSessionToken } from "@/lib/auth-persistence";
import { revokeSessionToken } from "@/lib/milestone1-store";

function clearSessionCookie(response: NextResponse) {
  response.cookies.set("aha_session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;

  if (!token) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    clearSessionCookie(response);
    return response;
  }

  revokeSessionToken(token);
  await revokePersistenceSessionToken(token);

  const response = NextResponse.json({ success: true }, { status: 200 });
  clearSessionCookie(response);
  return response;
}