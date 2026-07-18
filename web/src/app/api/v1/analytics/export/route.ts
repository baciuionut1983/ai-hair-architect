import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsQueryBuilder, AnalyticsQueryLimitExceededError } from '@/lib/analytics-query-builder';
import { ExportService } from '@/lib/export-service';
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
    const format = searchParams.get('format') as 'csv' | 'json' | null;
    const dateFromParam = searchParams.get('dateFrom');
    const dateToParam = searchParams.get('dateTo');
    const userIdParam = searchParams.get('userId');

    if (!format || !['csv', 'json'].includes(format)) {
      return NextResponse.json(
        { error: 'Missing or invalid format parameter. Must be: csv or json' },
        { status: 400 }
      );
    }

    const dateFrom = dateFromParam ? new Date(dateFromParam) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const dateTo = dateToParam ? new Date(dateToParam) : new Date();

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

    const { userId } = authorizeAnalyticsQuery(
      user,
      userIdParam || undefined,
      'personal' // Export always uses personal scope (unless admin with override)
    );

    const records = await AnalyticsQueryBuilder.buildExportData({
      userId,
      dateFrom,
      dateTo,
      scope: user.role === 'admin' && userIdParam ? 'personal' : 'personal',
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `analytics-export-${timestamp}.${format}`;

    if (format === 'csv') {
      const csv = ExportService.generateCSV(records);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    } else {
      const json = ExportService.generateJSON(records);
      return new NextResponse(json, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }
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

    console.error('Analytics export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
