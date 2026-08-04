import { NextRequest, NextResponse } from 'next/server';
import { uploadAndAnalyzeImages } from '@/lib/image-analysis-service';
import { checkRateLimit, getRateLimitStatus } from '@/lib/rate-limiter';
import { checkRole } from '@/lib/auth-role';
import { authenticateSessionUser } from '@/lib/session-auth';

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleCheck = checkRole(user, ['professional', 'salon', 'admin']);
    if (!roleCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden', reason: `Role ${user.role} cannot upload images` },
        { status: 403 }
      );
    }

    const rlCheck = checkRateLimit(user.id, 'UPLOAD');
    if (!rlCheck.allowed) {
      const status = getRateLimitStatus(user.id, 'UPLOAD');
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

    const formData = await req.formData();
    const clientId = formData.get('clientId') as string;
    const filesFormData = formData.getAll('files') as File[];

    if (!clientId || !filesFormData.length) {
      return NextResponse.json(
        { error: 'clientId and files required' },
        { status: 400 }
      );
    }

    const results = await uploadAndAnalyzeImages(user.id, clientId, filesFormData);

    const status = getRateLimitStatus(user.id, 'UPLOAD');
    return NextResponse.json(
      {
        success: true,
        assets: results.map((r) => ({
          assetId: r.asset.id,
          analysisId: r.analysis.id,
          fileName: r.asset.fileName,
          status: r.analysis.status,
        })),
      },
      {
        headers: {
          'X-RateLimit-Limit': String(status?.limit),
          'X-RateLimit-Remaining': String(status?.remaining),
          'X-RateLimit-Reset': String(status?.reset),
        },
      }
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json(
      { error },
      { status: 400 }
    );
  }
}
