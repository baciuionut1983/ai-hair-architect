import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsQueryBuilder, AnalyticsQueryLimitExceededError } from '@/lib/analytics-query-builder';
import { ExportService } from '@/lib/export-service';
import { AuditLogger } from '@/lib/audit-logger';
import { extractAuditContext } from '@/middleware/audit-context';
import {
  validateAnalyticsAccess,
  authorizeAnalyticsQuery,
  createAuthErrorResponse,
  AnalyticsAuthError,
} from '@/middleware/analytics-auth';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const auditContext = extractAuditContext(req);

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

    const latencyMs = Date.now() - startTime;
    const exportAction = format === 'csv' ? 'export_csv' : 'export_json';

    AuditLogger.log({
      actorUserId: user.id,
      action: exportAction,
      resourceType: 'export',
      resourceId: format,
      status: 'success',
      metadata: {
        format,
        recordCount: records.length,
        latencyMs,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      },
    });

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
      const latencyMs = Date.now() - startTime;
      AuditLogger.log({
        actorUserId: 'unknown',
        action: 'volume_limit_exceeded',
        resourceType: 'export',
        status: 'failure',
        metadata: {
          error: error.message,
          latencyMs,
          ipAddress: auditContext.ipAddress,
        },
      });

      return NextResponse.json(
        { error: error.message },
        { status: 413 }
      );
    }

    console.error('Analytics export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
