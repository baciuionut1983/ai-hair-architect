import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsQueryBuilder, AnalyticsQueryLimitExceededError } from '@/lib/analytics-query-builder';
import {
  validateAnalyticsAccess,
  authorizeAnalyticsQuery,
  createAuthErrorResponse,
  AnalyticsAuthError,
} from '@/middleware/analytics-auth';

export async function GET(req: NextRequest) {
  try {
    const user = await validateAnalyticsAccess(req);

    const searchParams = req.nextUrl.searchParams;
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');
    const scopeParam = searchParams.get('scope') as 'personal' | 'all' | null;
    const userIdParam = searchParams.get('userId');

    if (!dateFromParam || !dateToParam) {
      return NextResponse.json(
        { error: 'Missing required query parameters: dateFrom, dateTo' },
        { status: 400 }
      );
    }

    const dateFrom = new Date(dateFromParam);
    const dateTo = new Date(dateToParam);

    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use ISO 8601 (e.g., 2026-07-18T00:00:00Z)' },
        { status: 400 }
      );
    }

    if (dateFrom > dateTo) {
      return NextResponse.json(
        { error: 'dateFrom must be before dateTo' },
        { status: 400 }
      );
    }

    const { userId, scope } = authorizeAnalyticsQuery(user, userIdParam || undefined, scopeParam || undefined);

    const metrics = await AnalyticsQueryBuilder.buildMetrics({
      userId,
      dateFrom,
      dateTo,
      scope,
    });

    return NextResponse.json({
      status: 'success',
      data: {
        period: {
          from: dateFrom.toISOString(),
          to: dateTo.toISOString(),
          days: Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)),
        },
        ...metrics,
      },
      meta: {
        generatedAt: new Date().toISOString(),
        cacheStatus: 'fresh',
      },
    });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return createAuthErrorResponse(error);
    }

    if (error instanceof AnalyticsQueryLimitExceededError) {
      return NextResponse.json(
        { error: error.message },
        { status: 413 }
      );
    }

    console.error('Analytics metrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
