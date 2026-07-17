import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findPersistenceUserBySessionToken } from "@/lib/auth-persistence";
import { getSession, upsertUser } from "@/lib/milestone1-store";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("aha_session")?.value ?? null;
  let user = getSession(token);

  if (!user && token) {
    const persisted = await findPersistenceUserBySessionToken(token);
    if (persisted) {
      const synced = upsertUser({
        id: persisted.id,
        email: persisted.email,
        passwordHash: persisted.passwordHash,
        role: persisted.role,
        locale: persisted.locale,
        createdAt: persisted.createdAt
      });

      user = {
        id: synced.id,
        email: synced.email,
        role: synced.role,
        locale: synced.locale,
        createdAt: synced.createdAt
      };
    }
  }

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({ authenticated: true, user }, { status: 200 });
}
