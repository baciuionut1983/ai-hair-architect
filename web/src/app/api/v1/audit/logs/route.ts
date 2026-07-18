import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  validateAnalyticsAccess,
  createAuthErrorResponse,
  AnalyticsAuthError,
} from '@/middleware/analytics-auth';

export async function GET(req: NextRequest) {
  try {
    const user = await validateAnalyticsAccess(req);

    const searchParams = req.nextUrl.searchParams;
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const actionParam = searchParams.get('action');
    const statusParam = searchParams.get('status');
    const limitParam = searchParams.get('limit');

    // Calculate date range (default: 30 days ago to now)
    const endDate = endDateParam ? new Date(endDateParam) : new Date();
    const startDate = startDateParam
      ? new Date(startDateParam)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use ISO 8601 (e.g., 2026-07-18T00:00:00Z)' },
        { status: 400 }
      );
    }

    if (startDate > endDate) {
      return NextResponse.json(
        { error: 'startDate must be before endDate' },
        { status: 400 }
      );
    }

    if (actionParam) {
      const validActions = ['query_metrics', 'export_csv', 'export_json', 'volume_limit_exceeded', 'access_denied'];
      if (!validActions.includes(actionParam)) {
        return NextResponse.json(
          { error: `Invalid action. Allowed: ${validActions.join(', ')}` },
          { status: 400 }
        );
      }
    }

    if (statusParam) {
      const validStatuses = ['success', 'failure'];
      if (!validStatuses.includes(statusParam)) {
        return NextResponse.json(
          { error: `Invalid status. Allowed: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }
    }

    let limit = 100;
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return NextResponse.json(
          { error: 'limit must be a positive integer' },
          { status: 400 }
        );
      }
      limit = Math.min(parsedLimit, 1000);
    }

    // Build where clause
    const where: {
      createdAt: { gte: Date; lte: Date };
      actorUserId?: string;
      action?: string;
      status?: string;
    } = {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    };

    // User can only see their own logs, admin sees all
    if (user.role !== 'admin') {
      where.actorUserId = user.id;
    }

    if (actionParam) {
      where.action = actionParam;
    }

    if (statusParam) {
      where.status = statusParam;
    }

    // Query audit logs
    const auditLogs = await prisma.auditLog.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    // Get total count for meta
    const totalAvailable = await prisma.auditLog.count({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        ...(user.role !== 'admin' ? { actorUserId: user.id } : {}),
      },
    });

    return NextResponse.json({
      status: 'success',
      data: auditLogs,
      count: auditLogs.length,
      meta: {
        totalAvailable,
        queriedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    console.error('Audit logs error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
