import { NextRequest, NextResponse } from 'next/server';

import { checkRole } from '@/lib/auth-role';
import {
  ImageAnalysisJobStateError,
  queueAnalysisForExternalProvider,
  recordExternalAiConsent,
} from '@/lib/image-analysis-job-repository';
import {
  PROCESSING_RESULT_HTTP_STATUS,
  processImageAnalysis,
} from '@/lib/image-analysis-processing-service';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, getRateLimitStatus } from '@/lib/rate-limiter';

const CONSENT_VERSION = 'v1';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleCheck = checkRole(user, ['professional', 'salon', 'admin']);
    if (!roleCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden', reason: `Role ${user.role} cannot request AI analysis` },
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

    // Explicit consent is captured right here, from this specific user
    // action -- never inferred, never defaulted. This is the one and only
    // place in the product that ever calls recordExternalAiConsent.
    let hasConsent = false;
    try {
      const body = (await req.json()) as unknown;
      hasConsent = typeof body === 'object' && body !== null && (body as { consent?: unknown }).consent === true;
    } catch {
      hasConsent = false;
    }
    if (!hasConsent) {
      return NextResponse.json({ error: 'CONSENT_REQUIRED' }, { status: 403 });
    }

    let analysisId: string;
    try {
      const queued = await queueAnalysisForExternalProvider(assetId, user.id);
      analysisId = queued.analysisId;
    } catch (error) {
      if (error instanceof ImageAnalysisJobStateError) {
        return NextResponse.json({ error: 'ANALYSIS_NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ error: 'INTERNAL_PROCESSING_FAILURE' }, { status: 500 });
    }

    try {
      await recordExternalAiConsent(analysisId, user.id, CONSENT_VERSION);
    } catch {
      return NextResponse.json({ error: 'INTERNAL_PROCESSING_FAILURE' }, { status: 500 });
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

async function getAuthenticatedUser(req: NextRequest) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  return session?.user || null;
}
