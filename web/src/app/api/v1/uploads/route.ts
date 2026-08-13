import { NextRequest, NextResponse } from 'next/server';
import { uploadAndAnalyzeImages } from '@/lib/image-analysis-service';
import { ImageProcessingError } from '@/lib/image-normalizer';
import { checkRateLimit, getRateLimitStatus } from '@/lib/rate-limiter';
import { checkRole } from '@/lib/auth-role';
import { resolvePipelineAuth } from '@/lib/image-pipeline-auth';

export async function POST(req: NextRequest) {
  try {
    const user = await resolvePipelineAuth(req);
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
    // Structured, safe-fields-only log for every upload failure (no image
    // bytes, no secrets) -- this is what makes VipsJpeg/S3/Prisma failures
    // diagnosable from Deploy Logs instead of only surfacing in the UI.
    console.error(
      JSON.stringify({
        gate: 'IMAGE_UPLOAD',
        status: 'FAILED',
        errorName: err instanceof Error ? err.name : 'unknown',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    );

    // ImageProcessingError (image-normalizer.ts) always carries a safe,
    // generic message already -- the raw sharp/libvips detail was logged
    // above, never returned to the client. Every other Error thrown by
    // uploadAndAnalyzeImages (validation/magic-byte checks) is also a
    // safe, self-constructed message, not raw library/SDK output.
    const error = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json(
      { error },
      { status: err instanceof ImageProcessingError ? 422 : 400 }
    );
  }
}
