import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

export class AnalyticsAuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'AnalyticsAuthError';
  }
}

export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | null> {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!session) return null;

    if (new Date(session.expiresAt) < new Date()) {
      await prisma.session.delete({ where: { token } });
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    };
  } catch {
    return null;
  }
}

export async function validateAnalyticsAccess(
  req: NextRequest,
  requiredRole?: string
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    throw new AnalyticsAuthError(401, 'Unauthorized');
  }

  if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
    throw new AnalyticsAuthError(403, 'Forbidden');
  }

  return user;
}

export function authorizeAnalyticsQuery(
  user: AuthenticatedUser,
  requestedUserId?: string,
  scope?: 'personal' | 'all'
): { userId: string; scope: 'personal' | 'all' } {
  // Non-admin cannot request all-user scope
  if (scope === 'all' && user.role !== 'admin') {
    throw new AnalyticsAuthError(403, 'Forbidden: Cannot access all-user scope');
  }

  // Non-admin cannot override userId
  if (requestedUserId && requestedUserId !== user.id && user.role !== 'admin') {
    throw new AnalyticsAuthError(403, 'Forbidden: Cannot access other user data');
  }

  // Determine final scope and userId
  const finalScope = scope ?? 'personal';
  const finalUserId = user.role === 'admin' && requestedUserId ? requestedUserId : user.id;

  return { userId: finalUserId, scope: finalScope };
}

export function createAuthErrorResponse(error: unknown) {
  if (error instanceof AnalyticsAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
