import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export type AllowedRole = 'professional' | 'salon' | 'admin';

interface UserWithRole {
  id: string;
  role: AllowedRole | string;
}

export function checkRole(user: UserWithRole | null, allowedRoles: AllowedRole[]): { allowed: boolean; status?: number } {
  if (!user) return { allowed: false, status: 401 };
  if (!user.role) return { allowed: false, status: 401 };

  if (!allowedRoles.includes(user.role as AllowedRole)) {
    return { allowed: false, status: 403 };
  }

  return { allowed: true };
}

export function withRoleCheck(allowedRoles: AllowedRole[]) {
  return (handler: (req: NextRequest, user: UserWithRole, params: Record<string, string>) => Promise<NextResponse>) => {
    return async (req: NextRequest, params: Record<string, string>) => {
      const token = req.headers.get('Authorization')?.replace('Bearer ', '');
      if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const roleCheck = checkRole(session.user, allowedRoles);
      if (!roleCheck.allowed) {
        return NextResponse.json(
          { error: 'Forbidden', reason: `Role ${(session.user as UserWithRole).role} not allowed for this operation` },
          { status: roleCheck.status || 403 }
        );
      }

      return handler(req, session.user as UserWithRole, params);
    };
  };
}
