import { NextRequest, NextResponse } from 'next/server';

import { checkRole } from '@/lib/auth-role';
import {
  PROCESSING_RESULT_HTTP_STATUS,
  processImageAnalysis,
} from '@/lib/image-analysis-processing-service';
import { checkRateLimit, getRateLimitStatus } from '@/lib/rate-limiter';
import { authenticateSessionUser } from '@/lib/session-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const user = await authenticateSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleCheck = checkRole(user, ['professional', 'salon', 'admin']);
    if (!roleCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden', reason: `Role ${user.role} cannot process image analyses` },
        { status: roleCheck.status || 403 }
      );
    }

    const rlCheck = checkRateLimit(user.id, 'ANALYZE');
    if (!rlCheck.allowed) {
      const status = getRateLimitStatus(user.id, 'ANALYZE');
      return NextResponse.json(
        { error: 'Rate limit exceeded', retryAfter: rlCheck.retryAfter },
        {
          status: 429,
          headers: {
            'Retry-After': String(rlCheck.retryAfter),
            'X-RateLimit-Limit': String(status?.limit),
            'X-RateLimit-Remaining': String(status?.remaining),
            'X-RateLimit-Reset': String(status?.reset),
          },
        }
      );
    }

    const result = await processImageAnalysis(assetId, user.id);

    if (result.outcome === 'failed') {
      return NextResponse.json(
        { error: result.code },
        { status: PROCESSING_RESULT_HTTP_STATUS[result.code] }
      );
    }

    return NextResponse.json(
      { success: true, outcome: result.outcome, analysis: result.analysis },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: 'INTERNAL_PROCESSING_FAILURE' }, { status: 500 });
  }
}
