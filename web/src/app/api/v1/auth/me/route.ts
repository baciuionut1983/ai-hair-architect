import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { findPersistenceUserBySessionToken } from "@/lib/auth-persistence";
import { upsertUser } from "@/lib/milestone1-store";

const SESSION_COOKIE_NAME = "aha_session";

// M32 GO-4C: Postgres is the sole source of truth for the auth decision here
// (no more in-memory-first session lookup, which could accept a session
// Postgres had already expired). The upsertUser sync below is unchanged --
// it is non-auth business behavior (keeping the in-memory store's user list
// warm for other subsystems that still read it) that this milestone does not
// touch, only the authentication decision that used to gate it.
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;

  const persisted = token ? await findPersistenceUserBySessionToken(token) : null;

  if (!persisted) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const synced = upsertUser({
    id: persisted.id,
    email: persisted.email,
    passwordHash: persisted.passwordHash,
    role: persisted.role,
    locale: persisted.locale,
    createdAt: persisted.createdAt
  });

  const user = {
    id: synced.id,
    email: synced.email,
    role: synced.role,
    locale: synced.locale,
    createdAt: synced.createdAt
  };

  return NextResponse.json({ authenticated: true, user }, { status: 200 });
}
